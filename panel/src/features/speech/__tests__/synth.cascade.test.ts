import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listVoices, type SynthesisRequest, type Tts, type TtsConfig } from "anytts";

/**
 * The seam's requests for the cascade and the keyed engines. A REAL anytts
 * instance underneath — only its `synthesize` / `state` calls are recorded on
 * the way through — and `fetch` stubbed as the panel server's `/api/tts`
 * relay, so these pin what reaches the library and what leaves the browser.
 */
const lib = vi.hoisted(() => ({
  configs: [] as unknown[],
  requests: [] as unknown[],
}));

vi.mock("anytts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("anytts")>();
  return {
    ...actual,
    createTts: (config: TtsConfig): Tts => {
      lib.configs.push(config);
      // The real instance itself, so `resolveVoice` still finds its catalog.
      const tts = actual.createTts(config);
      const synthesize = tts.synthesize.bind(tts);
      const state = tts.state.bind(tts);
      tts.synthesize = (req) => {
        lib.requests.push(req);
        return synthesize(req);
      };
      tts.state = (req) => {
        lib.requests.push(req);
        return state(req);
      };
      return tts;
    },
  };
});

/** What the relay was sent, oldest first. */
const relayed: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  vi.resetModules();
  lib.configs.length = 0;
  lib.requests.length = 0;
  relayed.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      // The browser's Edge usage report is not a relay call.
      if (url === "/api/speech/usage") return new Response(null, { status: 204 });
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      relayed.push({ url, body });
      // The cascade names the member that spoke: here, the first in the order.
      const engine = body.engine === "cascade" ? (body.order as string[])[0] : String(body.engine);
      const voices = (body.voices ?? {}) as Record<string, string>;
      const voice = body.engine === "cascade" ? voices[engine] : String(body.voice);
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "audio/mpeg", "x-anytts-engine": engine, "x-anytts-voice": voice },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function load() {
  const synth = await import("../synth");
  const voices = await import("../voices");
  const store = await import("../../../preferences/store");
  const { preferences } = await import("../../../preferences/declarations");
  return { synth, voices, store, preferences };
}

const lastRequest = (): SynthesisRequest => lib.requests.at(-1) as SynthesisRequest;
const lastConfig = (): TtsConfig => lib.configs.at(-1) as TtsConfig;

const [GEORGE] = listVoices("elevenlabs").map((voice) => voice.id);
const [, CARTESIA_SECOND] = listVoices("cartesia").map((voice) => voice.id);
const ANDREW = "en-US-AndrewMultilingualNeural";

