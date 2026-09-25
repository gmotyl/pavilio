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
 * ## The debounce on the agent's trigger
 *
 * `busy` does not mean *the agent is working*. Server-side it is
 * `recordOutput()` — *the PTY emitted output within the last second* — which is
 * a good proxy mid-session and a bad one at attach time, when a repaint is
 * guaranteed. Switching terminals or projects reattaches the session and
 * repaints the screen, which IS output, so a switch produces a 1-2s busy window
 * with no agent work in it, and that window was enough to cover an answer the
 * user was still reading. The same false positive arrives by other routes the
 * server already names — an async shell prompt finishing, a stray redraw — so
 * the guard is a debounce on the trigger rather than a suppression of
 * output-after-attach.
 *
 * So a busy transition does not hand anything over; it opens a WINDOW
 * ({@link answerWaveDebounceMs}). Only output that outlives that window is work,
 * and only then does the agent get a claim on the body ({@link Entry.agentArmed}
 * — which is what `derive` reads, never `activity === "busy"` on its own).
 *
 * It applies to the AGENT's trigger only. A send is the user's own action and
 * delaying its feedback would make the panel feel broken, so `beginWaiting`
 * hands over on the frame it is called and CANCELS any pending window: the
 * user's decision is a better answer to *is this real?* than any clock.
 *
 * The debounce composes BEFORE the playback deferral below, and the two are
 * independent: the debounce asks *is this real?*, the deferral asks *is now a
 * rude moment?*. The deferral is therefore armed when the window ELAPSES,
 * against the playback running at that moment, not against the one running at
 * the transition.
 *
 * A window still pending when an answer arrives is simply dropped
 * ({@link noteNewestAnswer}) — the answer is the better outcome, and the wave
 * was never needed. Dropped means SPENT, not postponed: that busy spell gets no
 * second window, only a later transition does.
 *
 * This is the ONE clock in this module, and it decides one thing: whether a
 * busy spell was real. Every other transition here stays event-driven (see the
 * "No timer decides any of it" note below, which is about the way OUT of the
 * waiting state and is untouched).
 *
 * ## The hold
 *
 * Without one the feature eats itself. A busy session takes the body, so a user
 * who steps back through the transport to re-read something loses the text
 * again on the very next activity broadcast. `holdAnswer` is the user saying *I
 * want the text*, and it outranks every claim on the body for as long as it
 * stands — which is why it is ONE term at the top of `derive` rather than a
 * qualifier bolted onto each trigger.
 *
 * FOUR things release it, and every one of them is something that HAPPENED:
 *
 * - a forward transport press, or the *Next answer* control (`releaseAnswer`),
 * - a new answer landing for the cell (`noteNewestAnswer`),
 * - a draft being sent (`beginWaiting`) — sending is the user moving on, and the
 *   answer they stepped back to read is no longer what they are waiting to see.
 *   Without this the hold would outrank the send that follows it, and the most
 *   ordinary path there is — step back to re-read, then type a reply — would
 *   hand the reply no wave at all,
 * - the session leaving `busy` — a hold with nothing left to hold it against is
 *   not a hold, it is a pane stuck on an old answer.
 *
 * Nothing else releases it, and no clock does: every release above is an event
 * this module was TOLD about, and no timer is scheduled on either the setting
 * or the releasing side.
 *
 * ### Why the arrival release hands a value BACK
 *
 * An arrival that releases the hold has to leave the body showing the answer
 * that just landed, and the queue's reducer deliberately parks the cursor on
 * the utterance it was already on when an answer arrives. So the release has to
 * be accompanied by a reset of the cursor to the newest answer — and this
 * module owns no cursor and may not go and get one (see below).
 *
 * So the arrival comes IN as a push like every other fact here, and the answer
 * goes OUT as `noteNewestAnswer`'s return value: `true` means *that arrival
 * released a hold*, which is the surface's cue to put its own cursor back on
 * the newest answer. This module owns the hold, the surface owns the cursor,
 * and neither reaches into the other. Losing the reader's place in the backlog
 * there is deliberate: the alternative is releasing the hold onto the answer
 * they had stepped back to, which makes the arrival invisible.
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
 * **No timer decides the way OUT.** The debounce above is the only clock here,
 * and it guards the way IN; nothing schedules an exit. The activity state is
 * the server's, broadcast
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
 * channel, the debounce leaf} — a read of the speech host would be a coupling
 * just as surely as a command would. `answerWaveDebounce` is a leaf that
 * imports nothing at all, so it drags no dependency in behind it.
 */
