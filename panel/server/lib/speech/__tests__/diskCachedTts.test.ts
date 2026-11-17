import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineStatus, SynthesisRequest, SynthesisResult, Tts } from "anytts";

import type { AnswerAudioCache, AnswerKey, AnswerRecordKind } from "../answerAudioCache";
import { countingTts } from "../countingTts";
import { diskCachedTts } from "../diskCachedTts";
import type { UsageStore } from "../usage-store";

/**
 * The relay's disk wrapper: a unit already in the answer audio cache is
 * answered from disk without reaching the engine; a miss synthesizes and
 * stores the bytes without the response waiting on the write. The inner Tts,
 * the store and the usage counter are fakes, so nothing touches the disk.
 */

const SPOKEN = [1, 2, 3];
const STORED = [9, 8, 7];

function fakeTts(answeredBy = "omnivoice") {
  return {
    synthesize: vi.fn(
      async (req: SynthesisRequest): Promise<SynthesisResult> => ({
        bytes: new Uint8Array(SPOKEN).buffer,
        mime: "audio/mpeg",
        engine: answeredBy,
        voice: req.voice ?? "default",
      }),
    ),
    prefetch: vi.fn(),
    isCached: vi.fn(() => false),
    state: vi.fn((): "cold" | "pending" | "ready" => "cold"),
    subscribe: vi.fn(() => () => {}),
    restartStalled: vi.fn(() => true),
    engineStatus: vi.fn((_id: string): EngineStatus => ({ state: "ready" })),
  };
}

/** An in-memory store keyed like the real one; `opts` makes it fail. */
function fakeCache(opts: { failRead?: boolean; failWrite?: boolean; holdWrite?: Promise<void> } = {}) {
  const files = new Map<string, Uint8Array>();
  const id = (key: AnswerKey, kind: AnswerRecordKind = "audio") =>
    JSON.stringify([kind, key.engine, key.voice ?? "", key.lang ?? "", key.text]);
  const cache = {
    files,
    put(key: AnswerKey, bytes: number[]) {
      files.set(id(key), new Uint8Array(bytes));
    },
    putSpeaker(key: AnswerKey, speaker: { engine: string; voice: string }) {
      files.set(id(key, "speaker"), new TextEncoder().encode(JSON.stringify(speaker)));
    },
    has(key: AnswerKey) {
      return files.has(id(key));
    },
    read: vi.fn(async (key: AnswerKey, kind?: AnswerRecordKind) => {
      if (opts.failRead) throw new Error("disk gone");
      return files.get(id(key, kind));
    }),
    write: vi.fn(async (key: AnswerKey, bytes: Uint8Array, kind?: AnswerRecordKind) => {
      await opts.holdWrite;
      if (opts.failWrite) throw new Error("disk full");
      files.set(id(key, kind), new Uint8Array(bytes));
    }),
    sweep: vi.fn(async () => ({ removedUnits: 0, removedBytes: 0, keptUnits: 0, keptBytes: 0 })),
    clear: vi.fn(async () => files.clear()),
  };
  return cache as typeof cache & AnswerAudioCache;
}

function fakeUsage() {
  return { record: vi.fn(async () => {}), readAll: vi.fn(async () => []) } as unknown as UsageStore & {
    record: ReturnType<typeof vi.fn>;
  };
}