describe("cascade requests through the speech seam", () => {
  it("a cascade request carries voices, order and pronunciation", async () => {
    const { synth, voices } = await load();
    voices.setStoredEngine("cascade");
    voices.setEngineVoice("elevenlabs", GEORGE);
    voices.setEngineVoice("edge", ANDREW);
    voices.setProjectEngineVoice("p", "cartesia", CARTESIA_SECOND);
    voices.setEnginePronunciation("elevenlabs", true);
    voices.setEnginePronunciation("edge", false);

    const voice = voices.voiceForProject("p");
    await synth.synthesizeSpeech("Zrobiłem deploy.", { voice, lang: "pl" });

    const expectedVoices = {
      elevenlabs: GEORGE,
      cartesia: CARTESIA_SECOND,
      speechify: voices.catalogDefaultVoice("speechify"),
      azure: voices.catalogDefaultVoice("azure"),
      edge: ANDREW,
    };
    // `toEqual` treats an undefined property as absent: a member whose default
    // went missing would pass silently without this guard.
    expect(Object.values(expectedVoices).every(Boolean)).toBe(true);
    const order = ["elevenlabs", "cartesia", "speechify", "azure", "edge"];
    const pronunciation = { elevenlabs: true, edge: false };
    const request = lastRequest();
    expect(request).toEqual({
      engine: "cascade",
      text: "Zrobiłem deploy.",
      lang: "pl",
      tier: "run",
      voices: expectedVoices,
      order,
      pronunciation,
    });
    expect(request.voice).toBeUndefined();

    // One relay call carries the whole walk; the text is not respelled here.
    expect(relayed).toEqual([
      {
        url: "/api/tts",
        body: {
          engine: "cascade",
          text: "Zrobiłem deploy.",
          lang: "pl",
          voices: expectedVoices,
          order,
          pronunciation,
        },
      },
    ]);
  });

  it("in cascade off is left out of order", async () => {
    const { synth, voices } = await load();
    voices.setStoredEngine("cascade");
    voices.setCascadeOrder([
      { id: "edge", on: true },
      { id: "speechify", on: false },
      { id: "elevenlabs", on: true },
      { id: "cartesia", on: true },
      { id: "azure", on: false },
    ]);

    await synth.synthesizeSpeech("hello", { voice: voices.voiceForProject(undefined), lang: "en" });

    expect(lastRequest().order).toEqual(["edge", "elevenlabs", "cartesia"]);
  });

  it("edge requests carry voice and lang", async () => {
    const { synth, voices, store, preferences } = await load();
    voices.setStoredEngine("edge");
    voices.setEngineVoice("edge", ANDREW);

    const voice = voices.voiceForProject(undefined);
    synth.speechCacheState("Zrobiłem deploy.", { voice, lang: "pl" });

    expect(lastRequest()).toEqual({ engine: "edge", text: "Zrobiłem deploy.", lang: "pl", voice: ANDREW });
    // Edge's own pronunciation switch is engine config: anytts respells per
    // engine from `lang`, never from a request field outside a cascade.
    expect(lastConfig().engines.edge).toMatchObject({ mode: "auto" });
    expect(lastConfig().engines.edge?.pronunciation).toBeUndefined();

    voices.setEnginePronunciation("edge", false);
    synth.speechCacheState("Zrobiłem deploy.", { voice, lang: "pl" });
    expect(lib.configs).toHaveLength(2);
    expect(lastConfig().engines.edge).toMatchObject({ mode: "auto", pronunciation: false });

    // Edge keeps its route modes.
    store.writePreference(preferences.speechRoute, "server");
    synth.speechCacheState("Zrobiłem deploy.", { voice, lang: "pl" });
    expect(lib.configs).toHaveLength(3);
    expect(lastConfig().engines.edge).toMatchObject({ mode: "relay", pronunciation: false });

    // The effect, not just the flag: through the relay, Polish text reaches the
    // server as written with the switch off, and respelled with it on.
    await synth.synthesizeSpeech("Zrobiłem deploy.", { voice, lang: "pl" });
    expect(relayed.at(-1)?.body.text).toBe("Zrobiłem deploy.");

    voices.setEnginePronunciation("edge", true);
    await synth.synthesizeSpeech("Zrobiłem deploy.", { voice, lang: "pl" });
    expect(relayed.at(-1)?.body.text).toBe("Zrobiłem diploj.");
  });

  it("a keyed engine always uses the relay", async () => {
    const { synth, voices } = await load();
    // Microsoft Edge: the browser the Edge engine would go direct from.
    vi.stubGlobal("navigator", {
      ...navigator,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
    });
    voices.setStoredEngine("elevenlabs");
    voices.setEngineVoice("elevenlabs", GEORGE);

    await synth.synthesizeSpeech("hello", { voice: voices.voiceForProject(undefined), lang: "en" });

    expect(lastRequest()).toMatchObject({ engine: "elevenlabs", text: "hello", lang: "en", voice: GEORGE });
    expect(relayed).toEqual([{ url: "/api/tts", body: { engine: "elevenlabs", text: "hello", voice: GEORGE } }]);
    for (const id of ["elevenlabs", "cartesia", "speechify", "azure", "cascade"]) {
      expect(lastConfig().engines[id]).toMatchObject({ relayUrl: "/api/tts" });
      expect(lastConfig().engines[id]).not.toHaveProperty("mode");
    }
  });
});
