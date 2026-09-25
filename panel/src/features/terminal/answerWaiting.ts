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
 * There are THREE triggers, and they are independent:
 *
 * - **a draft was sent** (`beginWaiting`) — the body hands over at once,
 * - **the agent was asked to start** ({@link noteAgentStarting}) — a launcher
 *   pill was pressed, and the body hands over at once,
 * - **the session went busy** — the agent started working on its own.
 *
 * `pending` belongs to the first of them only: it is the mark that says *the
 * reply to what you sent has not landed yet*, and neither an agent working on
 * nothing you asked for nor a `start` press is a question anybody is owed an
 * answer to. The wave on the body already says the session is busy; a mark on
 * the play button as well would be the same fact told twice, in a place that
 * means something narrower.
 *
 * The third trigger exists because the other two both assume a cell that has
 * already SPOKEN. One that never has cannot show that its agent is working at
 * all: the pane starts closed, and the bar shows launcher pills where the eye
 * would be, so there is no control that opens it. Pressing a pill is the user
 * asking the agent to start, and it is a user gesture like a send — so it is
 * immediate, it cancels a pending window, and it releases a standing hold,
 * exactly as `beginWaiting` does. What it does NOT inherit is the `pending`
 * mark, for the reason just given.
 *
 * Three events end a SEND wait outright, and every one of them is something
 * that HAPPENED:
 *
 * - a new utterance arrives for the cell — the reply, or at least an answer,
 * - the session's activity state transitions to `idle` — an agent that finished
 *   without speaking, which is the exit that makes this shippable at all,
 * - the session is destroyed.
 *
 * The first two funnel through {@link endSend}, because ending a send is not
 * only clearing it: a send that overtook the agent's window owes that window
 * back if the agent is still working (see "Cancelling a window is never
 * spending the spell" below). The third takes the whole entry with it, so
 * there is nothing left to owe. {@link noteTransport} is NOT on this list — it
 * shrinks the wait to its mark and the reply is still coming. Read that as the
 * FUNCTION and not as the gesture: *Previous* and *Next* move the cursor as
 * well as calling it, and a moved cursor is the first event on the list
 * arriving by its ordinary route (see {@link endSend}).
 *
 * The activity trigger ends with the activity itself: the body is the agent's
 * for as long as the agent is busy.
 *
 * A STARTING wait ends on the same three events, and funnels through
 * {@link endStarting} for the same reason a send funnels through `endSend` —
 * see there for the one asymmetry between them. The events read a little
 * differently: an ARRIVAL is what the press was waiting for (the agent spoke,
 * so there is a body to show and no wave is needed to stand in for it), and
 * leaving `busy` is the agent that was asked to start having finished, or never
 * having come up at all. The arrival is read on {@link noteNewestAnswer}, not
 * `noteUtterance`: a starting wait has no `sentOn` to compare against, and the
 * cursor `noteUtterance` reports moves for a transport press too, which would
 * make a press that only asked for the text look like the answer landing.
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
 * It applies to the AGENT's trigger only. A send and a launcher press are the
 * user's own action and delaying their feedback would make the panel feel
 * broken, so `beginWaiting` and {@link noteAgentStarting} hand over on the
 * frame they are called and CANCEL any pending window: the user's decision is a
 * better answer to *is this real?* than any clock. The window each of them
 * spends is owed back when its own wait ends, which is the next section.
 *
 * The debounce composes BEFORE the playback deferral below, and the two are
 * independent: the debounce asks *is this real?*, the deferral asks *is now a
 * rude moment?*. The deferral is therefore armed when the window ELAPSES,
 * against the playback running at that moment, not against the one running at
 * the transition.
 *
 * ## Cancelling a window is never spending the spell
 *
 * THREE things cancel a pending window, for two different reasons, and all
 * three owe the same thing afterwards.
 *
 * An ANSWER arriving cancels one ({@link noteNewestAnswer}) — the answer is
 * the better outcome, and an uninterrupted moment on screen is what it is
 * owed. A SEND cancels one ({@link beginWaiting}) and a LAUNCHER PRESS cancels
 * one ({@link noteAgentStarting}) — the user's own decision is a better answer
 * to *is this real?* than any clock.
 *
 * None of them is the end of the spell. If the session is still busy afterwards
 * the agent is genuinely still working, and the server will not re-broadcast a
 * state it never left: it emits on a TRANSITION into busy, and there was none.
 * So each cancellation re-opens a FRESH window at the moment its own claim is
 * over — the arrival at once, the send when the send ENDS ({@link endSend}),
 * the press when the starting wait ends ({@link endStarting}) — and the wave
 * returns one window later, which is the shipped rule that a working agent owns
 * the answer pane's body.
 *
 * The send's half is the less obvious one and the more ordinary: *type a reply
 * while the agent is working* opens with a window pending, spends it on the
 * keypress, and — without the re-open — leaves the cell busy with
 * `waiting === false` for the rest of the run. Symmetry here is not tidiness;
 * it is the second half of one rule.
 *
 * **A deliberate consequence: arrival storms postpone the wave.** Every
 * arrival restarts the window, so a cell taking fifty answers a hundred
 * milliseconds apart never reaches the end of one and shows no wave until they
 * stop. That is the trade this module wants, not an oversight: the pane is
 * showing FRESH ANSWERS the whole time, which is the thing the wave exists to
 * stand in for, and a wave raised between two answers would cover the second
 * of them. The wave is what the body falls back to when there is nothing newer
 * to show — so an agent that is answering continuously has nothing to fall
 * back to, and gets the body the moment it goes quiet for one window.
 *
 * ## Which entry points open a window
 *
 * A busy TRANSITION is one ({@link onActivity}). The other is a session that
 * was ALREADY busy before this tab looked — a panel reloaded while an agent
 * works gets a full snapshot on connect and no transition afterwards, so
 * without this the wave would never appear for that entire run. That reading is
 * exactly the one the debounce distrusts, so it gets a WINDOW rather than the
 * claim it used to get outright.
 *
 * The already-busy case is asked on {@link watchSessionActivity} and NOT gated
 * on the entry being new, because in the real tree it never is: `TerminalView`
 * opens the watch from its own effect while its child `SpeechControlBar` pushes
 * {@link noteNewestAnswer} from a child effect, and React runs child effects
 * first. A queue push on render is not a claim on the body; the one thing that
 * must not be overtaken is a USER GESTURE, so the window is withheld only while
 * a send is outstanding — `beginWaiting` has already handed the body over by
 * the user's own decision, and a window behind it would decide nothing.
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
  /**
   * The user pressed a launcher pill and the agent it asked for has not spoken
   * yet. Its own flag rather than a reuse of {@link Entry.agentArmed}, because
   * the two have different ways OUT: the agent's claim survives an answer
   * landing (an agent that answers and carries on is still working and still
   * owns the body), while a starting wait is exactly what that answer ends. It
   * carries no `pending` mark — nothing was asked — which is the one thing it
   * does not inherit from a send.
   */
  starting: boolean;
  /** The last activity state seen; a CHANGE into `idle` is the silent-agent exit. */
  activity: ActivityState;
  /**
   * The busy spell outlived the debounce window, so the agent has a claim on
   * the body. This — not `activity === "busy"` — is what `derive` reads: a
   * session can be busy with a repaint nobody asked for, and the whole point of
   * the window is that such a spell never gets this far.
   *
   * Cleared the moment the session stops being busy. An answer arriving inside
   * the window never granted it in the first place — that arrival restarts the
   * window instead, so the claim is re-earned one window later.
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
  // The launcher press sits beside the agent's own claim and yields the same
  // snapshot, because it IS the same fact told one moment earlier: work is
  // coming and the body has nothing to show. It is deliberately NOT subject to
  // `deferred` — the deferral is politeness towards a sentence the agent
  // interrupted, and this trigger is the user's own press, which is never the
  // rude party.
  return entry.starting || agentHasTheBody ? AGENT_HAS_THE_BODY : SETTLED;
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

/**
 * The send is over — the reply landed, or the agent went idle without one —
 * and the wait it carried is cleared HERE rather than at each of those sites,
 * because clearing it is only half of what the end of a send owes.
 *
 * The other half is the window the send may have CANCELLED on its way in.
 * `beginWaiting` spends a pending window on purpose (see there), and a send
 * made while the agent was already working spends a window that was weighing
 * real work. The server broadcasts on a TRANSITION into busy and the session
 * never left the state, so nothing will re-announce it: without this the cell
 * sits busy with `waiting === false` for the rest of the run, and the wave is
 * gone on the most ordinary path there is — typing a reply while the agent
 * works.
 *
 * So a still-busy agent gets a FRESH window, exactly as it does when an
 * ARRIVAL cancels one ({@link noteNewestAnswer}). The two are the same rule
 * written once each: whatever cancelled the window is owed its moment, and the
 * agent re-earns the body one window later if it really is still working.
 *
 * Conditioned on the agent, never on "a send happened": `activity === "busy"`
 * is the debt, and a send on an idle session took none on. `agentArmed` is the
 * other exclusion — a claim already granted needs no window to grant it again,
 * and scheduling one would only burn a timer to reach the state it is in.
 *
 * Why HERE and not on the arrival alone: a send ends in more than one way, and
 * the one that matters most (`noteUtterance`) is not the one the send began
 * against. {@link noteTransport} is deliberately NOT one of them — it SHRINKS
 * the wait to its mark rather than ending it (`markOnly`), the reply is still
 * coming, and the user has just asked for the text.
 *
 * That exclusion is about the FUNCTION, not about the gesture. Play/pause
 * calls `noteTransport` and nothing else, so for it the two are the same
 * thing. *Previous* and *Next* also MOVE THE CURSOR, and the moved cursor
 * reaches this module as `noteUtterance` from `SpeechControlBar`'s own effect
 * one commit later — with an id that is not the one the draft was sent on. So
 * those two presses DO end the send, through the ordinary arrival path, and
 * that is right rather than accidental: *Next* is enabled only when the cell
 * has something newer to step onto, which is the "a new utterance arrives for
 * the cell" this function exists for, and the wave it hands back one window
 * later is a true statement about an agent that is still working. `answerWaiting.guards.test.ts`
 * pins both presses.
 */
function endSend(sessionId: string, entry: Entry): void {
  entry.send = null;
  entry.markOnly = false;
  if (entry.activity !== "busy" || entry.agentArmed) return;
  openDebounceWindow(sessionId, entry);
}

/**
 * The launcher press's wait is over — the agent spoke, or the session stopped —
 * and, like {@link endSend}, clearing the flag is only half of what that owes.
 *
 * **Why this re-opens a window at all**, which is the question this trigger
 * does not answer by analogy. The tempting reading is that it never needs to:
 * the press's own output puts the session busy, that transition opens a window
 * on its own account, and the two exits both look covered — an ARRIVAL goes
 * through `noteNewestAnswer`, which re-opens a window itself, and going IDLE
 * leaves nothing to wait for. Both halves of that are true and neither is
 * enough:
 *
 * - `noteNewestAnswer`'s re-open is guarded on `hadWindow` — only an arrival
 *   that actually cancelled something owes a replacement — and by the time the
 *   answer lands, the window the PRESS cancelled is long gone. So that path
 *   declines, correctly, for its own debt and not for this one,
 * - "the press's own output opens a window" holds only when the session was
 *   IDLE when it was pressed. Pressed on a session that was already busy — a
 *   reattach repaint is the ordinary way that happens — the agent's output
 *   merely continues that spell, the server broadcasts on a TRANSITION and
 *   there is none, and the only window the whole run would ever have seen is
 *   the one the press cancelled. Without this, such a cell sits busy with
 *   `waiting === false` from the first answer to the end of the run.
 *
 * So the same rule as `endSend`, conditioned identically: `activity === "busy"`
 * is the debt, a press on an idle session took none on, and `agentArmed` is a
 * claim already granted that needs no window to grant it again.
 *
 * The one asymmetry with `endSend` is the guard on the way in. A send always
 * ends through a site that knows a send was outstanding (`entry.send !== null`
 * is checked by every caller); the arrival path here has no such check to lean
 * on, so it is made here rather than at each call site — an arrival for a cell
 * that never pressed anything must not schedule a window on the press's
 * account.
 */
function endStarting(sessionId: string, entry: Entry): void {
  if (!entry.starting) return;
  entry.starting = false;
  if (entry.activity !== "busy" || entry.agentArmed) return;
  openDebounceWindow(sessionId, entry);
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
    // The agent the user asked for has stopped — finished without speaking, or
    // never came up. Cleared on EVERY non-busy state rather than on `idle`
    // alone: `attention` is the agent up and asking the user something, which
    // is the start over just as surely. Its re-open can never fire from here
    // (this branch has just left `busy`), and it is routed through the funnel
    // anyway for the same reason `endSend` is — one function says what the end
    // of a starting wait does.
    endStarting(sessionId, entry);
    // Through `endSend` like every other end of a send, although the re-open
    // it carries can never fire from here: this branch has just left `busy`,
    // which is the one condition the re-open asks about. Routed through it
    // anyway so that "what the end of a send does" stays one function rather
    // than a rule the arrival path remembers and this one does not.
    if (state === "idle") endSend(sessionId, entry);
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
    starting: false,
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
  const entry = ensureEntry(sessionId);
  // A session that is ALREADY busy when its watch opens gets a WINDOW, not the
  // claim it used to get outright from the first read. "Busy when we looked"
  // is the very reading the debounce exists to distrust — a reattach repaint
  // is exactly that — and a session genuinely working will still be working
  // one window later. Without this the already-busy case has no trigger at
  // all: the server broadcasts on a TRANSITION into busy and sends a snapshot
  // on connect, so a panel reloaded mid-run would never see one.
  //
  // Asked of every call, not only the one that created the entry. In the real
  // tree this is ALWAYS the second caller — `TerminalView`'s effect runs after
  // its child `SpeechControlBar`'s, whose `noteNewestAnswer` conjured the
  // entry — and an `entries.has` early return here is that case getting
  // nothing.
  //
  // A USER GESTURE is the one thing withheld from, and BOTH of them count.
  // `beginWaiting` and {@link noteAgentStarting} have each already handed the
  // body over by the user's own decision, and a window opened behind either
  // would only be deciding a question the user has answered.
  //
  // `starting` is checked here for the same reason `send` is, and the reason
  // it has to be checked HERE rather than only at the press is that this
  // function is called again on every REMOUNT. A layout change — maximize, a
  // preset, a drag, a seam resize — rebuilds `TerminalView` and re-opens the
  // watch, so a press whose window this cancelled a moment ago would get that
  // window straight back; it fires, `agentArmed` becomes true, and the arrival
  // that ends the starting wait then hands the body to the agent's claim
  // instead of to the answer. The cell's first reply loses the uninterrupted
  // moment the press bought it, and "a user gesture is never overtaken by a
  // window" stops being durable across a layout change. The press's own debt
  // is still paid where it always was, by {@link endStarting}.
  //
  // A hold needs no such guard — it OUTRANKS every claim in `derive`, so a
  // window under it changes nothing until the user themselves releases it, at
  // which point a still-working agent should indeed have the body.
  if (
    entry.activity === "busy" &&
    entry.send === null &&
    !entry.starting &&
    !entry.agentArmed
  ) {
    openDebounceWindow(sessionId, entry);
  }
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
  //
  // Spent, not forgiven. If the agent was working when this was pressed it is
  // very likely still working when the reply lands, and nothing re-announces
  // that — so `endSend` re-opens the window at the moment this send's claim on
  // the body is over.
  cancelDebounce(entry);
  // ...and nothing left for a standing hold to protect either: sending IS the
  // user moving on from the answer they had stepped back to read. Leaving the
  // hold up here would let `derive` answer the send with MARK_ONLY — the old
  // answer on the body, no wave, for the whole reply.
  entry.held = false;
  publish(sessionId);
}

/** The user asked this cell's agent to start. Hands the body over at once,
 *  with NO pending mark: nothing was asked, so no reply is outstanding.
 *
 * A launcher press IS a send in every respect but that one, so everything below
 * is `beginWaiting`'s reasoning applied to the same kind of event — a decision
 * the user made, rather than a reading that might be noise.
 *
 * Why it needs a trigger of its own at all: the other two both assume a cell
 * that has already spoken. One that never has starts with the pane closed and
 * launcher pills where the eye would be, so there is no way in and nothing on
 * the body to hand over. This is the way in.
 */
export function noteAgentStarting(sessionId: string): void {
  const entry = ensureEntry(sessionId);
  entry.starting = true;
  // The body has handed over by the user's own decision, so there is nothing
  // left for the activity trigger to be patient about — the deferral protects
  // a sentence an AGENT interrupted, and the user interrupting themselves is
  // not that.
  entry.deferred = false;
  // ...nor anything left for it to be suspicious about. A user gesture is
  // never debounced, and a window it overtakes is SPENT rather than left to
  // fire behind a question already answered. Spent, not forgiven: see
  // `endStarting`, which pays it back at the moment this press's claim on the
  // body is over.
  cancelDebounce(entry);
  // ...and nothing left for a standing hold to protect either. The hold is the
  // user saying *I want the text*; asking the agent to start is that same user
  // moving on, exactly as sending is. Leaving it up would let `derive` answer
  // the press with SETTLED — the old answer on the body, no wave — for the
  // whole run.
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
  // The reply landed on an agent that may well still be working — see
  // `endSend`, which is where a send that overtook a window pays it back.
  endSend(sessionId, entry);
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
  // was about to raise would cover the thing it was supposed to announce, so
  // the window goes: the answer gets its uninterrupted moment on screen.
  //
  // But the spell is NOT spent. If the session is still busy the agent is
  // genuinely still working — it answered and carried on — and the server will
  // not broadcast a transition it never made, so leaving it there is a wave
  // that never comes back for the rest of the run. A FRESH window is the whole
  // answer: the arrival is read on screen, and one window later the working
  // agent owns the body again, which is what the pane promises.
  //
  // The arrival is read here rather than in `noteUtterance` on purpose: the
  // cursor moves for a transport press too, and this is the only push that
  // means something LANDED.
  //
  // `hadWindow` was written to mean "only an arrival that actually cancelled
  // something owes a replacement". In the real tree it no longer sees that,
  // and the comment is kept honest rather than kept: `SpeechControlBar` pushes
  // this from one effect and `noteUtterance` from another IN THE SAME COMMIT,
  // so on the ordinary path — a reply landing for a send — `endSend` has
  // already run and the window this reads is usually the one `endSend` itself
  // just opened, not a genuine agent window this arrival is cancelling.
  //
  // The net effect is zero and it does not depend on which effect runs first.
  // Cancelling a window that is one line old and re-opening it is the same
  // window; and where `endSend` opened none (an idle session, or a claim
  // already granted) this reads `false` and declines, which is the outcome the
  // original reading wanted anyway. It still bites on the paths `endSend` is
  // not on at all — an arrival for a cell with no send outstanding, which is
  // every answer an agent volunteers.
  //
  // The `activity === "busy"` beside it discriminates NOTHING today — a
  // pending window implies a busy session, because every transition out of
  // `busy` cancels the window on its way — so read it as a belt-and-braces
  // restatement of the rule the re-open is FOR, kept in step with `endSend`'s
  // copy of the same condition, rather than as a case this line is here to
  // catch.
  const hadWindow = entry.debounce !== null;
  cancelDebounce(entry);
  if (hadWindow && entry.activity === "busy") openDebounceWindow(sessionId, entry);
  // The arrival is what a launcher press was waiting for: the wave stood in
  // for a body with nothing in it, and now there is something to show. Its own
  // debt is settled separately from `hadWindow` above — the window the PRESS
  // cancelled was cancelled long before this answer landed, so that guard has
  // nothing to say about it (see `endStarting`).
  endStarting(sessionId, entry);
  if (!entry.held) {
    // Published even with no hold to release: ending a starting wait moves the
    // body on its own account, and this is the only path that does so without
    // going through `onActivity`.
    publish(sessionId);
    return false;
  }
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
