/**
 * The pocket engines' workspace voices in the browser: the voice copies the panel server lists
 * through `GET /api/speech/pocket/voices` (`{ voices, cloning }`). The presets ship with anytts,
 * so a failed load costs nothing but the workspace voices: the lists fall back to presets and
 * nothing throws.
 *
 * A module-level store like {@link useOpenaiVoices}: `voicesOf` (settings boundary, voice pickers,
 * the language reader) and the hook share one list, a mounting hook joins a load in flight, and
 * `reload()` always asks again with only the latest answer landing.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { VoiceInfo } from "anytts";

const POCKET_VOICES_URL = "/api/speech/pocket/voices";

/** A workspace voice as the route lists it. */
export interface PocketWorkspaceVoice {
  id: string;
  label: string;
  gender?: "female" | "male";
  version: number;
}

export interface PocketVoices {
  /** The workspace voices; empty until the first answer and after a failed load. */
  voices: readonly PocketWorkspaceVoice[];
  /** Whether the pocket engine may use workspace voices (`pocket` only; `pocket-pl` always may). */
  cloning: boolean;
  /** A route answer (or a failure) has landed. */
  loaded: boolean;
}

const INITIAL: PocketVoices = { voices: [], cloning: true, loaded: false };

// Replaced, never mutated: `useSyncExternalStore` compares snapshots by identity.
let state: PocketVoices = INITIAL;
let inFlight: Promise<void> | null = null;
let generation = 0;
const listeners = new Set<() => void>();

function publish(next: PocketVoices): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

function isVoice(value: unknown): value is PocketWorkspaceVoice {
  const voice = value as Partial<PocketWorkspaceVoice> | null;
  return voice !== null && typeof voice === "object" && typeof voice.id === "string" && voice.id !== "";
}

function toStoredVoice({ id, label, gender, version }: PocketWorkspaceVoice): PocketWorkspaceVoice {
  const voice: PocketWorkspaceVoice = { id, label: typeof label === "string" && label !== "" ? label : id, version };
  if (gender === "female" || gender === "male") voice.gender = gender;
  return voice;
}

/** Presets only: what a failed or unusable answer leaves. */
const PRESETS_ONLY: PocketVoices = { voices: [], cloning: false, loaded: true };

async function stateFrom(res: Response): Promise<PocketVoices> {
  if (!res.ok) return PRESETS_ONLY;
  const body = (await res.json().catch(() => null)) as { voices?: unknown; cloning?: unknown } | null;
  if (!body || !Array.isArray(body.voices)) return PRESETS_ONLY;
  return { voices: body.voices.filter(isVoice).map(toStoredVoice), cloning: body.cloning === true, loaded: true };
}

async function load(): Promise<void> {
  const mine = ++generation;
  let next = PRESETS_ONLY;
  try {
    next = await stateFrom(await fetch(POCKET_VOICES_URL));
  } catch {
    // The panel server did not answer: presets only.
  }
  if (mine === generation) publish(next);
}

function startLoad(): Promise<void> {
  const loading = load().finally(() => {
    if (inFlight === loading) inFlight = null;
  });
  inFlight = loading;
  return loading;
}

/** Fetches the list again; resolves once the answer has landed. Never rejects. */
export function reloadPocketVoices(): Promise<void> {
  return startLoad();
}

/**
 * The workspace voices of `engine` as catalog entries, for readers outside React (`voicesOf`):
 * `pocket` gets them in en-US only while cloning is on, `pocket-pl` always, in pl-PL.
 */
export function currentPocketWorkspaceVoices(engine: "pocket" | "pocket-pl"): readonly VoiceInfo[] {
  if (engine === "pocket" && !state.cloning) return [];
  const locale = engine === "pocket" ? "en-US" : "pl-PL";
  // anytts types `gender` as required, but a workspace voice may have none: left absent, not guessed.
  return state.voices.map(
    ({ id, label, gender }) => ({ id, label, locale, ...(gender ? { gender } : {}), multilingual: false }) as VoiceInfo,
  );
}

/**
 * The workspace voices the instance's pocket engines are configured with, as the route listed them:
 * anytts checks a voice against its catalog, so a saved voice the instance was not given would be
 * refused. `pocket` gets none while cloning is off.
 */
export function currentPocketCustomVoices(engine: "pocket" | "pocket-pl"): readonly PocketWorkspaceVoice[] {
  return engine === "pocket" && !state.cloning ? [] : state.voices;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PocketVoices {
  return state;
}

/** Drops all shared state. Tests only: the store is a page-lifetime singleton. */
export function __resetPocketVoicesForTests(): void {
  state = INITIAL;
  inFlight = null;
  generation++;
  listeners.clear();
}

/** The store's snapshot, subscribed: a render-time voice reader re-renders when the list lands. */
export function usePocketVoicesSnapshot(): PocketVoices {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Loads the list when the caller mounts (or turns `active` on), without subscribing to it. */
export function usePrimePocketVoices(active: boolean): void {
  useEffect(() => {
    if (active) void (inFlight ?? startLoad());
  }, [active]);
}

/** The live list, loaded when the caller mounts (or turns `active` on); `reload()` after a change. */
export function usePocketVoices(active = true): PocketVoices & { reload: () => Promise<void> } {
  const snapshot = usePocketVoicesSnapshot();
  usePrimePocketVoices(active);
  return { ...snapshot, reload: reloadPocketVoices };
}
