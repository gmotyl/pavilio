/**
 * Whether a cell's pane is showing that work is in flight instead of showing
 * the last answer — kept OUTSIDE React, keyed by session, for the life of the
 * tab.
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
 * There are TWO triggers, and they are independent:
 *
 * - **a draft was sent** (`beginWaiting`) — the body hands over at once,
 * - **the session went busy** — the agent started working on its own.
 *
 * `pending` belongs to the first of them only: it is the mark that says *the
 * reply to what you sent has not landed yet*, and an agent working on nothing
 * you asked for has not been asked anything. The wave on the body already says
 * the session is busy; a mark on the play button as well would be the same fact
 * told twice, in a place that means something narrower.
 *
 * Three events end a SEND wait outright, and every one of them is something
 * that HAPPENED:
 *
 * - a new utterance arrives for the cell — the reply, or at least an answer,
 * - the session's activity state transitions to `idle` — an agent that finished
 *   without speaking, which is the exit that makes this shippable at all,
 * - the session is destroyed.
 *
 * The activity trigger ends with the activity itself: the body is the agent's
 * for as long as the agent is busy.
 *
 * ## Why the two triggers differ on playback
 *
 * A send is a decision to move on — you typed, you pressed Enter, the previous
 * answer is behind you. The voice keeps reading, but the body switches at once,
 * because that is what you asked for.
 *
 * An agent going busy is NOT your decision. If the voice is reading when it
 * happens, the answer on screen is the one you are listening to, and taking it
 * away pulls the text out from under a sentence you are halfway through
 * hearing. So that trigger is **deferred**: armed at the transition, and
 * released when the playback ends — or dropped unused if the agent finishes
 * first, because then there is nothing left to wait for.
 *
 * **No timer decides any of it.** The activity state is the server's, broadcast
 * on the terminal-activity channel for the activity dot, so the silent-agent
 * exit is as authoritative as the arrival of an answer — not a guess about how
 * long an agent ought to take. The subscription is opened per SESSION rather
 * than per send: the second trigger has to see a session go busy when nobody
 * sent anything, and a wait outlives the pane being closed, so the thing that
 * ends it has to as well. `terminalInstances` opens the watch with the session
 * and `forgetAnswerWaiting` drops it when the session is destroyed.
 *
 * ## What it never touches
 *
 * Nothing in this module reaches the speech host. Entering the waiting state is
 * a fact about the BODY; the voice goes on reading whatever it was reading and
 * the bar's scrubber goes on advancing, because nothing here enqueues, stops,
 * pauses or seeks anything.
 *
 * That holds for the deferral too, which needs to know whether the voice is
 * reading. It does not go and ask: `noteSpeaking` is PUSHED in by the surface
 * that already holds the host as a prop, exactly as `beginWaiting`,
 * `noteUtterance` and `noteTransport` are. Every arrow into this module points
 * the same way, and the module's own imports stay {react, the activity
 * channel} — a read of the speech host would be a coupling just as surely as a
 * command would.
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
   * A reply to a draft this cell sent is still expected. True for as long as
   * that wait lasts — including after a transport press has taken the body back
   * to the answer, which is what keeps the mark on the play button.
   */
  readonly pending: boolean;
}

/** The shared "nothing is pending here" snapshot — one object, so a cell with no
 *  entry hands `useSyncExternalStore` the same reference every read. */
const SETTLED: AnswerWaitingSnapshot = Object.freeze({ waiting: false, pending: false });

const BODY_HANDED_OVER: AnswerWaitingSnapshot = Object.freeze({ waiting: true, pending: true });

const MARK_ONLY: AnswerWaitingSnapshot = Object.freeze({ waiting: false, pending: true });

/** The agent took the body on its own account: no draft of yours is outstanding. */
const AGENT_HAS_THE_BODY: AnswerWaitingSnapshot = Object.freeze({
  waiting: true,
  pending: false,
});

