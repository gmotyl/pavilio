/**
 * The speech voice preference, vendored from motyl's `lib/tts/voices.ts` with
 * the Polish-only voices dropped.
 *
 * The picked voice ALWAYS wins: nothing here consults
 * {@link import("./pronunciation").detectLanguage}, and detection never
 * switches a voice. That split is only safe because every offered voice is
 * multilingual — a voice that reads both Polish and English — so "a Polish
 * voice reads an English answer" cannot arise. Do not add a single-language
 * voice to this list.
 */

export const DEFAULT_SPEECH_VOICE = "en-US-AndrewMultilingualNeural";

/** Per-browser preference: the panel has one user and no server-side profile. */
export const SPEECH_VOICE_STORAGE_KEY = "panel-speech-voice";

export const SPEECH_VOICES = [
  {
    id: "en-US-AndrewMultilingualNeural",
    label: "Andrew (multilingual · EN-US)",
  },
  {
    id: "en-AU-WilliamMultilingualNeural",
    label: "William (multilingual · EN-AU)",
  },
  {
    id: "en-US-EmmaMultilingualNeural",
    label: "Emma (multilingual · EN-US)",
  },
  {
    id: "en-US-AvaMultilingualNeural",
    label: "Ava (multilingual · EN-US)",
  },
  {
    id: "en-US-BrianMultilingualNeural",
    label: "Brian (multilingual · EN-US)",
  },
  {
    id: "de-DE-SeraphinaMultilingualNeural",
    label: "Seraphina (multilingual · DE)",
  },
  {
    id: "de-DE-FlorianMultilingualNeural",
    label: "Florian (multilingual · DE)",
  },
  {
    id: "fr-FR-VivienneMultilingualNeural",
    label: "Vivienne (multilingual · FR)",
  },
  {
    id: "fr-FR-RemyMultilingualNeural",
    label: "Remy (multilingual · FR)",
  },
  {
    id: "it-IT-GiuseppeMultilingualNeural",
    label: "Giuseppe (multilingual · IT)",
  },
] as const;

export type SpeechVoiceId = (typeof SPEECH_VOICES)[number]["id"];

const supportedVoices = new Set<string>(SPEECH_VOICES.map((voice) => voice.id));

export function isSpeechVoice(value: string | null | undefined): value is SpeechVoiceId {
  return typeof value === "string" && supportedVoices.has(value);
}

/** Maps anything — a stale id, a dropped Polish voice, `null` — onto a real voice. */
export function resolveVoice(value: string | null | undefined): SpeechVoiceId {
  return isSpeechVoice(value) ? value : DEFAULT_SPEECH_VOICE;
}

/**
 * Reading `window.localStorage` itself throws when site data is blocked, so the
 * accessor is guarded separately from the get/set calls.
 */
function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getStoredVoice(): SpeechVoiceId {
  const storage = getBrowserStorage();
  if (!storage) return DEFAULT_SPEECH_VOICE;

  try {
    return resolveVoice(storage.getItem(SPEECH_VOICE_STORAGE_KEY));
  } catch {
    return DEFAULT_SPEECH_VOICE;
  }
}

/** Stores `id` and returns the voice now in effect; an unknown id is ignored. */
export function setStoredVoice(id: string): SpeechVoiceId {
  if (!isSpeechVoice(id)) return getStoredVoice();

  try {
    getBrowserStorage()?.setItem(SPEECH_VOICE_STORAGE_KEY, id);
  } catch {
    // The preference stays usable for this page when storage is unavailable.
  }

  return id;
}
