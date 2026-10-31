import { afterEach, describe, expect, it, vi } from "vitest";
import type { SynthesisRequest, SynthesisResult, Tts } from "anytts";

import { countingTts } from "../countingTts";
import type { UsageStore } from "../usage-store";

/**
 * The relay's counting wrapper: keyed-engine and cascade syntheses that reach
 * the network are recorded in the usage store, by the engine that answered;
 * plain Edge requests (the browser reports those), cache hits and failures are
 * not. The inner Tts and the store are fakes.
 */

const BYTES = new ArrayBuffer(3);

function fakeTts(opts: { cached?: boolean; answeredBy?: string } = {}) {
  // Like real anytts, a successful synthesis caches its text: a wrapper that
  // read `isCached` after the await would see a hit and never record.
  const cache = new Set<string>();
  // Texts whose synthesis is running: a second request for one joins it, as
  // anytts does, and `state` answers "pending" for it.
  const inFlight = new Set<string>();
  const inner = {
    synthesize: vi.fn(async (req: SynthesisRequest): Promise<SynthesisResult> => {
      inFlight.add(req.text);
      await Promise.resolve();
      inFlight.delete(req.text);
      cache.add(req.text);
      return {
        bytes: BYTES,
        mime: "audio/mpeg",
        engine: opts.answeredBy ?? req.engine ?? "edge",
        voice: req.voice ?? "default",
      };
    }),
    prefetch: vi.fn(),
    isCached: vi.fn((req: SynthesisRequest) => (opts.cached ?? false) || cache.has(req.text)),
    state: vi.fn((req: SynthesisRequest): "cold" | "pending" | "ready" =>
      (opts.cached ?? false) || cache.has(req.text) ? "ready" : inFlight.has(req.text) ? "pending" : "cold",
    ),
    subscribe: vi.fn(() => () => {}),
    restartStalled: vi.fn(() => true),
    engineStatus: vi.fn((_id: string) => ({ state: "ready" as const })),
  };
  return inner;
}

function fakeStore(record: UsageStore["record"] = async () => {}) {
  return {
    record: vi.fn(record),
    readAll: vi.fn(async () => []),
  } as unknown as UsageStore & { record: ReturnType<typeof vi.fn> };
}

