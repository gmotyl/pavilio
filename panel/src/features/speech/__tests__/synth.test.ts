import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SynthesisRequest, Tts, TtsConfig } from "anytts";

/**
 * `synth.ts` is the panel's one seam over anytts. These tests swap the
 * library's `createTts` for a fake instance whose answers each test sets, so
 * they pin what the seam forwards and how it translates — not anytts itself.
 * The one exception is `resolveSpeechVoice`, which runs against a real
 * instance: its fallback is the library's catalog lookup, and a fake would
 * only prove the call was forwarded.
 */
const lib = vi.hoisted(() => {
  const state = {
    listeners: new Set<(e: { type: string; key: string }) => void>(),
    stateAnswer: "cold" as "cold" | "pending" | "ready",
    bytes: new ArrayBuffer(3),
  };
  const fake = {
    synthesize: vi.fn(async (req: { voice?: string }) => ({
      bytes: state.bytes,
      mime: "audio/mpeg" as const,
      engine: "edge",
      voice: req.voice ?? "default",
    })),
    prefetch: vi.fn(),
    isCached: vi.fn(() => false),
    state: vi.fn((_req: unknown) => state.stateAnswer),
    subscribe: vi.fn((listener: (e: { type: string; key: string }) => void) => {
      state.listeners.add(listener);
      return () => {
        state.listeners.delete(listener);
      };
    }),
  };
  return {
    state,
    fake,
    createTts: vi.fn((..._args: unknown[]): unknown => fake),
    emit(type: string) {
      for (const listener of [...state.listeners]) listener({ type, key: "k" });
    },
  };
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

// The instance is a lazy module singleton, so every test gets a fresh module.
beforeEach(async () => {
  vi.resetModules();
  lib.createTts.mockReset();
  lib.createTts.mockImplementation(() => lib.fake);
  lib.fake.synthesize.mockClear();
  lib.fake.prefetch.mockClear();
  lib.fake.state.mockClear();
  lib.fake.subscribe.mockClear();
  lib.state.listeners.clear();
  lib.state.stateAnswer = "cold";
  prefs.engine = undefined;
  prefs.route = undefined;
  synth = await import("../synth");
});

describe("the anytts seam", () => {
  it("creates the anytts instance lazily, once, with the panel's tiers, cache and relay config", async () => {
    const { DEFAULT_SPEECH_VOICE } = await import("../../../preferences/declarations");
    expect(lib.createTts).not.toHaveBeenCalled();

    await synth.synthesizeSpeech("hello", { voice: "v" });
    synth.prefetchSpeech("again", { voice: "v" });
    synth.speechCacheState("hello", { voice: "v" });

    expect(lib.createTts).toHaveBeenCalledTimes(1);
    const keyed = { relayUrl: "/api/tts", firstByteMs: 25_000, stallMs: 15_000 };
    const expected: TtsConfig = {
      engines: {
        edge: {
          voices: { default: DEFAULT_SPEECH_VOICE },
          relayUrl: "/api/tts",
          firstByteMs: 25_000,
          stallMs: 15_000,
          mode: "auto",
        },
        // The keyed engines and the cascade are relay clients, on every route.
        cascade: { relayUrl: "/api/tts", firstByteMs: 60_000, stallMs: 15_000 },
        elevenlabs: keyed,
        cartesia: keyed,
        speechify: keyed,
        azure: keyed,
      },
      defaultEngine: "edge",
      scheduler: {
        concurrency: 3,
        tiers: [{ name: "run" }, { name: "warm", cap: 2 }, { name: "preload" }],
      },
      cache: { max: 200 },
    };
    expect(lib.createTts.mock.calls[0]?.[0]).toEqual(expected);
  });

  it("route=server creates the instance in relay mode, and a route change re-creates it", async () => {
    prefs.route = "server";
    await synth.synthesizeSpeech("hello");
    expect(lib.createTts).toHaveBeenCalledTimes(1);
    const first = lib.createTts.mock.calls[0]?.[0] as TtsConfig;
    expect(first.engines.edge).toMatchObject({ relayUrl: "/api/tts", mode: "relay" });
    // The relay answers only once the server has synthesized the WHOLE clip,
    // so the browser's first-byte wait covers the server's own first-byte wait
    // (anytts default 8s) plus the synthesis. At anytts' 8s default every slow
    // Edge turn failed in the browser while the server went on to succeed.
    expect(first.engines.edge?.firstByteMs).toBeGreaterThan(8_000 * 2);

    // Same route: the instance (and its cache) is kept.
    await synth.synthesizeSpeech("again");
    expect(lib.createTts).toHaveBeenCalledTimes(1);

    prefs.route = "auto";
    await synth.synthesizeSpeech("hello");
    expect(lib.createTts).toHaveBeenCalledTimes(2);
    const second = lib.createTts.mock.calls[1]?.[0] as TtsConfig;
    expect(second.engines.edge).toMatchObject({ mode: "auto" });
  });

  it("an unknown stored route synthesizes in auto mode", async () => {
    prefs.route = "browser";
    await synth.synthesizeSpeech("hello");
    const config = lib.createTts.mock.calls[0]?.[0] as TtsConfig;
    expect(config.engines.edge).toMatchObject({ mode: "auto" });
  });

  it("cache listeners follow the instance across a route change", async () => {
    const unsubscribeFirst = vi.fn();
    const first = { ...lib.fake, subscribe: vi.fn(() => unsubscribeFirst) };
    lib.createTts.mockImplementationOnce(() => first);

    const listener = vi.fn();
    synth.subscribeSpeechCache(listener);
    expect(first.subscribe).toHaveBeenCalledTimes(1);

    prefs.route = "server";
    synth.speechCacheState("hello");

    // The old instance is let go and the new one carries the subscription.
    expect(unsubscribeFirst).toHaveBeenCalledTimes(1);
    expect(lib.fake.subscribe).toHaveBeenCalledTimes(1);
    // Readers are told to re-peek — the new cache starts empty — but not
    // synchronously: the swap can happen inside a render-time peek.
    expect(listener).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    lib.emit("add");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("synthesizeSpeech forwards voice, tier, signal and the engine preference and returns the bytes", async () => {
    // The only engine the instance configures; an unconfigured one falls back
    // (see the next test), so "the preference is forwarded" is pinned by edge.
    prefs.engine = "edge";
    const controller = new AbortController();

    const bytes = await synth.synthesizeSpeech("hello", {
      voice: "en-US-AvaMultilingualNeural",
      tier: "warm",
      signal: controller.signal,
    });

    expect(lib.fake.synthesize).toHaveBeenCalledTimes(1);
    const req = lib.fake.synthesize.mock.calls[0]?.[0] as SynthesisRequest;
    expect(req).toEqual({
      text: "hello",
      voice: "en-US-AvaMultilingualNeural",
      tier: "warm",
      signal: controller.signal,
      engine: "edge",
    });
    expect(req.signal).toBe(controller.signal);
    expect(bytes).toBe(lib.state.bytes);
  });

  it("an engine the instance does not configure synthesizes with the default engine", async () => {
    // A blank or stale `speech.engine` would make anytts throw RangeError.
    for (const stale of ["other", ""]) {
      prefs.engine = stale;
      lib.fake.synthesize.mockClear();

      await synth.synthesizeSpeech("hello", { voice: "v" });
      synth.prefetchSpeech("hello", { voice: "v" });
      synth.speechCacheState("hello", { voice: "v" });

      expect((lib.fake.synthesize.mock.calls[0]?.[0] as SynthesisRequest).engine).toBe("edge");
      expect(lib.fake.prefetch).toHaveBeenLastCalledWith(expect.objectContaining({ engine: "edge" }));
      expect(lib.fake.state).toHaveBeenLastCalledWith(expect.objectContaining({ engine: "edge" }));
    }
  });

  it("tier defaults to run", async () => {
    await synth.synthesizeSpeech("hello", { voice: "v" });

    const req = lib.fake.synthesize.mock.calls[0]?.[0] as SynthesisRequest;
    expect(req.tier).toBe("run");
    // With no stored preference the engine is the declared default.
    expect(req.engine).toBe("edge");
  });

  it("speechCacheState maps pending to warming, ready to ready, everything else to cold", () => {
    lib.state.stateAnswer = "pending";
    expect(synth.speechCacheState("hello", { voice: "v" })).toBe("warming");
    lib.state.stateAnswer = "ready";
    expect(synth.speechCacheState("hello", { voice: "v" })).toBe("ready");
    lib.state.stateAnswer = "cold";
    expect(synth.speechCacheState("hello", { voice: "v" })).toBe("cold");

    expect(lib.fake.state).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "hello", voice: "v", engine: "edge" }),
    );
  });

  it("isSpeechSynthesized is true for warming and ready", () => {
    lib.state.stateAnswer = "pending";
    expect(synth.isSpeechSynthesized("hello", { voice: "v" })).toBe(true);
    lib.state.stateAnswer = "ready";
    expect(synth.isSpeechSynthesized("hello", { voice: "v" })).toBe(true);
    lib.state.stateAnswer = "cold";
    expect(synth.isSpeechSynthesized("hello", { voice: "v" })).toBe(false);
  });

  it("subscribeSpeechCache fires once per library event of every type and survives a throwing listener", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const thrower = vi.fn(() => {
      throw new Error("bad reader");
    });
    const listener = vi.fn();
    synth.subscribeSpeechCache(thrower);
    const unsubscribe = synth.subscribeSpeechCache(listener);

    for (const type of ["pending", "add", "drop", "evict"]) lib.emit(type);

    expect(thrower).toHaveBeenCalledTimes(4);
    expect(listener).toHaveBeenCalledTimes(4);
    // One library subscription serves every panel listener.
    expect(lib.fake.subscribe).toHaveBeenCalledTimes(1);

    unsubscribe();
    lib.emit("add");
    expect(listener).toHaveBeenCalledTimes(4);
    errorSpy.mockRestore();
  });

  it("blank text is cold without touching the library", () => {
    expect(synth.speechCacheState("")).toBe("cold");
    expect(synth.speechCacheState("   \n")).toBe("cold");
    expect(synth.isSpeechSynthesized("  ")).toBe(false);
    synth.prefetchSpeech(" ");

    expect(lib.createTts).not.toHaveBeenCalled();
    expect(lib.fake.state).not.toHaveBeenCalled();
    expect(lib.fake.prefetch).not.toHaveBeenCalled();
  });

  it("resolveSpeechVoice falls back to the engine default for a voice outside the catalog", async () => {
    const actual = await vi.importActual<typeof import("anytts")>("anytts");
    lib.createTts.mockImplementation((config) => actual.createTts(config as TtsConfig) as Tts);
    const { DEFAULT_SPEECH_VOICE } = await import("../../../preferences/declarations");

    expect(synth.resolveSpeechVoice({ engine: "edge", voice: "xx-XX-NobodyNeural" })).toEqual({
      voice: DEFAULT_SPEECH_VOICE,
      fellBack: true,
    });
    expect(
      synth.resolveSpeechVoice({ engine: "edge", voice: "en-US-AvaMultilingualNeural" }),
    ).toEqual({ voice: "en-US-AvaMultilingualNeural", fellBack: false });
  });
});

describe("toSpeechBlob", () => {
  it("wraps the buffer as an MP3 blob", () => {
    const blob = synth.toSpeechBlob(new ArrayBuffer(4));
    expect(blob.type).toBe(synth.SPEECH_AUDIO_MIME_TYPE);
    expect(blob.size).toBe(4);
  });
});
