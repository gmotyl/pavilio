/**
 * The speech feature's per-browser preferences: the engine and the picked
 * voice — both over anytts' catalog — and each cell's speech mode.
 *
 * The picked voice ALWAYS wins: nothing here consults
 * {@link import("./language").voteLanguage} or the per-session language
 * it feeds through {@link import("./language").nextLanguageState}, and
 * neither ever switches a voice. A single-language voice therefore reads every
 * answer in its own language; the Settings help text says so, and the
 * multilingual voices are grouped first for that reason.
 */

import { listVoices } from "anytts";
// One source of truth, in the lower layer: the preference registry declares
// this value as `speech.voice`'s default. Re-exported so this module's
// existing importers are untouched. The import points DOWN — registry →
// feature would be the direction that closes a cycle.
import { DEFAULT_SPEECH_VOICE, preferences } from "../../preferences/declarations";
import { clearPreference, readPreference, writePreference } from "../../preferences/store";
import { projectOfDocKey } from "./docKey";
import { speechEngines } from "./engines";
import { resolveSpeechVoice } from "./synth";
import type { SpeechMode } from "./types";

export { DEFAULT_SPEECH_VOICE };

/**
 * The seam's configured engines are the one list: an engine anytts lists but
 * the panel does not configure would make `resolveVoice` and `synthesize`
 * throw RangeError, so it is as unknown here as a typo.
 */
function isKnownEngine(id: string): boolean {
  return speechEngines().includes(id);
}

/**
 * The engine that synthesizes, from `speech.engine`. The codec is `str`, so a
 * blank or stale id arrives intact; anything the seam does not configure reads
 * as the declared default, because handing it on would make anytts throw.
 */
export function getStoredEngine(): string {
  const stored = readPreference(preferences.speechEngine);
  return isKnownEngine(stored) ? stored : preferences.speechEngine.default;
}

/** Stores `id` and returns the engine now in effect; an engine the seam does not configure is ignored. */
export function setStoredEngine(id: string): string {
  if (isKnownEngine(id)) writePreference(preferences.speechEngine, id);
  // Read back rather than echo `id`: a dropped write (no document) leaves the
  // old engine in effect, and synthesis reads the stored one.
  return getStoredEngine();
}

function isCatalogVoice(engine: string, id: unknown): id is string {
  return typeof id === "string" && listVoices(engine).some((voice) => voice.id === id);
}

/**
 * Maps a stored default voice onto a voice of the current engine: a catalog
 * voice is kept, anything else goes through the seam's lenient
 * `resolveSpeechVoice`, which answers the engine default with `fellBack`.
 *
 * Read-only. The catalog check comes first so the common case — a valid pick —
 * never builds the anytts instance and never reaches the seam, which a render
 * path may call on every frame.
 */
export function resolveStoredVoice(stored: string): { voice: string; fellBack: boolean } {
  const engine = getStoredEngine();
  if (isCatalogVoice(engine, stored)) return { voice: stored, fellBack: false };
  return resolveSpeechVoice({ engine, voice: stored });
}

/**
 * The voice, now a PORTABLE preference: which voice reads an answer is a choice
 * about the panel, not a fact about this machine, so it travels in the
 * workspace file. The store owns every try/catch around browser storage.
 *
 * The declaration's codec is `str`, so a stale or hand-edited id reaches here
 * intact. It is resolved onto the engine default and, when it fell back, the
 * effective voice is WRITTEN BACK — so the stale id is replaced once, and a
 * strict `unknown-voice` rejection never sees it.
 *
 * NEVER CALL THIS DURING RENDER. The write notifies every `speech.voice`
 * subscriber synchronously, which from a render is a setState on a sibling
 * mid-render plus a PATCH. Render paths read {@link defaultVoice}; the
 * Settings picker writes back from a mount effect and from its engine handler.
 */
export function getStoredVoice(): string {
  const { voice, fellBack } = resolveStoredVoice(readPreference(preferences.speechVoice));
  if (fellBack) writePreference(preferences.speechVoice, voice);
  return voice;
}

/**
 * Stores `id` and returns the voice now in effect; an id outside the engine's
 * catalog is ignored.
 *
 * The return value is what the caller should hold, and it is read back from
 * the store rather than echoed: a page whose portable document never arrived
 * has its write dropped, the player goes on reading the stored voice, and a
 * control showing the attempted one would claim a choice that never applied.
 */
export function setStoredVoice(id: string): string {
  if (isCatalogVoice(getStoredEngine(), id)) writePreference(preferences.speechVoice, id);
  return getStoredVoice();
}

/**
 * The project's own voice, or `null` when it follows the default. A project
 * voice is a voice of the global engine: an id outside its catalog reads as
 * `null` — the record's codec is plain `json`, so this is the boundary that
 * drops it, and the project inherits the default.
 */
export function getProjectVoice(project: string): string | null {
  const stored = readPreference(preferences.speechVoiceByProject);
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return null;
  const id: unknown = Object.hasOwn(stored, project) ? stored[project] : null;
  return isCatalogVoice(getStoredEngine(), id) ? id : null;
}

/** Sets the project's voice; `null` DELETES the entry, so it follows the default. */
export function setProjectVoice(project: string, id: string | null): void {
  if (project.trim() === "") return;
  if (id !== null && !isCatalogVoice(getStoredEngine(), id)) return;
  const stored = readPreference(preferences.speechVoiceByProject);
  const others = Object.entries(
    stored !== null && typeof stored === "object" && !Array.isArray(stored) ? stored : {},
  ).filter(([key]) => key !== project);
  // Built by `fromEntries`, which defines its keys: an assignment would hand a
  // project named `__proto__` to the prototype setter and drop the write.
  const next: Record<string, string> = Object.fromEntries(
    id === null ? others : [...others, [project, id]],
  );
  writePreference(preferences.speechVoiceByProject, next);
}

/** The default voice in effect, resolved read-only — safe on a render path. */
function defaultVoice(): string {
  return resolveStoredVoice(readPreference(preferences.speechVoice)).voice;
}

/**
 * The voice a project speaks with: its own, else the default voice. Read-only:
 * the answer pane and the control bar call it during render, through the
 * terminal's `voiceForSession`.
 */
export function voiceForProject(project: string | undefined): string {
  return (project ? getProjectVoice(project) : null) ?? defaultVoice();
}

/**
 * The voice a page speaks with: the voice of the project its `doc:` key's path
 * lives in, else the default — a file outside projects has no project. The one
 * rule both the host's `voiceFor` port and the document bar read, so the bar
 * peeks the cache in the voice the host synthesized in.
 */
export function voiceForDocKey(key: string): string {
  return voiceForProject(projectOfDocKey(key) ?? undefined);
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
