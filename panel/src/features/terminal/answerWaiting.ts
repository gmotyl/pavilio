/**
 * Whether a cell is still waiting for the reply to a draft it sent — kept
 * OUTSIDE React, keyed by session, for the life of the tab.
 *
 * The same reason `answerPaneState.ts` gives: `TerminalView` is remounted by
 * every layout change — maximize swaps the grid for a fullscreen stack, presets
 * and drag placement rebuild it — so a wait held in component state would end
 * the moment the user resized the cell they had just written into.
 *
 * ## The state machine
 *
 * `waiting` is the body's handover: the pane shows that a reply is on its way
 * instead of the previous answer, which would otherwise read as the reply.
 * `pending` is the fact underneath it, and outlives it by one event: pressing a
 * transport control takes the body back to the text without pretending the
 * reply arrived, so the mark moves to the bar's play button and the wait shrinks
 * rather than ending.
 *
 * Three events end it outright, and every one of them is something that
 * HAPPENED:
 *
 * - a new utterance arrives for the cell — the reply, or at least an answer,
 * - the session's activity state transitions to `idle` — an agent that finished
 *   without speaking, which is the exit that makes this shippable at all,
 * - the session is destroyed.
 *
 * **No timer decides any of it.** The activity state is the server's, broadcast
 * on the terminal-activity channel for the activity dot, so the third exit is
 * as authoritative as the first — not a guess about how long an agent ought to
 * take. The subscription is opened here, by `beginWaiting`, rather than by a
 * mounted pane: the wait survives the pane being closed, so the thing that ends
 * it has to as well.
 *
 * ## What it never touches
 *
 * Nothing in this module reaches the speech host. Entering the waiting state is
 * a fact about the BODY; the voice goes on reading whatever it was reading and
 * the bar's scrubber goes on advancing, because nothing here enqueues, stops,
 * pauses or seeks anything.
 */
import { useSyncExternalStore } from "react";
import {
  type ActivityState,
  getActivityState,
  subscribeActivity,
} from "./useTerminalActivityChannel";

export interface AnswerWaitingSnapshot {
  /** The pane's body has handed over to the waiting state. */
  readonly waiting: boolean;
  /**
   * A reply is still expected. True for as long as the wait lasts — including
   * after a transport press has taken the body back to the answer, which is
   * what keeps the mark on the play button.
   */
  readonly pending: boolean;
}

/** The shared "nothing is pending here" snapshot — one object, so a cell with no
 *  entry hands `useSyncExternalStore` the same reference every read. */
const SETTLED: AnswerWaitingSnapshot = Object.freeze({ waiting: false, pending: false });

const BODY_HANDED_OVER: AnswerWaitingSnapshot = Object.freeze({ waiting: true, pending: true });

const MARK_ONLY: AnswerWaitingSnapshot = Object.freeze({ waiting: false, pending: true });

interface Entry {
  snapshot: AnswerWaitingSnapshot;
  /**
   * The id of the utterance under the cursor when the draft was sent. Any other
   * id is a new answer, and ends the wait.
   */
  sentOn: string | null;
  /** The last activity state seen; a CHANGE into `idle` is the silent-agent exit. */
  activity: ActivityState;
  /** The activity subscription opened for this wait. */
  unsubscribe: () => void;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function drop(sessionId: string): void {
  const entry = entries.get(sessionId);
  if (!entry) return;
  entry.unsubscribe();
  entries.delete(sessionId);
}

/** The wait is over: the body goes back to the answer and the mark goes out. */
function settle(sessionId: string): void {
  if (!entries.has(sessionId)) return;
  drop(sessionId);
  notify();
}

/**
 * A draft has just gone to the PTY. `sentOn` is the utterance the cursor was on
 * at that moment — the one the body would otherwise keep showing as if it were
 * the reply.
 */
export function beginWaiting(sessionId: string, sentOn: string | null): void {
  drop(sessionId);
  const entry: Entry = {
    snapshot: BODY_HANDED_OVER,
    sentOn,
    activity: getActivityState(sessionId),
    unsubscribe: () => {},
  };
  entries.set(sessionId, entry);
  // Opened after the entry is in the map: the listener settles it by looking
  // itself up, and a synchronous first call would otherwise find nothing.
  entry.unsubscribe = subscribeActivity(sessionId, (state) => {
    const current = entries.get(sessionId);
    if (!current || state === current.activity) return;
    current.activity = state;
    // The transition, not the reading: a session that was already idle when the
    // draft went out has not FINISHED anything, and ending the wait on that
    // would mean the state never showed at all.
    if (state === "idle") settle(sessionId);
  });
  notify();
}

/**
 * The utterance under the cell's cursor, as the pane renders it. A different id
 * than the one the draft was sent on is the reply landing.
 */
export function noteUtterance(sessionId: string, utteranceId: string | null): void {
  const entry = entries.get(sessionId);
  if (!entry || utteranceId === entry.sentOn) return;
  settle(sessionId);
}

/**
 * A transport control was pressed while a reply was pending. The body goes back
 * to the answer — the user asked for the text, and holding it hostage to a wait
 * they did not ask about is the wrong trade — but the reply is still coming, so
 * the mark stays on the play button.
 */
export function noteTransport(sessionId: string): void {
  const entry = entries.get(sessionId);
  if (!entry || !entry.snapshot.waiting) return;
  entry.snapshot = MARK_ONLY;
  notify();
}

/** Drops the session's wait, and the activity subscription holding it open. */
export function forgetAnswerWaiting(sessionId: string): void {
  settle(sessionId);
}

export function getAnswerWaiting(sessionId: string): AnswerWaitingSnapshot {
  return entries.get(sessionId)?.snapshot ?? SETTLED;
}

export function subscribeAnswerWaiting(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The session's `{ waiting, pending }`, re-rendering the caller when either changes. */
export function useAnswerWaiting(sessionId: string): AnswerWaitingSnapshot {
  return useSyncExternalStore(
    subscribeAnswerWaiting,
    () => getAnswerWaiting(sessionId),
    () => getAnswerWaiting(sessionId),
  );
}

export function __resetAnswerWaitingForTests(): void {
  for (const sessionId of [...entries.keys()]) drop(sessionId);
  notify();
}
