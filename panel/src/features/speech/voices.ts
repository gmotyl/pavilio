/**
 * The speech feature's per-browser preferences: the picked voice — vendored from
 * motyl's `lib/tts/voices.ts` with the Polish-only voices dropped — and each
 * cell's speech mode.
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
// Points DOWN too: sessionProject reaches only the session store and the
// preference types, neither of which imports a speech module.
import { projectOfSession } from "../terminal/sessionProject";
import type { SpeechMode } from "./types";

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
 * The project's own voice, or `null` when it follows the default. A stale or
 * hand-edited id reads as `null` — the record's codec is plain `json`, so this
 * is the boundary that drops it, as `resolveVoice` is for the default.
 */
export function getProjectVoice(project: string): SpeechVoiceId | null {
  const stored = readPreference(preferences.speechVoiceByProject);
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return null;
  const id: unknown = Object.hasOwn(stored, project) ? stored[project] : null;
  return typeof id === "string" && isSpeechVoice(id) ? id : null;
}

/** Sets the project's voice; `null` DELETES the entry, so it follows the default. */
export function setProjectVoice(project: string, id: SpeechVoiceId | null): void {
  if (project.trim() === "") return;
  const stored = readPreference(preferences.speechVoiceByProject);
  const next: Record<string, string> =
    stored !== null && typeof stored === "object" && !Array.isArray(stored) ? { ...stored } : {};
  if (id === null) delete next[project];
  else if (isSpeechVoice(id)) next[project] = id;
  else return;
  writePreference(preferences.speechVoiceByProject, next);
}

/** The voice a project speaks with: its own, else the default voice. */
export function voiceForProject(project: string | undefined): SpeechVoiceId {
  return (project ? getProjectVoice(project) : null) ?? getStoredVoice();
}

/**
 * The voice a cell speaks with, through the project its session belongs to;
 * a session the tab cannot place gets the default voice.
 */
export function voiceForSession(sessionId: string): SpeechVoiceId {
  return voiceForProject(projectOfSession(sessionId) ?? undefined);
}

/** One click on a cell's speech control: `off → armed → autoplay → off`. */
export function nextSpeechMode(mode: SpeechMode): SpeechMode {
  if (mode === "off") return "armed";
  if (mode === "armed") return "autoplay";
  return "off";
}

/** Only the two stored modes; `off` is the absence of an entry, never a value. */
function isStoredMode(value: unknown): value is Exclude<SpeechMode, "off"> {
  return value === "armed" || value === "autoplay";
}

/**
 * Every cell's speech mode in this browser — `sessionId → mode`, with no entry
 * for a cell that is `off`. Not exclusive: any number of cells may be in
 * `autoplay`.
 *
 * `portable: false`, for the reason the armed id it replaces was: every key is
 * a LIVE SESSION ID, which would name cells that do not exist on another
 * machine and put a fact about one browser into a file every window reads.
 *
 * Migration: while the record has never been written (`null`), a legacy armed
 * id reads as that one cell in `autoplay` — which is what "armed" used to mean.
 * The first {@link setStoredSpeechMode} writes the record and clears the
 * legacy value, so it is never consulted again.
 */
export function getStoredSpeechModes(): Readonly<Record<string, SpeechMode>> {
  const stored = readPreference(preferences.speechModes);
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
    // A blank id is not an armed cell: the legacy codec round-trips `""`.
    const legacy = stored === null ? readPreference(preferences.speechArmedCell) : null;
    return legacy && legacy.trim() !== "" ? { [legacy]: "autoplay" } : {};
  }
  // A hand-edited or stale record keeps only the entries that mean something.
  const modes: Record<string, SpeechMode> = {};
  for (const [sessionId, mode] of Object.entries(stored)) {
    if (sessionId.trim() !== "" && isStoredMode(mode)) modes[sessionId] = mode;
  }
  return modes;
}

/**
 * Sets one cell's mode and returns the whole record now in effect; `off`
 * DELETES the entry. The return value is what the caller should hold, so a
 * change still takes effect for this page when storage is unavailable.
 */
export function setStoredSpeechMode(
  sessionId: string,
  mode: SpeechMode,
): Readonly<Record<string, SpeechMode>> {
  const current = getStoredSpeechModes();
  if (sessionId.trim() === "") return current;
  const next: Record<string, SpeechMode> = { ...current };
  if (mode === "off") delete next[sessionId];
  else next[sessionId] = mode;
  writePreference(preferences.speechModes, next);
  // The record now exists, so the legacy id has been carried over — and
  // clearing it keeps a stale id from resurfacing if the record is ever lost.
  clearPreference(preferences.speechArmedCell);
  return next;
}
