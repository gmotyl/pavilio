/**
 * The answer pane's per-session state, kept OUTSIDE React.
 *
 * `TerminalView` is remounted by every layout change: maximize swaps the grid
 * for a fullscreen stack (a different body subtree, so React unmounts every
 * cell), and presets, drag placement and seam resize go through the same
 * grid. The xterm survives that only because `terminalInstances` keeps it in
 * a module-level pool; pane state held in component state died with the view
 * (smoke test, 2026-09-16: MAX closed the pane). So the two things the view
 * used to own — whether the pane is open, and the utterance ids the cell has
 * already seen — live here, keyed by session, for the life of the tab.
 *
 * The "Open on new answer" preference is NOT held here: the view reads it from
 * Settings at arrival, so a change there reaches a cell that already exists.
 *
 * In memory on purpose: a reload starts every pane closed, as the spec asks. A
 * session that is destroyed drops its entry (see `destroyTerminal`).
 *
 * A pane can also be HIDDEN BY CHOICE: the user closed it (the eye or
 * Alt+Shift+O, both `byUser`), and new answers do not reopen it until the user
 * shows it again. A close that is not the user's — hiding the speech bar —
 * neither sets nor clears it. In memory like the rest: a reload forgets it.
 *
 * `useAnswerPaneState` reads through `useSyncExternalStore`, so a snapshot is
 * referentially stable between changes — replaced only when a value actually
 * changes, never rebuilt per read — the same rule `GridSpeech.subscribeProgress`
 * documents in `features/speech/types.ts`.
 */
import { useSyncExternalStore } from "react";

export interface AnswerPaneSnapshot {
  /** Whether the cell's pane is open. */
  readonly open: boolean;
  /** The user closed the pane; arrivals do not reopen it until the user shows it. */
  readonly hiddenByChoice: boolean;
}

interface Entry {
  snapshot: AnswerPaneSnapshot;
  /**
   * Every utterance id the queue has shown this cell; `null` until the first
   * `markSeenUtterances`, which seeds it silently — the utterance the server
   * hands a fresh tab is old news, not an answer to the question just asked.
   */
  seen: Set<string> | null;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function entryFor(sessionId: string): Entry {
  let entry = entries.get(sessionId);
  if (!entry) {
    entry = {
      snapshot: { open: false, hiddenByChoice: false },
      seen: null,
    };
    entries.set(sessionId, entry);
  }
  return entry;
}

/** The session's snapshot, creating a default entry on first access. */
export function getAnswerPaneState(sessionId: string): AnswerPaneSnapshot {
  return entryFor(sessionId).snapshot;
}

/**
 * Opens or closes the session's pane. `byUser` marks the user's own toggle:
 * a user close sets `hiddenByChoice`, a user open clears it; any other write
 * leaves the flag as it was.
 */
export function setAnswerPaneOpen(
  sessionId: string,
  open: boolean,
  opts?: { byUser?: boolean },
): void {
  const entry = entryFor(sessionId);
  const hiddenByChoice = opts?.byUser ? !open : entry.snapshot.hiddenByChoice;
  if (entry.snapshot.open === open && entry.snapshot.hiddenByChoice === hiddenByChoice) return;
  entry.snapshot = { open, hiddenByChoice };
  notify();
}

/**
 * Records `ids` as seen and returns the ones that were NOT seen before — the
 * arrivals. The first call for a session seeds the set and reports nothing.
 * No listener is notified: the seen set is not part of the snapshot.
 */
export function markSeenUtterances(sessionId: string, ids: readonly string[]): string[] {
  const entry = entryFor(sessionId);
  if (!entry.seen) {
    entry.seen = new Set(ids);
    return [];
  }
  const arrived: string[] = [];
  for (const id of ids) {
    if (entry.seen.has(id)) continue;
    entry.seen.add(id);
    arrived.push(id);
  }
  return arrived;
}

export function subscribeAnswerPane(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Drops the session's entry; the next read is a fresh default. */
export function forgetAnswerPane(sessionId: string): void {
  if (!entries.delete(sessionId)) return;
  notify();
}

/** The session's `{ open, hiddenByChoice }`, re-rendering the caller when it changes. */
export function useAnswerPaneState(sessionId: string): AnswerPaneSnapshot {
  return useSyncExternalStore(
    subscribeAnswerPane,
    () => getAnswerPaneState(sessionId),
    () => getAnswerPaneState(sessionId),
  );
}

/**
 * Whether ANY of the listed sessions has its pane open.
 *
 * Read with a plain `entries.get`, never {@link entryFor}: a session that has
 * never been given a pane is not open, and asking the question must not be
 * what CREATES its entry — `TerminalsSurface` calls this over its whole
 * session list on every render, and most of those sessions may never have
 * had a cell mounted for them yet.
 */
export function anyAnswerPaneOpen(sessionIds: readonly string[]): boolean {
  return sessionIds.some((id) => entries.get(id)?.snapshot.open ?? false);
}

/** {@link anyAnswerPaneOpen}, re-rendering the caller whenever any pane opens or closes. */
export function useAnyAnswerPaneOpen(sessionIds: readonly string[]): boolean {
  return useSyncExternalStore(
    subscribeAnswerPane,
    () => anyAnswerPaneOpen(sessionIds),
    () => anyAnswerPaneOpen(sessionIds),
  );
}
