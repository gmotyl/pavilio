/**
 * The answer pane's per-session state, kept OUTSIDE React.
 *
 * `TerminalView` is remounted by every layout change: maximize swaps the grid
 * for a fullscreen stack (a different body subtree, so React unmounts every
 * cell), and presets, drag placement and seam resize go through the same
 * grid. The xterm survives that only because `terminalInstances` keeps it in
 * a module-level pool; pane state held in component state died with the view
 * (smoke test, 2026-09-16: MAX closed the pane). So the three things the view
 * used to own — whether the pane is open, the cell's own "Open on new answer"
 * switch, and the utterance ids the cell has already seen — live here, keyed
 * by session, for the life of the tab.
 *
 * In memory on purpose: a reload starts every pane closed, as the spec asks. A
 * session that is destroyed drops its entry (see `destroyTerminal`).
 *
 * `useAnswerPaneState` reads through `useSyncExternalStore`, so a snapshot is
 * referentially stable between changes — replaced only when a value actually
 * changes, never rebuilt per read — the same rule `GridSpeech.subscribeProgress`
 * documents in `features/speech/types.ts`.
 */
import { useSyncExternalStore } from "react";
import { getStoredAutoOpenAnswer } from "../speech/autoOpenAnswer";

export interface AnswerPaneSnapshot {
  /** Whether the cell's pane is open. */
  readonly open: boolean;
  /**
   * The cell's own "Open on new answer" switch. Seeded ONCE, from the
   * browser-wide default Settings keeps, when the session's entry is first
   * created; never written back to that default. A cell flipped mid-session
   * keeps its choice, and the default changing later reaches only sessions
   * first seen afterwards.
   */
  readonly autoOpen: boolean;
}

interface Entry {
  snapshot: AnswerPaneSnapshot;
  /**
   * Every utterance id the queue has shown this cell; `null` until the first
   * `markSeenUtterances`, which seeds it silently — the utterance the server
   * hands a fresh tab is old news, not an answer to the question just asked.
   */
  seen: Set<string> | null;
  /**
   * The pane is open ONLY to stand in for an answer that does not exist yet —
   * a launcher press opened it to show the wave, and there is nothing behind
   * that wave.
   *
   * It is the one fact that tells {@link closeAnswerPaneOpenedForWait} a pane
   * it may close from a pane it may not, and it is kept HERE rather than in
   * `TerminalView` for the reason the rest of this module exists: the view is
   * remounted by every layout change, so a flag held in it would be lost by a
   * maximize made mid-boot and the pane would then stay open over the terminal
   * for the rest of the tab's life.
   *
   * It is deliberately NOT part of {@link AnswerPaneSnapshot}: nothing renders
   * differently for it, and widening the snapshot would make a pane that only
   * changed WHY it is open publish a change to every subscriber.
   */
  openedForWait: boolean;
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
      snapshot: { open: false, autoOpen: getStoredAutoOpenAnswer() },
      seen: null,
      openedForWait: false,
    };
    entries.set(sessionId, entry);
  }
  return entry;
}

/** The session's snapshot, creating a default entry on first access. */
export function getAnswerPaneState(sessionId: string): AnswerPaneSnapshot {
  return entryFor(sessionId).snapshot;
}

export function setAnswerPaneOpen(sessionId: string, open: boolean): void {
  const entry = entryFor(sessionId);
  // Whoever calls this is deciding the pane's state outright — the eye, Escape,
  // the bar going away, an answer landing on a cell whose switch is on — and
  // that takes the pane out of the launcher press's hands. Cleared BEFORE the
  // no-change return below, because the commonest case of this is precisely a
  // caller asking for `true` on a pane the press has already opened: the state
  // does not change, and the REASON does.
  entry.openedForWait = false;
  if (entry.snapshot.open === open) return;
  entry.snapshot = { ...entry.snapshot, open };
  notify();
}

/**
 * Open the pane to stand in for an answer that does not exist yet — the user
 * has pressed a launcher pill, and the wave is what the cell has to show for
 * it until the agent speaks.
 *
 * Unlike {@link setAnswerPaneOpen} this records WHY the pane is open, so that
 * {@link closeAnswerPaneOpenedForWait} can put it back exactly as it found it
 * if the agent finishes without ever saying anything.
 *
 * A pane that is ALREADY open is left entirely alone, mark included. It is
 * open for reasons of its own — the user's eye, an answer that landed — and a
 * press is not a licence to close it again afterwards.
 */
export function openAnswerPaneForWait(sessionId: string): void {
  const entry = entryFor(sessionId);
  if (entry.snapshot.open) return;
  entry.openedForWait = true;
  entry.snapshot = { ...entry.snapshot, open: true };
  notify();
}

/**
 * The pane has something behind the wave now, so it is no longer the press's
 * to close: an answer has landed for this cell.
 *
 * Only the mark moves — the pane's open state is untouched, because whether an
 * arrival OPENS a closed pane is the auto-open switch's question and is
 * answered elsewhere. A no-op for a pane no press opened.
 */
export function keepAnswerPaneOpen(sessionId: string): void {
  const entry = entries.get(sessionId);
  if (!entry) return;
  entry.openedForWait = false;
}

/**
 * Close a pane that was opened only to show a wave, now that the wave is gone.
 *
 * A no-op for every other pane, which is the point of the mark: the user's own
 * eye press and a pane showing a real answer both survive this untouched.
 */
export function closeAnswerPaneOpenedForWait(sessionId: string): void {
  const entry = entries.get(sessionId);
  if (!entry || !entry.openedForWait) return;
  entry.openedForWait = false;
  if (!entry.snapshot.open) return;
  entry.snapshot = { ...entry.snapshot, open: false };
  notify();
}

export function setAnswerPaneAutoOpen(sessionId: string, autoOpen: boolean): void {
  const entry = entryFor(sessionId);
  if (entry.snapshot.autoOpen === autoOpen) return;
  entry.snapshot = { ...entry.snapshot, autoOpen };
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

/** The session's `{ open, autoOpen }`, re-rendering the caller when either changes. */
export function useAnswerPaneState(sessionId: string): AnswerPaneSnapshot {
  return useSyncExternalStore(
    subscribeAnswerPane,
    () => getAnswerPaneState(sessionId),
    () => getAnswerPaneState(sessionId),
  );
}
