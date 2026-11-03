/**
 * The OpenAI-compatible engine's live voices in the browser: what the OmniVoice server lists,
 * read through the panel server's `GET /api/speech/openai/voices`.
 *
 * A module-level store, not per-component state: every voice select, the settings boundary
 * (`voices.ts`, through `voicesOf`) and the anytts seam (`synth.ts`) read the same list, so a
 * `reload()` after an add or a delete reaches all of them without a page reload. A mounting hook
 * joins a load already in flight; `reload()` always asks again, and only the latest answer lands.
 *
 * The list starts empty and stays so until the first load: no openai voice can be picked, every
 * stored one reads as stale, and the seam lets the panel server pick the voice. Stale is a READ:
 * every write goes through the raw preference, so a saved voice survives until the list lands.
 * `TerminalSpeechHost` primes the list at app level ({@link usePrimeOpenaiVoices}), and a
 * render-time voice reader subscribes ({@link useOpenaiVoicesSnapshot}) so it re-reads then.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { OmniVoiceInfo } from "./openaiVoices";

const OPENAI_VOICES_URL = "/api/speech/openai/voices";

export interface OpenaiVoices {
  /** The server's voices; the last good list while it is unreachable, empty with no address. */
  voices: readonly OmniVoiceInfo[];
  /** The panel server could not reach the OmniVoice server on the last load. */
  unreachable: boolean;
  /** Workspace voice copies the server does not have (the empty-state hint). */
  workspaceOnly: number;
  /** A route answer has landed: until then an empty list means "not asked yet", not "none". */
  loaded: boolean;
  /**
   * The last load got no usable answer from the panel server itself (no answer, an error status,
   * an unreadable body): the list shown is the last good one, and only a reload can fix it.
   */
  failed: boolean;
}

const INITIAL: OpenaiVoices = { voices: [], unreachable: false, workspaceOnly: 0, loaded: false, failed: false };

// Replaced, never mutated: `useSyncExternalStore` compares snapshots by identity.
let state: OpenaiVoices = INITIAL;
let inFlight: Promise<void> | null = null;
let generation = 0;
const listeners = new Set<() => void>();

function publish(next: OpenaiVoices): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

function isVoice(value: unknown): value is OmniVoiceInfo {
  const voice = value as Partial<OmniVoiceInfo> | null;
  return (
    voice !== null &&
    typeof voice === "object" &&
    typeof voice.id === "string" &&
    voice.id !== "" &&
    typeof voice.locale === "string"
  );
}

/**
 * Only the `VoiceInfo` fields: anything else the server adds to a record (`ref_text`, a
 * description) would change the seam's instance key, rebuild anytts and empty the audio cache.
 */
function toStoredVoice({ id, label, locale, gender, multilingual, source }: OmniVoiceInfo): OmniVoiceInfo {
  return { id, label, locale, gender, multilingual, source };
}

/** The last list kept, the load marked done and failed: a Retry can show instead of "Loading…". */
function failedState(): OpenaiVoices {
  return { ...state, loaded: true, failed: true };
}

/** The state a route answer leads to. */
async function stateFrom(res: Response): Promise<OpenaiVoices> {
  // The OmniVoice server is down: the panel server's catalog keeps its last list, and so does this.
  if (res.status === 502) return { ...state, unreachable: true, loaded: true, failed: false };
  // No address: the panel server has no openai engine, so there is nothing to pick.
  if (res.status === 409) return { ...INITIAL, loaded: true };
  if (!res.ok) return failedState();
  const body = (await res.json().catch(() => null)) as Partial<OpenaiVoices> | null;
  if (!body || !Array.isArray(body.voices)) return failedState();
  return {
    voices: body.voices.filter(isVoice).map(toStoredVoice),
    unreachable: body.unreachable === true,
    workspaceOnly: typeof body.workspaceOnly === "number" ? body.workspaceOnly : 0,
    loaded: true,
    failed: false,
  };
}

async function load(): Promise<void> {
  const mine = ++generation;
  try {
    const next = await stateFrom(await fetch(OPENAI_VOICES_URL));
    if (mine === generation) publish(next);
  } catch {
    // The panel server itself did not answer: keep the list shown, and say so.
    if (mine === generation) publish(failedState());
  }
}

function startLoad(): Promise<void> {
  const loading = load().finally(() => {
    if (inFlight === loading) inFlight = null;
  });
  inFlight = loading;
  return loading;
}

/** Fetches the list again (after an add or a delete); resolves once the answer has landed. */
export function reloadOpenaiVoices(): Promise<void> {
  return startLoad();
}

/** The last loaded list, for readers outside React (`voicesOf`, `synth.ts`). */
export function currentOpenaiVoices(): readonly OmniVoiceInfo[] {
  return state.voices;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): OpenaiVoices {
  return state;
}

/** Drops all shared state. Tests only: the store is a page-lifetime singleton. */
export function __resetOpenaiVoicesForTests(): void {
  state = INITIAL;
  inFlight = null;
  generation++;
  listeners.clear();
}

/**
 * The live list, loaded when the caller mounts (or turns `active` on); `reload()` after an add or a
 * delete. A caller that may not show the openai engine passes `active: false` while it does not, so
 * it asks the server for nothing.
 */
export function useOpenaiVoices(active = true): OpenaiVoices & { reload: () => Promise<void> } {
  const snapshot = useOpenaiVoicesSnapshot();
  usePrimeOpenaiVoices(active);
  return { ...snapshot, reload: reloadOpenaiVoices };
}

/** A window focus while the last load found the OmniVoice server down (or failed) asks again. */
function reloadIfUnreachable(): void {
  if ((state.unreachable || state.failed) && !inFlight) void startLoad();
}

/**
 * Loads the list when the caller mounts (or turns `active` on), without subscribing to it: the
 * app-level primer, so a saved openai voice is known after a page reload without Settings open.
 * While the server is unreachable, coming back to the window loads it again (the panel server
 * retries on its own, so a server started meanwhile has usually answered by then).
 */
export function usePrimeOpenaiVoices(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    // Several callers mount together: they share one request.
    void (inFlight ?? startLoad());
    window.addEventListener("focus", reloadIfUnreachable);
    return () => window.removeEventListener("focus", reloadIfUnreachable);
  }, [active]);
}

/**
 * The store's snapshot, subscribed: a component that resolves a voice during render (through
 * `voices.ts`, which reads {@link currentOpenaiVoices}) calls it so it re-renders when the list
 * lands or changes. Loads nothing.
 */
export function useOpenaiVoicesSnapshot(): OpenaiVoices {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