/** Lets fire-and-forget writes settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
});

const REQ: SynthesisRequest = { engine: "omnivoice", text: "Hello there.", voice: "alloy", lang: "en" };
const KEY: AnswerKey = { engine: "omnivoice", text: "Hello there.", voice: "alloy", lang: "en" };

describe("diskCachedTts", () => {
  it("a disk hit returns the file without calling the engine", async () => {
    const inner = fakeTts();
    const cache = fakeCache();
    cache.put(KEY, STORED);
    cache.putSpeaker(KEY, { engine: "omnivoice", voice: "alloy" });
    const tts = diskCachedTts(inner as unknown as Tts, cache);

    const result = await tts.synthesize(REQ);

    expect([...new Uint8Array(result.bytes)]).toEqual(STORED);
    expect(result.mime).toBe("audio/mpeg");
    expect(result.engine).toBe("omnivoice");
    expect(result.voice).toBe("alloy");
    expect(inner.synthesize).not.toHaveBeenCalled();
    expect(cache.write).not.toHaveBeenCalled();
    // Every other method still reaches the inner instance.
    expect(tts.state(REQ)).toBe("cold");
    expect(inner.state).toHaveBeenCalledWith(REQ);
  });

  it("a miss synthesizes and stores the unit", async () => {
    const inner = fakeTts();
    let release!: () => void;
    const cache = fakeCache({ holdWrite: new Promise<void>((r) => (release = r)) });
    const tts = diskCachedTts(inner as unknown as Tts, cache);

    // The write is held: the result must not wait for it.
    const result = await tts.synthesize(REQ);
    expect([...new Uint8Array(result.bytes)]).toEqual(SPOKEN);
    expect(inner.synthesize).toHaveBeenCalledWith(REQ);
    expect(cache.write).toHaveBeenCalledTimes(1);
    expect(cache.has(KEY)).toBe(false);

    release();
    await settle();
    expect(cache.has(KEY)).toBe(true);

    // A request with no engine is stored under the engine that answered.
    const bare: SynthesisRequest = { text: "Bare.", voice: "alloy" };
    await tts.synthesize(bare);
    await settle();
    // (calls 0 and 1 are the first unit's audio and speaker record)
    expect(cache.write.mock.calls[2]![0]).toEqual({ engine: "omnivoice", text: "Bare.", voice: "alloy" });
    // ...and can then be found by a request naming that engine.
    inner.synthesize.mockClear();
    await tts.synthesize({ ...bare, engine: "omnivoice" });
    expect(inner.synthesize).not.toHaveBeenCalled();
  });

  it("keys a cascade by its member voices, order and pronunciation", async () => {
    const inner = fakeTts("omnivoice");
    const cache = fakeCache();
    const tts = diskCachedTts(inner as unknown as Tts, cache);
    const cascade: SynthesisRequest = {
      engine: "cascade",
      text: "Hi.",
      lang: "en",
      voices: { omnivoice: "alloy" },
      order: ["omnivoice", "edge"],
      pronunciation: { omnivoice: true },
    };

    await tts.synthesize(cascade);
    await settle();
    await tts.synthesize(cascade);
    expect(inner.synthesize).toHaveBeenCalledTimes(1);

    // A different member voice selects different audio.
    await tts.synthesize({ ...cascade, voices: { omnivoice: "echo" } });
    expect(inner.synthesize).toHaveBeenCalledTimes(2);
  });

  it("a disk hit is not counted as usage", async () => {
    const inner = fakeTts();
    const usage = fakeUsage();
    const cache = fakeCache();
    const tts = diskCachedTts(countingTts(inner as unknown as Tts, usage), cache);

    await tts.synthesize(REQ);
    await settle();
    expect(usage.record).toHaveBeenCalledTimes(1);

    await tts.synthesize(REQ);
    await settle();
    expect(inner.synthesize).toHaveBeenCalledTimes(1);
    expect(usage.record).toHaveBeenCalledTimes(1);
  });

  it("a failing store never fails the synthesis", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const inner = fakeTts();
    const cache = fakeCache({ failRead: true, failWrite: true });
    const tts = diskCachedTts(inner as unknown as Tts, cache);

    const result = await tts.synthesize(REQ);
    await settle();

    expect([...new Uint8Array(result.bytes)]).toEqual(SPOKEN);
    expect(inner.synthesize).toHaveBeenCalledTimes(1);
    expect(cache.write).toHaveBeenCalledTimes(1);
    // One warning per failure kind (read, write), not one per call.
    await tts.synthesize(REQ);
    await settle();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("a cascade disk hit reports the answering member's engine and voice", async () => {
    const inner = fakeTts("omnivoice");
    const cache = fakeCache();
    const tts = diskCachedTts(inner as unknown as Tts, cache);
    const cascade: SynthesisRequest = { engine: "cascade", text: "Hi.", lang: "en", order: ["omnivoice", "edge"] };

    const miss = await tts.synthesize(cascade);
    await settle();
    const hit = await tts.synthesize(cascade);

    expect(inner.synthesize).toHaveBeenCalledTimes(1);
    expect(hit.engine).toBe(miss.engine);
    expect(hit.voice).toBe(miss.voice);
    expect(hit.engine).toBe("omnivoice");
    expect(hit.voice).not.toBe("");
  });

  it("a disk hit without its speaker record is a miss", async () => {
    const inner = fakeTts();
    const cache = fakeCache();
    cache.put(KEY, STORED);
    const tts = diskCachedTts(inner as unknown as Tts, cache);

    const result = await tts.synthesize(REQ);

    expect(inner.synthesize).toHaveBeenCalledTimes(1);
    expect([...new Uint8Array(result.bytes)]).toEqual(SPOKEN);
    expect(result.engine).toBe("omnivoice");
  });

  it("a cascade answered by a fallback member is not stored", async () => {
    const inner = fakeTts("omnivoice");
    const cache = fakeCache();
    const tts = diskCachedTts(inner as unknown as Tts, cache);
    const cascade: SynthesisRequest = { engine: "cascade", text: "Hi.", order: ["kokoro", "omnivoice"] };

    await tts.synthesize(cascade);
    await settle();
    expect(cache.write).not.toHaveBeenCalled();

    // No order on the request: the configured default order decides.
    const defaulted = diskCachedTts(inner as unknown as Tts, cache, { cascadeOrder: ["kokoro", "omnivoice"] });
    await defaulted.synthesize({ engine: "cascade", text: "Hi." });
    await settle();
    expect(cache.write).not.toHaveBeenCalled();

    // A member without a key is never tried, so the next one is the preferred one.
    inner.engineStatus.mockImplementation((id: string) => ({ state: id === "kokoro" ? "no-key" : "ready" }));
    await tts.synthesize(cascade);
    await settle();
    expect(cache.write).toHaveBeenCalled();
  });
});
