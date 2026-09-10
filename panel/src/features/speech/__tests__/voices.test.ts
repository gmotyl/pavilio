import { describe, expect, it, vi } from "vitest";
import { detectLanguage } from "../pronunciation";
import {
  DEFAULT_SPEECH_VOICE,
  SPEECH_VOICES,
  SPEECH_VOICE_STORAGE_KEY,
  getStoredVoice,
  setStoredVoice,
} from "../voices";

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
  });

  it("falls back to Andrew when storage throws or holds an unknown id", () => {
    localStorage.setItem(SPEECH_VOICE_STORAGE_KEY, "pl-PL-MarekNeural");
    expect(getStoredVoice()).toBe(DEFAULT_SPEECH_VOICE);

    localStorage.setItem(SPEECH_VOICE_STORAGE_KEY, "not-a-voice");
    expect(getStoredVoice()).toBe(DEFAULT_SPEECH_VOICE);

    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("site data blocked");
    });
    expect(getStoredVoice()).toBe(DEFAULT_SPEECH_VOICE);

    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("site data blocked");
    });
    expect(() => setStoredVoice("en-US-EmmaMultilingualNeural")).not.toThrow();
  });
});

describe("detectLanguage", () => {
  it("detectLanguage returns a language, not a voice id", () => {
    const polish = "To jest odpowiedź agenta, ale nie wiem czy to zadziała dla tego przypadku.";
    const english = "The panel keeps the latest utterance for each session and speaks it aloud.";

    expect(detectLanguage(polish)).toBe("pl");
    expect(detectLanguage(english)).toBe("en");

    // Detection gates the pronunciation map and nothing else: it must never
    // name a voice, and it must never displace the user's pick.
    const ids = voiceIds();
    expect(ids).not.toContain(detectLanguage(polish));
    expect(ids).not.toContain(detectLanguage(english));
    expect(detectLanguage(polish)).not.toBe("pl-PL-MarekNeural");
    expect(getStoredVoice()).toBe(DEFAULT_SPEECH_VOICE);
  });
});
