/**
 * The speech feature's preferences: the engine, one picked voice per engine —
 * globally and per project, all over anytts' catalog — the cascade order, the
 * per-engine pronunciation switch, and each cell's speech mode.
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
import {
  DEFAULT_CASCADE_ORDER,
  DEFAULT_SPEECH_VOICE,
  preferences,
  type CascadeEntry,
  type EngineVoices,
} from "../../preferences/declarations";
import { clearPreference, readPreference, writePreference } from "../../preferences/store";
import { projectOfDocKey } from "./docKey";
import { CASCADE, cascadeVoiceKey, getCascadeOrder, speechEngines } from "./engines";
import { resolveSpeechVoice } from "./synth";
import type { SpeechMode } from "./types";

export { DEFAULT_SPEECH_VOICE, getCascadeOrder };
export type { CascadeEntry, EngineVoices };

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

/** `value` as a record, or `{}`: the hand-editable records below may hold anything. */
function asRecord<T>(value: unknown): Readonly<Record<string, T>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, T>)
    : {};
}

/** The entries of `voices` that are voices of their engine's catalog: stale ids dropped. */
function catalogVoices(voices: unknown): EngineVoices {
  return Object.fromEntries(
    Object.entries(asRecord<unknown>(voices)).filter(
      (entry): entry is [string, string] => isCatalogVoice(entry[0], entry[1]),
    ),
  );
}

/**
 * The voice `engine` speaks with when nothing is picked for it: anytts'
 * default for the engine as the seam configures it (Edge's is
 * {@link DEFAULT_SPEECH_VOICE}). `undefined` for an engine without voices of
 * its own (`cascade`) and for one the seam does not configure — the seam's
 * `resolveVoice` would throw RangeError for it, and a request that names no
 * voice gets the same default from anytts on the server anyway.
 */
export function catalogDefaultVoice(engine: string): string | undefined {
  if (!isKnownEngine(engine) || listVoices(engine).length === 0) return undefined;
  return resolveSpeechVoice({ engine }).voice;
}

/**
 * Maps a stored `speech.voice` record onto a voice of `engine` (default: the
 * current engine): a catalog voice is kept, anything else goes through the
 * seam's lenient `resolveSpeechVoice`, which answers the engine default with
 * `fellBack`. An engine with no entry resolves to its default WITHOUT
 * `fellBack` — nothing stale was stored.
 *
 * Read-only. The catalog check comes first so the common case — a valid pick —
 * never builds the anytts instance and never reaches the seam, which a render
 * path may call on every frame.
 *
 * `cascade` has no single voice (anytts throws asking it for one): it resolves
 * to `""`, never fallen back — its voices are its members'.
 */
export function resolveStoredVoice(
  stored: Readonly<EngineVoices>,
  engine: string = getStoredEngine(),
): { voice: string; fellBack: boolean } {
  if (engine === CASCADE) return { voice: "", fellBack: false };
  const picked: unknown = Object.hasOwn(asRecord(stored), engine) ? stored[engine] : undefined;
  if (isCatalogVoice(engine, picked)) return { voice: picked, fellBack: false };
  return resolveSpeechVoice({ engine, voice: typeof picked === "string" ? picked : undefined });
}

/** `stored` with `engine`'s entry set to `id`, or deleted for `null`. */
function withVoice(stored: unknown, engine: string, id: string | null): EngineVoices {
  // Built by `fromEntries`, which defines its keys: an assignment would hand a
  // key named `__proto__` to the prototype setter and drop the write.
  const others = Object.entries(asRecord<string>(stored)).filter(([key]) => key !== engine);
  return Object.fromEntries(id === null ? others : [...others, [engine, id]]);
}

/** Every engine's default voice as stored, stale ids dropped. Read-only. */
export function getStoredVoices(): EngineVoices {
  return catalogVoices(readPreference(preferences.speechVoice));
}

/**
 * Sets `engine`'s default voice; `null` DELETES the entry, so the engine
 * speaks with its catalog default. An id outside the engine's catalog is
 * ignored. The other engines' entries are kept.
 */
export function setEngineVoice(engine: string, id: string | null): void {
  if (id !== null && !isCatalogVoice(engine, id)) return;
  writePreference(
    preferences.speechVoice,
    withVoice(readPreference(preferences.speechVoice), engine, id),
  );
}