import { useSyncExternalStore } from "react";
import { answerWaveDebounceMs } from "./answerWaveDebounce";
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
  /**
   * The busy spell outlived the debounce window, so the agent has a claim on
   * the body. This — not `activity === "busy"` — is what `derive` reads: a
   * session can be busy with a repaint nobody asked for, and the whole point of
   * the window is that such a spell never gets this far.
   *
   * Cleared the moment the session stops being busy, and by an answer arriving
   * inside the window: that spell is then SPENT, and only a later transition
   * opens another one.
   */
  agentArmed: boolean;
  /**
   * The pending debounce window, or `null` when none is running. Kept as a
   * handle rather than a boolean because every way out of the window — going
   * idle, an answer landing, a send, the session being destroyed — has to
   * CLEAR it, and a fired-but-stale timer is exactly the bug this guard exists
   * to stop.
   */
  debounce: ReturnType<typeof setTimeout> | null;
  /** Whether this cell's voice is reading, as the speech surface last said. */
  speaking: boolean;
  /**
   * The session went busy mid-sentence, so its handover is waiting for that
   * playback to end. Armed at the transition and at no other moment: a
   * handover already made is not undone by a later playback starting.
   */
  deferred: boolean;
  /**
   * The user stepped back through the transport and wants the text. Outranks
   * every claim on the body until something releases it.
   */
  held: boolean;
  /** The value of {@link Entry.held} the listeners were last told about. */
  toldHeld: boolean;
  /**
   * The newest answer the cell holds, as the surface last pushed it — BOXED, so
   * that "I have never been told" (`null`) is a different fact from "the newest
   * is null" (`{ id: null }`). A different id is an ARRIVAL — which is not the
   * same question as `noteUtterance`'s, because the cursor moves for a transport
   * press too and the press that SETS the hold must not be read as the event
   * that ends it. The very first push is SEEDING, not an arrival: an entry
   * created by the hold itself has been told nothing yet, and reading its first
   * push as an answer landing would kill the hold on the frame it was made.
   */
  newest: { id: string | null } | null;
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
  // The hold, ahead of both triggers rather than inside either: the user asked
  // for the text, and neither the draft they sent nor the agent's own work is
  // a reason to take it away again. A send still outstanding keeps its mark on
  // the play button, exactly as a transport press leaves it.
  if (entry.held) return entry.send !== null ? MARK_ONLY : SETTLED;
  const sendHasTheBody = entry.send !== null && !entry.markOnly;
  // `agentArmed`, not `activity === "busy"`: a busy spell has a claim on the
  // body only once it has outlived the debounce window (see the header). The
  // deferral is asked SECOND, and only of a claim the window already allowed.
  const agentHasTheBody = entry.agentArmed && !entry.deferred;
  if (entry.send !== null) return sendHasTheBody || agentHasTheBody ? BODY_HANDED_OVER : MARK_ONLY;
  return agentHasTheBody ? AGENT_HAS_THE_BODY : SETTLED;
}

/**
 * Re-reads the entry and tells the listeners only when something they can see
 * actually moved.
 *
 * TWO things are read through this one listener set, not one: the body's
 * snapshot, and the hold ({@link useAnswerHeld}, which draws the way out of
 * it). So "nothing moved" has to be asked about BOTH, and the two questions
 * have genuinely different answers — with a deferral armed, `derive` hands
 * back `SETTLED` for a held cell and for an unheld one alike, because the body
 * keeps the answer either way. Asking only the snapshot there is a hold that
 * changes and a subscriber that is never told: the *Next answer* control does
 * not appear when the user steps back mid-sentence, and — the half nothing
 * else masks — does not disappear when they press it, because `onActivate`
 * calls `releaseAnswer` and nothing else. A control whose entire job is to be
 * pressable sits dead until the playback ends.
 *
 * The check is HERE rather than a `notify()` bolted onto each of the entry
 * points that move `held` — `holdAnswer`, `releaseAnswer`, `noteNewestAnswer`,
 * `beginWaiting`, `onActivity` — because this is the one place all of them
 * already funnel through, and the fifth one somebody adds next will funnel
 * through it too. The snapshot's own discipline is untouched: an unchanged
 * snapshot still notifies nobody on its own account.
 */
function publish(sessionId: string): void {
  const entry = entries.get(sessionId);
  if (!entry) return;
  const next = derive(entry);
  const heldMoved = entry.held !== entry.toldHeld;
  if (next === entry.snapshot && !heldMoved) return;
  entry.snapshot = next;
  entry.toldHeld = entry.held;
  notify();
}

