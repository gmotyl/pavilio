import { describe, expect, it } from "vitest";
import { INITIAL_LANGUAGE_STATE, nextLanguageState, voteLanguage } from "../pronunciation";
import {
  DEFAULT_SPEECH_VOICE,
  SPEECH_VOICES,
  getStoredVoice,
  setStoredVoice,
} from "../voices";
import { preferences } from "../../../preferences/declarations";
import { storageKey } from "../../../preferences/types";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

/** The picked voice is a PORTABLE preference: the document, never localStorage. */
const VOICE_KEY = storageKey(preferences.speechVoice);

const voiceIds = (): string[] => SPEECH_VOICES.map((voice) => voice.id);

describe("SPEECH_VOICES", () => {
  it("offers multilingual voices only", () => {
    const ids = voiceIds();

    expect(ids).toHaveLength(10);
    expect(ids).not.toContain("pl-PL-MarekNeural");
    expect(ids).not.toContain("pl-PL-ZofiaNeural");
    // Multilingual-only is what makes the language/voice split safe: every
    // offered voice reads both languages, so a Polish voice can never be handed
    // an English answer.
    for (const id of ids) expect(id).toContain("Multilingual");
  });
});

describe("getStoredVoice", () => {
  it("defaults to Andrew when nothing is stored", () => {
    expect(DEFAULT_SPEECH_VOICE).toBe("en-US-AndrewMultilingualNeural");
    expect(getStoredVoice()).toBe("en-US-AndrewMultilingualNeural");

    expect(setStoredVoice("en-US-EmmaMultilingualNeural")).toBe("en-US-EmmaMultilingualNeural");
    expect(getStoredVoice()).toBe("en-US-EmmaMultilingualNeural");
    expect(globals.__PAVILIO_PREFS__![VOICE_KEY]).toBe("en-US-EmmaMultilingualNeural");
    expect(localStorage.length).toBe(0);
  });

  it("falls back to Andrew for a dropped voice, an unknown id, and no document", () => {
    // `resolveVoice` is still the boundary: the declaration's codec is `str`,
    // so a dropped Polish voice and a plain nonsense id both arrive intact and
    // are mapped onto a real voice here.
    globals.__PAVILIO_PREFS__![VOICE_KEY] = "pl-PL-MarekNeural";
    expect(getStoredVoice()).toBe(DEFAULT_SPEECH_VOICE);

    globals.__PAVILIO_PREFS__![VOICE_KEY] = "not-a-voice";
    expect(getStoredVoice()).toBe(DEFAULT_SPEECH_VOICE);

    // The auth interlock stands in for the old "site data blocked" case: this
    // page received no document, so the read answers the default and the write
    // is dropped without throwing.
    delete globals.__PAVILIO_PREFS__;
    expect(getStoredVoice()).toBe(DEFAULT_SPEECH_VOICE);
    expect(() => setStoredVoice("en-US-EmmaMultilingualNeural")).not.toThrow();
    expect(setStoredVoice("en-US-EmmaMultilingualNeural")).toBe("en-US-EmmaMultilingualNeural");
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
