/**
 * The speech feature's per-browser preferences: the picked voice — vendored from
 * motyl's `lib/tts/voices.ts` with the Polish-only voices dropped — and the
 * armed cell.
 *
 * The picked voice ALWAYS wins: nothing here consults
 * {@link import("./pronunciation").voteLanguage} or the per-session language
 * it feeds through {@link import("./pronunciation").nextLanguageState}, and
 * neither ever switches a voice. That split is only safe because every offered
 * voice is multilingual — a voice that reads both Polish and English — so "a
 * Polish voice reads an English answer" cannot arise. Do not add a
 * single-language voice to this list.
 */

// One source of truth, in the lower layer: the preference registry declares
// this value as `speech.voice`'s default. Re-exported so this module's
// existing importers are untouched. The import points DOWN — registry →
// feature would be the direction that closes a cycle.
import { DEFAULT_SPEECH_VOICE, preferences } from "../../preferences/declarations";
import { clearPreference, readPreference, writePreference } from "../../preferences/store";

export { DEFAULT_SPEECH_VOICE };

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
 * The voice, now a PORTABLE preference: which voice reads an answer is a choice
 * about the panel, not a fact about this machine, so it travels in the
 * workspace file. The guarded `getBrowserStorage()` accessor this module used
 * to export is gone with it — the store owns every try/catch around browser
 * storage now, and a wrapper the guard cannot see is exactly the evasion
 * `no-direct-storage.test.ts` documents.
 *
 * `resolveVoice` still sits on the way out. The declaration's codec is `str`
 * (the voice list is long enough that a codec would have to duplicate it), so
 * a stale or hand-edited id reaches here intact and is mapped onto a real voice
 * at this boundary, exactly as before.
 */
export function getStoredVoice(): SpeechVoiceId {
  return resolveVoice(readPreference(preferences.speechVoice));
}

/**
 * Stores `id` and returns the voice now in effect; an unknown id is ignored.
 *
 * The return value is still what the caller should hold: a page whose portable
 * document never arrived has its write dropped by the store, and the choice
 * then applies to this page only — the same contract the old
 * "storage unavailable" branch offered.
 */
export function setStoredVoice(id: string): SpeechVoiceId {
  if (!isSpeechVoice(id)) return getStoredVoice();
  writePreference(preferences.speechVoice, id);
  return id;
}

/**
 * The armed cell — the one session allowed to speak on its own. Exclusive: at
 * most one id is ever stored, so two windows each keep their own armed cell.
 *
 * `portable: false`, and this is the declaration where that matters most: the
 * value is a LIVE SESSION ID. Carried to another machine in the workspace file
 * it would arm a cell that does not exist there, and it would put a fact about
 * one browser window into a file every window reads. It stays in
 * `localStorage`, which is where it already was.
 */
export function getStoredArmedSession(): string | null {
  const stored = readPreference(preferences.speechArmedCell);
  // A blank id is not an armed cell. Kept from the raw implementation: the
  // codec round-trips `""` faithfully, so the normalization has to stay.
  return stored && stored.trim() !== "" ? stored : null;
}

/**
 * Stores the armed session and returns the one now in effect; `null` — or a
 * blank id — disarms. The return value is what the caller should hold, so
 * arming still takes effect for this page when storage is unavailable.
 */
export function setStoredArmedSession(sessionId: string | null): string | null {
  const armed = sessionId && sessionId.trim() !== "" ? sessionId : null;
  // Disarming CLEARS rather than storing `null`, mirroring the `removeItem`
  // this replaces: "no armed cell" is the absence of a value, not a value.
  if (armed) writePreference(preferences.speechArmedCell, armed);
  else clearPreference(preferences.speechArmedCell);
  return armed;
}