interface Entry {
  /**
   * The outstanding draft: the id of the utterance under the cursor when it was
   * sent — any other id is a new answer, and ends the wait — or `null` for a
   * session with no draft in flight.
   */
  send: { sentOn: string | null } | null;
  /** A transport press took the body back while the send wait was still live. */
  markOnly: boolean;
  /** The last activity state seen; a CHANGE into `idle` is the silent-agent exit. */
  activity: ActivityState;
  /** Whether this cell's voice is reading, as the speech surface last said. */
  speaking: boolean;
  /**
   * The session went busy mid-sentence, so its handover is waiting for that
   * playback to end. Armed at the transition and at no other moment: a
   * handover already made is not undone by a later playback starting.
   */
  deferred: boolean;
  snapshot: AnswerWaitingSnapshot;
  /** The activity subscription opened for this session. */
  unsubscribe: () => void;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** What the entry's facts add up to, as one of the four shared snapshots. */
function derive(entry: Entry): AnswerWaitingSnapshot {
  const sendHasTheBody = entry.send !== null && !entry.markOnly;
  const agentHasTheBody = entry.activity === "busy" && !entry.deferred;
  if (entry.send !== null) return sendHasTheBody || agentHasTheBody ? BODY_HANDED_OVER : MARK_ONLY;
  return agentHasTheBody ? AGENT_HAS_THE_BODY : SETTLED;
}

/** Re-reads the entry and tells the pane only when the snapshot actually moved. */
function publish(sessionId: string): void {
  const entry = entries.get(sessionId);
  if (!entry) return;
  const next = derive(entry);
  if (next === entry.snapshot) return;
  entry.snapshot = next;
  notify();
}

function onActivity(sessionId: string, state: ActivityState): void {
  const entry = entries.get(sessionId);
  // The transition, not the reading: a server re-broadcast of the state a
  // session was already in has neither started nor finished anything.
  if (!entry || state === entry.activity) return;
  entry.activity = state;
  if (state === "busy") {
    // Mid-sentence: hold the text until the sentence is over. Silent: take the
    // body now.
    entry.deferred = entry.speaking;
  } else {
    // Nothing left to defer to — and for `idle`, nothing left to wait for.
    entry.deferred = false;
    if (state === "idle") {
      entry.send = null;
      entry.markOnly = false;
    }
  }
  publish(sessionId);
}

/**
 * The session's entry, opening its activity watch the first time. Every live
 * session has one, so the second trigger sees a session go busy whether or not
 * anybody sent anything.
 */
function ensureEntry(sessionId: string): Entry {
  const existing = entries.get(sessionId);
  if (existing) return existing;
  const entry: Entry = {
    send: null,
    markOnly: false,
    activity: getActivityState(sessionId),
    speaking: false,
    deferred: false,
    snapshot: SETTLED,
    unsubscribe: () => {},
  };
  entries.set(sessionId, entry);
  entry.snapshot = derive(entry);
  // Opened after the entry is in the map: the listener looks itself up, and a
  // synchronous first call would otherwise find nothing.
  entry.unsubscribe = subscribeActivity(sessionId, (state) => {
    onActivity(sessionId, state);
  });
  return entry;
}

function drop(sessionId: string): void {
  const entry = entries.get(sessionId);
  if (!entry) return;
  entry.unsubscribe();
  entries.delete(sessionId);
}

/**
 * Watch this session's activity for the life of the session. Idempotent, and
 * independent of any send — `terminalInstances` calls it when the session is
 * created, and `forgetAnswerWaiting` releases it when the session is destroyed.
 */
export function watchSessionActivity(sessionId: string): void {
  if (entries.has(sessionId)) return;
  ensureEntry(sessionId);
  // A session that is ALREADY busy when its watch opens has the body from the
  // first read, so a cell attaching to a working agent is not told otherwise
  // until the next broadcast.
  notify();
}

/**
 * A draft has just gone to the PTY. `sentOn` is the utterance the cursor was on
 * at that moment — the one the body would otherwise keep showing as if it were
 * the reply.
 */
export function beginWaiting(sessionId: string, sentOn: string | null): void {
  const entry = ensureEntry(sessionId);
  entry.send = { sentOn };
  entry.markOnly = false;
  // The body has handed over by the user's own decision, so there is nothing
  // left for the activity trigger to be patient about.
  entry.deferred = false;
  publish(sessionId);
}

/**
 * Whether this cell's voice is reading. Pushed in by the surface that holds the
 * speech host — this module never asks (see the header): the fact matters only
 * because an agent that goes busy mid-sentence must not take the text away
 * until the sentence ends.
 */
export function noteSpeaking(sessionId: string, speaking: boolean): void {
  const entry = entries.get(sessionId);
  if (!entry || entry.speaking === speaking) return;
  entry.speaking = speaking;
  // The playback the deferral was waiting on has ended: if the agent is still
  // working, the body is now its.
  if (!speaking) entry.deferred = false;
  publish(sessionId);
}

/**
 * The utterance under the cell's cursor, as the pane renders it. A different id
 * than the one the draft was sent on is the reply landing.
 */
export function noteUtterance(sessionId: string, utteranceId: string | null): void {
  const entry = entries.get(sessionId);
  if (!entry || entry.send === null || utteranceId === entry.send.sentOn) return;
  entry.send = null;
  entry.markOnly = false;
  publish(sessionId);
}

/**
 * A transport control was pressed while a reply was pending. The body goes back
 * to the answer — the user asked for the text, and holding it hostage to a wait
 * they did not ask about is the wrong trade — but the reply is still coming, so
 * the mark stays on the play button.
 */
export function noteTransport(sessionId: string): void {
  const entry = entries.get(sessionId);
  // The SEND wait only. Giving the body back while the agent holds it is the
  // hold — its own state, with its own way out; without one, a press here
  // would silence the wave for good.
  if (!entry || entry.send === null || entry.markOnly) return;
  entry.markOnly = true;
  publish(sessionId);
}

/** Drops the session's wait, and the activity watch holding it open. */
export function forgetAnswerWaiting(sessionId: string): void {
  if (!entries.has(sessionId)) return;
  drop(sessionId);
  notify();
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