/** Lets the fire-and-forget record chain settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("countingTts", () => {
  it("records a keyed engine synthesis by code points", async () => {
    const inner = fakeTts();
    const store = fakeStore();
    const tts = countingTts(inner as unknown as Tts, store);

    const req: SynthesisRequest = { engine: "azure", text: "Cześć 👋", voice: "v" };
    const result = await tts.synthesize(req);
    await settle();

    expect(result.bytes).toBe(BYTES);
    expect(inner.synthesize).toHaveBeenCalledWith(req);
    // Code points, not UTF-16 units: the emoji counts once.
    expect(store.record).toHaveBeenCalledTimes(1);
    expect(store.record).toHaveBeenCalledWith("azure", 7);
  });

  it("attributes a cascade synthesis to the answering member", async () => {
    const inner = fakeTts({ answeredBy: "google" });
    const store = fakeStore();
    const tts = countingTts(inner as unknown as Tts, store);

    const result = await tts.synthesize({ engine: "cascade", text: "Hello.", lang: "en" });
    await settle();

    expect(result.engine).toBe("google");
    expect(store.record).toHaveBeenCalledTimes(1);
    expect(store.record).toHaveBeenCalledWith("google", 6);
  });

  it("does not record plain Edge relay requests", async () => {
    const inner = fakeTts();
    const store = fakeStore();
    const tts = countingTts(inner as unknown as Tts, store);

    // Distinct texts: a shared one would be cached by the first call, so the
    // second would be skipped as "ready" whether or not the Edge guard holds.
    // The holder configures edge, so without the guard a browser `edge`
    // request would be counted here and again by the browser's own report.
    const plain: SynthesisRequest = { text: "plain hello", voice: "v" };
    const edge: SynthesisRequest = { engine: "edge", text: "edge hello", voice: "v" };
    expect(inner.state(plain)).toBe("cold");
    expect(inner.state(edge)).toBe("cold");

    await tts.synthesize(plain);
    await tts.synthesize(edge);
    await settle();

    expect(inner.synthesize).toHaveBeenCalledWith(plain);
    expect(inner.synthesize).toHaveBeenCalledWith(edge);
    expect(inner.synthesize).toHaveBeenCalledTimes(2);
    expect(store.record).not.toHaveBeenCalled();
  });

  it("does not record cache hits", async () => {
    const inner = fakeTts({ cached: true, answeredBy: "google" });
    const store = fakeStore();
    const tts = countingTts(inner as unknown as Tts, store);

    // A keyed engine, and a cascade answered from a member's cache.
    const keyed: SynthesisRequest = { engine: "azure", text: "hello", voice: "v" };
    const cascade: SynthesisRequest = { engine: "cascade", text: "hello", lang: "en" };
    await tts.synthesize(keyed);
    await tts.synthesize(cascade);
    await settle();

    expect(inner.state).toHaveBeenCalledWith(keyed);
    expect(inner.state).toHaveBeenCalledWith(cascade);
    expect(store.record).not.toHaveBeenCalled();
  });

  it("does not record a request that joins one in flight", async () => {
    const inner = fakeTts({ answeredBy: "google" });
    const store = fakeStore();
    const tts = countingTts(inner as unknown as Tts, store);

    // Two concurrent relay requests for the same uncached text: anytts runs
    // one network synthesis and the second joins it, so only one is counted.
    const req: SynthesisRequest = { engine: "cascade", text: "hello", lang: "en" };
    await Promise.all([tts.synthesize(req), tts.synthesize(req)]);
    await settle();

    expect(store.record).toHaveBeenCalledTimes(1);
    expect(store.record).toHaveBeenCalledWith("google", 5);
  });

  it("does not record failures and rethrows", async () => {
    const inner = fakeTts();
    const error = new Error("quota");
    inner.synthesize.mockRejectedValueOnce(error);
    const store = fakeStore();
    const tts = countingTts(inner as unknown as Tts, store);

    await expect(tts.synthesize({ engine: "elevenlabs", text: "hello", voice: "v" })).rejects.toBe(error);
    await settle();

    expect(store.record).not.toHaveBeenCalled();
  });

  it("a failing store does not break synthesis", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const inner = fakeTts();
      // Never settles on its own: the result must not wait for the record.
      let rejectRecord!: (err: Error) => void;
      const store = fakeStore(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectRecord = reject;
          }),
      );
      const tts = countingTts(inner as unknown as Tts, store);

      const result = await tts.synthesize({ engine: "azure", text: "hello", voice: "v" });
      expect(result.bytes).toBe(BYTES);
      expect(store.record).toHaveBeenCalledWith("azure", 5);

      rejectRecord(new Error("disk full"));
      await settle();

      expect(unhandled).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalled();
      expect(consoleError.mock.calls.flat().join(" ")).toContain("disk full");
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("delegates the other Tts methods", () => {
    const inner = fakeTts({ cached: true });
    const store = fakeStore();
    const tts = countingTts(inner as unknown as Tts, store);
    const req: SynthesisRequest = { engine: "azure", text: "hello", voice: "v" };
    const listener = () => {};

    tts.prefetch(req);
    expect(inner.prefetch).toHaveBeenCalledWith(req);
    expect(tts.isCached(req)).toBe(true);
    expect(inner.isCached).toHaveBeenCalledWith(req);
    expect(tts.state(req)).toBe("ready");
    expect(inner.state).toHaveBeenCalledWith(req);
    const unsubscribe = tts.subscribe(listener);
    expect(inner.subscribe).toHaveBeenCalledWith(listener);
    expect(unsubscribe).toBe(inner.subscribe.mock.results[0]!.value);
    expect(tts.restartStalled()).toBe(true);
    expect(inner.restartStalled).toHaveBeenCalledTimes(1);
    expect(tts.engineStatus("azure")).toEqual({ state: "ready" });
    expect(inner.engineStatus).toHaveBeenCalledWith("azure");

    // A delegated prefetch is the inner one: the relay never prefetches.
    expect(store.record).not.toHaveBeenCalled();
  });
});
