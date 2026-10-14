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
      if (dirty) {
        dirty = false;
        void load();
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
}

export function subscribeGitStatus(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    attach();
    requestGitStatusRefresh();
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
  generation += 1;
}