/**
 * The project's own voice per engine, stale ids dropped — `{}` when the project
 * follows the default for every engine. The record's codec checks only the
 * shape, so this is the boundary that drops an id outside its engine's catalog.
 */
export function getProjectVoices(project: string): EngineVoices {
  const stored = asRecord<unknown>(readPreference(preferences.speechVoiceByProject));
  return catalogVoices(Object.hasOwn(stored, project) ? stored[project] : undefined);
}

/**
 * Sets the project's voice for `engine`; `null` DELETES that engine's entry,
 * and a project left with no entry is deleted too, so it follows the default.
 * An id outside the engine's catalog, or a blank project, is ignored.
 */
export function setProjectEngineVoice(project: string, engine: string, id: string | null): void {
  if (project.trim() === "") return;
  if (id !== null && !isCatalogVoice(engine, id)) return;
  const stored = asRecord<unknown>(readPreference(preferences.speechVoiceByProject));
  const voices = withVoice(Object.hasOwn(stored, project) ? stored[project] : undefined, engine, id);
  // `fromEntries` again, so a project named `__proto__` is an ordinary entry.
  const others = Object.entries(stored).filter(([key]) => key !== project) as [string, EngineVoices][];
  writePreference(
    preferences.speechVoiceByProject,
    Object.fromEntries(Object.keys(voices).length === 0 ? others : [...others, [project, voices]]),
  );
}

/**
 * The project's own voice for the current engine, or `null` when it follows
 * the default. An id outside the engine's catalog reads as `null`, and the
 * project inherits the default.
 */
export function getProjectVoice(project: string): string | null {
  return getProjectVoices(project)[getStoredEngine()] ?? null;
}

/** Sets the project's voice for the current engine; `null` DELETES it, so it follows the default. */
export function setProjectVoice(project: string, id: string | null): void {
  setProjectEngineVoice(project, getStoredEngine(), id);
}

/**
 * The voice `engine` speaks with in `project`:
 * `voiceByProject[project][engine] ?? voice[engine] ?? <engine's catalog default>`,
 * a stale id dropped at each step. `undefined` only where
 * {@link catalogDefaultVoice} has no default (`cascade`, an unconfigured
 * engine) and nothing valid is stored. Read-only — safe on a render path.
 */
export function voiceFor(engine: string, project?: string): string | undefined {
  return (
    (project ? getProjectVoices(project)[engine] : undefined) ??
    getStoredVoices()[engine] ??
    catalogDefaultVoice(engine)
  );
}

/**
 * The voice a project speaks with on the current engine: its own, else the
 * default voice. Under the cascade it is every member's {@link voiceFor} the
 * project, as one {@link cascadeVoiceKey} the seam opens into the request's
 * `voices`. Read-only: the answer pane and the control bar call it during
 * render, through the terminal's `voiceForSession`.
 */
export function voiceForProject(project: string | undefined): string {
  const engine = getStoredEngine();
  if (engine === CASCADE) {
    const voices: Record<string, string> = {};
    for (const member of DEFAULT_CASCADE_ORDER) {
      const voice = voiceFor(member, project);
      if (voice !== undefined) voices[member] = voice;
    }
    return cascadeVoiceKey(voices);
  }
  return (
    (project ? getProjectVoices(project)[engine] : undefined) ??
    resolveStoredVoice(readPreference(preferences.speechVoice), engine).voice
  );
}

/** Stores `order` (repaired as `getCascadeOrder` reads it) and returns the order now in effect. */
export function setCascadeOrder(order: readonly CascadeEntry[]): CascadeEntry[] {
  writePreference(
    preferences.speechCascadeOrder,
    order.map((entry) => ({ id: entry.id, on: entry.on })),
  );
  return getCascadeOrder();
}

/**
 * Per-engine pronunciation as stored — `{}` until something is switched, and
 * an engine with no entry keeps anytts' own default (Edge on, the others off).
 */
export function getPronunciationByEngine(): Readonly<Record<string, boolean>> {
  return readPreference(preferences.speechPronunciationByEngine);
}

/** Switches pronunciation for `engine`; `null` DELETES the entry, back to anytts' default. */
export function setEnginePronunciation(engine: string, on: boolean | null): void {
  const others = Object.entries(readPreference(preferences.speechPronunciationByEngine)).filter(
    ([key]) => key !== engine,
  );
  writePreference(
    preferences.speechPronunciationByEngine,
    Object.fromEntries(on === null ? others : [...others, [engine, on]]),
  );
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
