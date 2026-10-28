import { describe, expect, it, vi } from "vitest";
import { listEngines, listVoices } from "anytts";

/**
 * anytts lists an engine the seam does not configure: the settings boundary
 * must treat it as unknown, or it would reach `resolveVoice` and throw.
 */
vi.mock("anytts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("anytts")>();
  return {
    ...actual,
    listEngines: () => [
      ...actual.listEngines(),
      { id: "unconfigured", label: "Unconfigured engine", runtimes: ["browser"] },
    ],
  };
});
import { INITIAL_LANGUAGE_STATE, nextLanguageState, voteLanguage } from "../language";
import {
  DEFAULT_SPEECH_VOICE,
  getStoredEngine,
  getStoredVoice,
  setStoredEngine,
  setStoredVoice,
} from "../voices";
import { preferences } from "../../../preferences/declarations";
import { storageKey } from "../../../preferences/types";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

/** The picked voice is a PORTABLE preference: the document, never localStorage. */
const VOICE_KEY = storageKey(preferences.speechVoice);
const ENGINE_KEY = storageKey(preferences.speechEngine);

const voiceIds = (): string[] => listVoices("edge").map((voice) => voice.id);

describe("getStoredVoice", () => {
  it("defaults to Vivienne when nothing is stored", () => {
    expect(DEFAULT_SPEECH_VOICE).toBe("fr-FR-VivienneMultilingualNeural");
    expect(getStoredVoice()).toBe("fr-FR-VivienneMultilingualNeural");

    expect(setStoredVoice("en-US-EmmaMultilingualNeural")).toBe("en-US-EmmaMultilingualNeural");
    expect(getStoredVoice()).toBe("en-US-EmmaMultilingualNeural");
    expect(globals.__PAVILIO_PREFS__![VOICE_KEY]).toEqual({ edge: "en-US-EmmaMultilingualNeural" });
    expect(localStorage.length).toBe(0);
  });

  it("keeps any voice of the engine's catalog, single-language ones included", () => {
    // The multilingual-only invariant is gone: the catalog is anytts', and a
    // Polish voice is a voice of the edge engine like any other.
    expect(voiceIds()).toContain("pl-PL-MarekNeural");
    expect(setStoredVoice("pl-PL-MarekNeural")).toBe("pl-PL-MarekNeural");
    expect(getStoredVoice()).toBe("pl-PL-MarekNeural");
  });

  it("a stale stored voice falls back to the engine default and is written back", () => {
    // The declaration's codec checks only the shape, so a dropped or hand-edited
    // id arrives intact (an old bare string reads as Edge's) and is resolved
    // through the seam's `resolveSpeechVoice` here.
    globals.__PAVILIO_PREFS__![VOICE_KEY] = "xx-XX-NobodyNeural";
    expect(getStoredVoice()).toBe(DEFAULT_SPEECH_VOICE);
    expect(globals.__PAVILIO_PREFS__![VOICE_KEY]).toEqual({ edge: DEFAULT_SPEECH_VOICE });

    globals.__PAVILIO_PREFS__![VOICE_KEY] = "";
    expect(getStoredVoice()).toBe(DEFAULT_SPEECH_VOICE);
    expect(globals.__PAVILIO_PREFS__![VOICE_KEY]).toEqual({ edge: DEFAULT_SPEECH_VOICE });

    // An id outside the catalog is ignored by the setter.
    expect(setStoredVoice("not-a-voice")).toBe(DEFAULT_SPEECH_VOICE);
    expect(globals.__PAVILIO_PREFS__![VOICE_KEY]).toEqual({ edge: DEFAULT_SPEECH_VOICE });

    // The auth interlock stands in for the old "site data blocked" case: this
    // page received no document, so the read answers the default and the write
    // is dropped without throwing. The setter answers what is now in effect —
    // the stored default the player will synthesize with, not the attempt.
    delete globals.__PAVILIO_PREFS__;
    expect(getStoredVoice()).toBe(DEFAULT_SPEECH_VOICE);
    expect(() => setStoredVoice("en-US-EmmaMultilingualNeural")).not.toThrow();
    expect(setStoredVoice("en-US-EmmaMultilingualNeural")).toBe(DEFAULT_SPEECH_VOICE);
  });
});

describe("getStoredEngine", () => {
  it("defaults to edge and keeps an engine anytts lists", () => {
    expect(getStoredEngine()).toBe("edge");
    expect(listEngines().map((engine) => engine.id)).toContain("edge");

    expect(setStoredEngine("edge")).toBe("edge");
    expect(globals.__PAVILIO_PREFS__![ENGINE_KEY]).toBe("edge");
    expect(getStoredEngine()).toBe("edge");
  });

  it("an engine anytts does not list reads as the default engine", () => {
    // A blank or stale engine reaching anytts would throw RangeError from
    // `resolveVoice` and from `synthesize`; the boundary answers the default.
    for (const stale of ["", "not-an-engine", "Edge"]) {
      globals.__PAVILIO_PREFS__![ENGINE_KEY] = stale;
      expect(getStoredEngine()).toBe("edge");
      globals.__PAVILIO_PREFS__![VOICE_KEY] = "xx-XX-NobodyNeural";
      expect(getStoredVoice()).toBe(DEFAULT_SPEECH_VOICE);
    }

    // The setter ignores an unknown engine rather than storing it.
    globals.__PAVILIO_PREFS__![ENGINE_KEY] = "edge";
    expect(setStoredEngine("not-an-engine")).toBe("edge");
    expect(globals.__PAVILIO_PREFS__![ENGINE_KEY]).toBe("edge");
  });

  it("an engine anytts lists but the seam does not configure reads as the default", () => {
    expect(listEngines().map((engine) => engine.id)).toContain("unconfigured");

    globals.__PAVILIO_PREFS__![ENGINE_KEY] = "unconfigured";
    expect(getStoredEngine()).toBe("edge");
    globals.__PAVILIO_PREFS__![VOICE_KEY] = "xx-XX-NobodyNeural";
    expect(() => getStoredVoice()).not.toThrow();
    expect(getStoredVoice()).toBe(DEFAULT_SPEECH_VOICE);

    globals.__PAVILIO_PREFS__![ENGINE_KEY] = "edge";
    expect(setStoredEngine("unconfigured")).toBe("edge");
    expect(globals.__PAVILIO_PREFS__![ENGINE_KEY]).toBe("edge");
  });
});

describe("language detection", () => {
  it("returns a language, not a voice id", () => {
    const polish = "To jest odpowiedź agenta, ale nie wiem czy to zadziała dla tego przypadku.";
    const english = "The panel keeps the latest utterance for each session and speaks it aloud.";

    expect(voteLanguage(polish)).toBe("pl");
    expect(voteLanguage(english)).toBe("en");

    // The session's language is the accumulated verdict, and it is still a
    // language: `pl` / `en`, never something the picker could offer.
    const spoken = [polish, polish].map(voteLanguage).reduce(nextLanguageState, INITIAL_LANGUAGE_STATE);
    expect(spoken.lang).toBe("pl");

    // Detection gates the pronunciation map and nothing else: it must never
    // name a voice, and it must never displace the user's pick.
    const ids = voiceIds();
    expect(ids).not.toContain(voteLanguage(polish));
    expect(ids).not.toContain(voteLanguage(english));
    expect(ids).not.toContain(spoken.lang);
    expect(voteLanguage(polish)).not.toBe("pl-PL-MarekNeural");
    expect(getStoredVoice()).toBe(DEFAULT_SPEECH_VOICE);
  });
});
