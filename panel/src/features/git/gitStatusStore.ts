import { subscribeRealtime } from "../realtime/channel";
import { subscribeActivityTransitions } from "../terminal/useTerminalActivityChannel";

export interface GitFile {
  status: string;
  path: string;
}

export interface GitStatusSnapshot {
  files: GitFile[];
}

/**
 * One tab-wide `/api/git/status` reader shared by every `useGitStatus()` consumer.
 * Mounted per component, each consumer used to fetch on its own and again on every
 * activity event while a session sat in `attention`, so the sidebar flooded the
 * network. Here triggers are edges only (a realtime frame, a transition *into*
 * `attention`), and triggers that arrive mid-request coalesce into one trailing
 * fetch.
 *
 * The snapshot keeps its identity until a fetch succeeds, because
 * `useSyncExternalStore` compares snapshots by identity.
 */
const EMPTY: GitStatusSnapshot = Object.freeze({ files: [] as GitFile[] });

let snapshot: GitStatusSnapshot = EMPTY;
const listeners = new Set<() => void>();
let inFlight = false;
let dirty = false;
// Set once the store stayed detached past the tick it detached in, so realtime
// triggers may have gone unheard. A StrictMode resubscribe in the same tick never
// sets it.
let missedTriggers = false;
let detachRealtime: (() => void) | null = null;
let detachTransitions: (() => void) | null = null;
// Bumped by the test reset so a fetch from a previous test cannot land in the next.
let generation = 0;

function notify(): void {
  for (const l of [...listeners]) l();
}

async function load(): Promise<void> {
  const gen = generation;
  inFlight = true;
  try {
    const res = await fetch("/api/git/status");
    if (res.ok) {
      const files = (await res.json()) as GitFile[];
      if (gen === generation) {
        snapshot = { files };
        notify();
      }
    }
  } catch {
    // Keep the previous snapshot; the next trigger retries.
  } finally {
    if (gen === generation) {
      inFlight = false;
      // With no consumer left, nobody would read the trailing result.
      if (dirty) {
        dirty = false;
        if (listeners.size > 0) void load();
      }
    }
  }
}

export function requestGitStatusRefresh(): void {
  if (inFlight) {
    dirty = true;
    return;
  }
  void load();
}

function attach(): void {
  detachRealtime = subscribeRealtime((frame) => {
    if (frame.type === "file-change" || frame.type === "git-change") requestGitStatusRefresh();
  });
  detachTransitions = subscribeActivityTransitions((_sessionId, _prev, next) => {
    if (next === "attention") requestGitStatusRefresh();
  });
}

function detach(): void {
  detachRealtime?.();
  detachTransitions?.();
  detachRealtime = null;
  detachTransitions = null;
  const gen = generation;
  queueMicrotask(() => {
    if (gen === generation && listeners.size === 0) missedTriggers = true;
  });
}

export function subscribeGitStatus(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    attach();
    // An in-flight fetch is fresh enough for a StrictMode resubscribe (same tick).
    // After a real detach it may predate unheard changes, so a trailing fetch follows.
    if (!inFlight) requestGitStatusRefresh();
    else if (missedTriggers) dirty = true;
    missedTriggers = false;
  }
  return () => {
    if (!listeners.delete(listener)) return;
    // The snapshot is kept, so a later consumer renders the last files at once.
    if (listeners.size === 0) detach();
  };
}

export function getGitStatusSnapshot(): GitStatusSnapshot {
  return snapshot;
}

/** Drop all shared state. Tests only. */
export function __resetGitStatusStoreForTests(): void {
  detach();
  listeners.clear();
  snapshot = EMPTY;
  inFlight = false;
  dirty = false;
  missedTriggers = false;
  generation += 1;
}