/**
 * Cancels a pending debounce window, if one is running. Idempotent, and safe on
 * an entry that never opened one — every exit from a busy spell funnels through
 * here rather than each caller remembering the handle.
 */
function cancelDebounce(entry: Entry): void {
  if (entry.debounce === null) return;
  clearTimeout(entry.debounce);
  entry.debounce = null;
}

/**
 * Opens the debounce window for a busy spell: if the session is STILL busy when
 * it elapses, the output was work rather than a repaint and the agent gets its
 * claim on the body — subject to the playback deferral, which is armed here
 * against the playback running at that moment rather than at the transition
 * (the two questions are independent, and this is the order they are asked in).
 *
 * A window already running is the window this spell gets: re-arming on every
 * further busy event would push the handover back by one window per byte the
 * agent writes, which for a working agent is a wave that never appears at all.
 */
function openDebounceWindow(sessionId: string, entry: Entry): void {
  if (entry.debounce !== null) return;
  entry.debounce = setTimeout(() => {
    // The entry may have been dropped, and `drop` clears this timer — but a
    // timer that has already been handed to the queue cannot be unscheduled in
    // every runtime, so the fired callback re-reads rather than trusting the
    // closure.
    const live = entries.get(sessionId);
    if (!live || live.debounce === null) return;
    live.debounce = null;
    if (live.activity !== "busy") return;
    live.agentArmed = true;
    live.deferred = live.speaking;
    publish(sessionId);
  }, answerWaveDebounceMs());
}

