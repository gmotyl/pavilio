import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SynthesisRequest, Tts, TtsConfig } from "anytts";
import { OPENAI_VOICE_MAP, type OmniVoiceInfo } from "../openaiVoices";
import { stubFetch } from "../../../test-utils";
import { EN_MALE, MY_VOICE, PL_FEMALE } from "./openaiVoiceFixtures";

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
        cascade: { relayUrl: "/api/tts", firstByteMs: 120_000, stallMs: 15_000 },
        elevenlabs: keyed,
        cartesia: keyed,
        speechify: keyed,
        azure: keyed,
        // The local OpenAI-compatible server: a relay client. Its real catalog is on the server;
        // the browser holds only the map's default, which anytts needs to accept the map.
        openai: {
          ...keyed,
          // Outlasts the server's 60 s wait on a whole-clip synthesis.
          firstByteMs: 75_000,
          catalog: [{ id: "my-voice", label: "my-voice", locale: "und", gender: "male", multilingual: true }],
          voices: OPENAI_VOICE_MAP,
        },
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

  it("resetSpeechCache empties the in-memory cache", async () => {
    const first = {
      ...lib.fake,
      synthesize: vi.fn(async () => ({
        bytes: lib.state.bytes,
        mime: "audio/mpeg" as const,
        engine: "edge",
        voice: "v",
      })),
      state: vi.fn(() => "ready" as const),
    };
    lib.createTts.mockImplementationOnce(() => first);

    await synth.synthesizeSpeech("hello", { voice: "v" });
    expect(synth.speechCacheState("hello", { voice: "v" })).toBe("ready");

    synth.resetSpeechCache();

    // A fresh instance answers from an empty cache and synthesizes again.
    expect(synth.speechCacheState("hello", { voice: "v" })).toBe("cold");
    await synth.synthesizeSpeech("hello", { voice: "v" });
    expect(lib.createTts).toHaveBeenCalledTimes(2);
    expect(first.synthesize).toHaveBeenCalledTimes(1);
    expect(lib.fake.synthesize).toHaveBeenCalledTimes(1);
  });

  it("resetSpeechCache notifies cache listeners", async () => {
    const unsubscribeFirst = vi.fn();
    const first = { ...lib.fake, subscribe: vi.fn(() => unsubscribeFirst) };
    lib.createTts.mockImplementationOnce(() => first);

    const listener = vi.fn();
    synth.subscribeSpeechCache(listener);

    synth.resetSpeechCache();

    // The subscription moves to the new instance, and readers re-peek on a
    // microtask — the same path a preference change takes.
    expect(unsubscribeFirst).toHaveBeenCalledTimes(1);
    expect(lib.fake.subscribe).toHaveBeenCalledTimes(1);
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
      // A cold Edge warm calls `synthesize` itself, to learn the outcome it reports.
      expect(lib.fake.synthesize).toHaveBeenLastCalledWith(
        expect.objectContaining({ engine: "edge", tier: "preload" }),
      );
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

describe("the openai engine and the live catalog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Loads `voices` into the browser's live list, in this test's module registry. */
  async function loadLive(voices: readonly OmniVoiceInfo[]): Promise<void> {
    stubFetch({ "/api/speech/openai/voices": { voices, unreachable: false, workspaceOnly: 0 } });
    const store = await import("../useOpenaiVoices");
    await store.reloadOpenaiVoices();
  }

  it("the browser's openai catalog follows the live list, its map resolved against it", async () => {
    prefs.engine = "openai";
    await loadLive([PL_FEMALE, EN_MALE]);
    await synth.synthesizeSpeech("cześć", { voice: PL_FEMALE.id });

    const config = lib.createTts.mock.calls.at(-1)![0] as TtsConfig;
    expect(config.engines.openai).toMatchObject({
      catalog: [PL_FEMALE, EN_MALE],
      // my-voice is not listed: each entry falls back as the panel server's does.
      voices: { pl: PL_FEMALE.id, en: EN_MALE.id, default: PL_FEMALE.id },
    });
    expect(lib.fake.synthesize).toHaveBeenLastCalledWith(
      expect.objectContaining({ engine: "openai", voice: PL_FEMALE.id }),
    );

    // A voice added on the server: the next use rebuilds the instance around the new list.
    await loadLive([MY_VOICE, PL_FEMALE, EN_MALE]);
    await synth.synthesizeSpeech("cześć", { voice: MY_VOICE.id });
    expect(lib.createTts).toHaveBeenCalledTimes(2);
    expect((lib.createTts.mock.calls.at(-1)![0] as TtsConfig).engines.openai).toMatchObject({
      catalog: [MY_VOICE, PL_FEMALE, EN_MALE],
      voices: OPENAI_VOICE_MAP,
    });
  });

  it("a voice picked from the live list is accepted by the real anytts", async () => {
    const actual = await vi.importActual<typeof import("anytts")>("anytts");
    lib.createTts.mockImplementation((config) => actual.createTts(config as TtsConfig) as Tts);
    await loadLive([PL_FEMALE, EN_MALE]);
    expect(synth.resolveSpeechVoice({ engine: "openai", voice: EN_MALE.id })).toEqual({
      voice: EN_MALE.id,
      fellBack: false,
    });
  });

  it("an openai request never names a voice the live list lacks", async () => {
    prefs.engine = "openai";
    await loadLive([PL_FEMALE, EN_MALE]);
    await synth.synthesizeSpeech("hello", { voice: MY_VOICE.id });

    const req = lib.fake.synthesize.mock.calls.at(-1)![0] as SynthesisRequest;
    expect(req.engine).toBe("openai");
    // No voice: anytts takes the map's default, which the list holds.
    expect(req.voice).toBeUndefined();
  });

  it("with no live list the server picks the openai voice", async () => {
    prefs.engine = "openai";
    await synth.synthesizeSpeech("hello", { voice: MY_VOICE.id, lang: "en" });
    synth.speechCacheState("hello", { voice: MY_VOICE.id, lang: "en" });

    // A one-member cascade names no voice, so the panel server resolves its own default.
    const req = lib.fake.synthesize.mock.calls.at(-1)![0] as SynthesisRequest;
    expect(req).toMatchObject({ text: "hello", engine: "cascade", lang: "en", order: ["openai"] });
    expect(req.voice).toBeUndefined();
    expect(req.voices).toBeUndefined();
    expect(lib.fake.state).toHaveBeenLastCalledWith(expect.objectContaining({ engine: "cascade", order: ["openai"] }));
  });
  it("a cascade request drops an openai voice the live list lacks", async () => {
    prefs.engine = "cascade";
    const { cascadeVoiceKey } = await import("../engines");
    await loadLive([PL_FEMALE, EN_MALE]);

    await synth.synthesizeSpeech("hello", { voice: cascadeVoiceKey({ edge: "en-US-EmmaMultilingualNeural", openai: MY_VOICE.id }) });
    expect((lib.fake.synthesize.mock.calls.at(-1)![0] as SynthesisRequest).voices).toEqual({
      edge: "en-US-EmmaMultilingualNeural",
    });

    // A listed voice is forwarded as before.
    await synth.synthesizeSpeech("hello", { voice: cascadeVoiceKey({ openai: EN_MALE.id }) });
    expect((lib.fake.synthesize.mock.calls.at(-1)![0] as SynthesisRequest).voices).toEqual({ openai: EN_MALE.id });
  });

  it("extra voice record fields neither rebuild the instance nor reach anytts", async () => {
    prefs.engine = "openai";
    const withExtras = { ...PL_FEMALE, ref_text: "Dzień dobry", description: "a" } as OmniVoiceInfo;
    await loadLive([withExtras, EN_MALE]);
    await synth.synthesizeSpeech("cześć", { voice: PL_FEMALE.id });
    expect((lib.createTts.mock.calls.at(-1)![0] as TtsConfig).engines.openai).toMatchObject({
      catalog: [PL_FEMALE, EN_MALE],
    });
    expect(((lib.createTts.mock.calls.at(-1)![0] as TtsConfig).engines.openai!.catalog as unknown[])[0]).toEqual(PL_FEMALE);

    // Only the extras changed: the same instance, so the audio cache survives.
    await loadLive([{ ...withExtras, ref_text: "Cześć" } as OmniVoiceInfo, EN_MALE]);
    await synth.synthesizeSpeech("cześć", { voice: PL_FEMALE.id });
    expect(lib.createTts).toHaveBeenCalledTimes(1);
  });
});

describe("toSpeechBlob", () => {
  it("wraps the buffer as an MP3 blob", () => {
    const blob = synth.toSpeechBlob(new ArrayBuffer(4));
    expect(blob.type).toBe(synth.SPEECH_AUDIO_MIME_TYPE);
    expect(blob.size).toBe(4);
  });
});
