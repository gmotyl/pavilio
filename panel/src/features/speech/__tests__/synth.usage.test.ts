import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The browser's Edge usage report: a successful network synthesis requested
 * with engine `edge` — on either route — is reported to the panel server with
 * a fire-and-forget `POST /api/speech/usage`. The anytts instance is a fake
 * (the `synth.test.ts` pattern), so each test sets the cache state and the
 * synthesis outcome and only the seam's report is under test.
 */
const lib = vi.hoisted(() => {
  const state = {
    stateAnswer: "cold" as "cold" | "pending" | "ready",
    bytes: new ArrayBuffer(3),
    // Texts a successful synthesis has cached: like real anytts, their state
    // is `ready` afterwards, so a seam that reads the state after the await
    // sees a cache hit and would never report.
    cached: new Set<string>(),
  };
  const fake = {
    synthesize: vi.fn(async (req: { text?: string; voice?: string; engine?: string }) => {
      if (req.text !== undefined) state.cached.add(req.text);
      return {
        bytes: state.bytes,
        mime: "audio/mpeg" as const,
        engine: req.engine ?? "edge",
        voice: req.voice ?? "default",
      };
    }),
    prefetch: vi.fn(),
    isCached: vi.fn(() => false),
    state: vi.fn((req: { text?: string }) =>
      req.text !== undefined && state.cached.has(req.text) ? "ready" : state.stateAnswer,
    ),
    subscribe: vi.fn(() => () => {}),
  };
  return { state, fake, createTts: vi.fn((..._args: unknown[]): unknown => fake) };
});

vi.mock("anytts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("anytts")>();
  return { ...actual, createTts: lib.createTts };
});

const prefs = vi.hoisted(() => ({
  engine: undefined as string | undefined,
  route: undefined as string | undefined,
}));

vi.mock("../../../preferences/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../preferences/store")>();
  return {
    ...actual,
    readPreference: (def: { key: string; default: unknown }, scope?: string) =>
      def.key === "speech.engine"
        ? (prefs.engine ?? def.default)
        : def.key === "speech.route"
          ? (prefs.route ?? def.default)
          : actual.readPreference(def as never, scope),
  };
});

type Synth = typeof import("../synth");
let synth: Synth;
const fetchMock = vi.fn(async (..._args: unknown[]) => new Response(null, { status: 204 }));

/** The usage reports sent so far, as their parsed bodies. */
function reports(): unknown[] {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/speech/usage")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

/** Lets the fire-and-forget chains settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  vi.resetModules();
  lib.createTts.mockReset();
  lib.createTts.mockImplementation(() => lib.fake);
  lib.fake.synthesize.mockClear();
  lib.fake.prefetch.mockClear();
  lib.fake.state.mockClear();
  lib.state.stateAnswer = "cold";
  lib.state.cached.clear();
  prefs.engine = "edge";
  prefs.route = undefined;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  synth = await import("../synth");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Edge usage report", () => {
  it("reports a cold Edge synthesis once", async () => {
    const bytes = await synth.synthesizeSpeech("zażółć 👋", { voice: "v" });
    await settle();

    expect(bytes).toBe(lib.state.bytes);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/speech/usage");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    // Code points, not UTF-16 units: the emoji counts once.
    expect(JSON.parse(String(init.body))).toEqual({ engine: "edge", chars: 8 });
  });

  it("reports a successful cold Edge prefetch", async () => {
    synth.prefetchSpeech("hello", { voice: "v" });
    await settle();
    expect(reports()).toEqual([{ engine: "edge", chars: 5 }]);

    // A failing prefetch reports nothing and never throws.
    fetchMock.mockClear();
    lib.fake.synthesize.mockRejectedValueOnce(new Error("boom"));
    expect(() => synth.prefetchSpeech("again", { voice: "v" })).not.toThrow();
    await settle();
    expect(reports()).toEqual([]);
  });

  it("does not report cache hits or in-flight joins", async () => {
    for (const answer of ["ready", "pending"] as const) {
      lib.state.stateAnswer = answer;
      // A fresh text per answer, so the state comes from `stateAnswer`.
      await synth.synthesizeSpeech(`hello ${answer}`, { voice: "v" });
      synth.prefetchSpeech(`hello ${answer}`, { voice: "v" });
    }
    await settle();

    expect(reports()).toEqual([]);
  });

  it("does not report keyed or cascade requests", async () => {
    for (const engine of ["elevenlabs", "cartesia", "speechify", "azure", "cascade"]) {
      prefs.engine = engine;
      await synth.synthesizeSpeech("hello");
      synth.prefetchSpeech("hello");
    }
    await settle();

    expect(reports()).toEqual([]);
  });

  it("does not report failures", async () => {
    lib.fake.synthesize.mockRejectedValueOnce(new Error("boom"));

    await expect(synth.synthesizeSpeech("hello", { voice: "v" })).rejects.toThrow("boom");
    await settle();

    expect(reports()).toEqual([]);
  });

  it("a failing report does not affect synthesis", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      fetchMock.mockRejectedValue(new TypeError("network down"));

      const bytes = await synth.synthesizeSpeech("hello", { voice: "v" });
      expect(() => synth.prefetchSpeech("again", { voice: "v" })).not.toThrow();
      await settle();

      expect(bytes).toBe(lib.state.bytes);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("reports Edge on the relay route too", async () => {
    prefs.route = "server";

    await synth.synthesizeSpeech("hello", { voice: "v" });
    await settle();

    expect(reports()).toEqual([{ engine: "edge", chars: 5 }]);
  });
});