function onActivity(sessionId: string, state: ActivityState): void {
  const entry = entries.get(sessionId);
  // The transition, not the reading: a server re-broadcast of the state a
  // session was already in has neither started nor finished anything.
  if (!entry || state === entry.activity) return;
  entry.activity = state;
  if (state === "busy") {
    // Output happened; whether it is WORK is what the window is for. Nothing
    // is handed over here and the deferral is not armed here either — both
    // wait for the window to elapse.
    openDebounceWindow(sessionId, entry);
  } else {
    // Whatever the output was, it is over: a window still pending must not
    // fire behind a session that has already stopped, and a claim already
    // granted ends with the activity that earned it.
    cancelDebounce(entry);
    entry.agentArmed = false;
    // Nothing left to defer to — and nothing left to hold the answer against
    // either: the hold is a press made against work in progress, and work that
    // is no longer in progress must not leave the pane pinned to an old
    // answer for the next thing the agent does.
    entry.deferred = false;
    entry.held = false;
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
    agentArmed: false,
    debounce: null,
    speaking: false,
    deferred: false,
    held: false,
    toldHeld: false,
    newest: null,
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
  // Before the entry leaves the map: a window left running would fire against
  // a session that no longer exists, and a session recreated under the same id
  // would inherit a claim earned by the dead one.
  cancelDebounce(entry);
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
  const entry = ensureEntry(sessionId);
  // A session that is ALREADY busy when its watch opens gets a WINDOW, not the
  // claim it used to get outright from the first read. "Busy when we looked"
  // is the very reading the debounce exists to distrust — a reattach repaint
  // is exactly that — and a session genuinely working will still be working
  // one window later.
  //
  // Here rather than in `ensureEntry`, because this is the session-creation
  // path: `terminalInstances` calls it once per session, whereas an entry
  // conjured by `beginWaiting` or `holdAnswer` is a user gesture, and a
  // gesture must not open a window it is about to overtake anyway.
  if (entry.activity === "busy") openDebounceWindow(sessionId, entry);
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
  // ...nor anything left for it to be suspicious about. A send is never
  // debounced — three seconds before the panel acknowledges your own keypress
  // reads as broken — and a window it overtakes is SPENT rather than left to
  // fire behind it: the user's decision already answered the question that
  // window was asking.
  cancelDebounce(entry);
  // ...and nothing left for a standing hold to protect either: sending IS the
  // user moving on from the answer they had stepped back to read. Leaving the
  // hold up here would let `derive` answer the send with MARK_ONLY — the old
  // answer on the body, no wave, for the whole reply.
  entry.held = false;
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

/**
 * A backward transport press: hold the answer on screen until released.
 *
 * Idempotent, and deliberately unconditional — a press made while nothing has
 * the body is a hold that costs nothing and is already standing when the agent
 * next goes busy, which is the case the user is actually protecting themselves
 * against.
 */
export function holdAnswer(sessionId: string): void {
  const entry = ensureEntry(sessionId);
  if (entry.held) return;
  entry.held = true;
  publish(sessionId);
}

/** A forward transport press, or the *Next answer* control. */
export function releaseAnswer(sessionId: string): void {
  const entry = entries.get(sessionId);
  if (!entry || !entry.held) return;
  entry.held = false;
  publish(sessionId);
}

/**
 * The newest answer the cell holds, as the surface that owns the queue sees it.
 * A different id than the last one pushed is an ARRIVAL — which is a different
 * question from `noteUtterance`'s, because the cursor also moves for a
 * transport press, and the press that SETS the hold must not read as the event
 * that ends it.
 *
 * **What the caller must push:** the id of the newest answer the cell HOLDS,
 * which is `queue.pending.at(-1)?.id ?? queue.current?.id ?? null` — never
 * `queue.current?.id` alone. An answer arriving while the voice is reading
 * takes the reducer's `speaking: true` arm, which appends to `pending` and
 * leaves `current` exactly where it was; keying on `current` would see no
 * change and release no hold in the one situation a hold exists for — the user
 * stepped back to re-read while the agent was still talking.
 *
 * The FIRST push for an entry is seeding, not an arrival: `holdAnswer` creates
 * the entry, so an entry that has never been told a newest id would otherwise
 * read its first push as an answer landing and drop the hold on the frame it
 * was made. Seeding returns `false` and leaves any hold standing.
 *
 * Returns whether that arrival released a hold. `true` is the surface's cue to
 * return its cursor to the newest answer so the body shows what just landed —
 * the one half of this that lives outside the module, because the cursor is the
 * speech queue's and this module never reaches for it (see the header).
 */
export function noteNewestAnswer(sessionId: string, newestId: string | null): boolean {
  const entry = ensureEntry(sessionId);
  const told = entry.newest;
  entry.newest = { id: newestId };
  // `told === null` is the SEEDING push: this entry has never been given a
  // newest id — `holdAnswer` may well be what created it — so the first thing
  // the surface says is where it stands, not an answer landing.
  if (told === null || newestId === told.id) return false;
  // An answer landed inside a pending debounce window. The wave that window
  // was deciding about is no longer wanted at all — the answer is the better
  // outcome, and a wave raised now would cover the thing it was supposed to
  // announce — so that busy spell is spent. Only a LATER transition opens
  // another window.
  //
  // The arrival is read here rather than in `noteUtterance` on purpose: the
  // cursor moves for a transport press too, and this is the only push that
  // means something LANDED.
  cancelDebounce(entry);
  if (!entry.held) return false;
  entry.held = false;
  publish(sessionId);
  return true;
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

/**
 * Whether the user is holding the answer on screen — a READ of the hold, for
 * the pane that has to draw the way out of it.
 *
 * Deliberately not a member of {@link AnswerWaitingSnapshot}. The snapshot says
 * what the BODY does, and the four shared objects it is drawn from are what let
 * an unchanged cell hand `useSyncExternalStore` the same reference on every
 * read; the hold is a different question, asked by one surface, and widening
 * the snapshot for it would put a fifth and a sixth object in that set for a
 * fact the body has already accounted for.
 *
 * **Staleness.** A reader pairs this with {@link useAnswerWaiting} and with the
 * session's activity state, and it must NOT be left leaning on either of them
 * to be told about a hold. Usually the snapshot does move with it — taking or
 * releasing a hold on a busy session flips the body between
 * `AGENT_HAS_THE_BODY`/`BODY_HANDED_OVER` and `SETTLED`/`MARK_ONLY` — but a
 * session that went busy MID-SENTENCE has its handover deferred, and then
 * `derive` answers held and unheld with the same frozen `SETTLED`: the body
 * keeps the answer either way, while the control this hook draws has to appear
 * and disappear all the same. So {@link publish} notifies on a hold change in
 * its own right, and this hook is a first-class reader of that listener set
 * rather than a passenger on the snapshot's.
 */
export function isAnswerHeld(sessionId: string): boolean {
  return entries.get(sessionId)?.held ?? false;
}

/** {@link isAnswerHeld}, re-reading the caller when the cell's snapshot moves. */
export function useAnswerHeld(sessionId: string): boolean {
  return useSyncExternalStore(
    subscribeAnswerWaiting,
    () => isAnswerHeld(sessionId),
    () => isAnswerHeld(sessionId),
  );
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
