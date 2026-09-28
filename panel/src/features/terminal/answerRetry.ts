/**
 * One manual **Retry Enter** per composer send, kept OUTSIDE React, keyed by
 * session, for the life of the tab.
 *
 * The case it exists for: the draft reached the PTY, the submitting `\r`
 * reached an OPEN socket, and nothing happened. The agent never woke, so no
 * output was produced, so the session never went busy and no answer ever
 * arrived — there is nothing for any existing state machine to react to,
 * because the defining feature of this failure is that NOTHING happened. The
 * recovery is one more Return, and it has to be the user's own press: a panel
 * that retypes Enter on your behalf is a panel that double-submits.
 *
 * ## Why this is not part of `answerWaiting`
 *
 * They look like the same fact — *a reply to your draft is outstanding* — and
 * they have opposite exits.
 *
 * `answerWaiting` ENDS on an idle transition: an agent that finished without
 * speaking is the exit that makes the wave shippable at all. Idle is precisely
 * the state this ticket needs to SURVIVE into, because an idle session two
 * seconds after an accepted Return is the symptom: the agent is not working,
 * and it is not working because it never received the keypress. Folding the
 * ticket into that store would have the wait's exit delete the evidence.
 *
 * The second difference is the unit. A wait belongs to the SESSION and survives
 * being re-entered; a retry offer belongs to one SEND, and a second submit must
 * take the first one's offer away rather than extend it — otherwise the offer
 * standing on screen writes a Return for a draft two sends ago. Hence the
 * generation: `beginRetryTicket` hands one out, every later call carries it,
 * and anything arriving with a stale one is a callback from a submit the user
 * has already moved past.
 *
 * ## Why the offer is gated on `idle`, and why `attention` is not idle
 *
 * The offer is a claim that the keypress was LOST. A session doing anything at
 * all contradicts that claim, and there are two ways for the server to say so:
 *
 * - `busy` — output within the last second. The agent is working, so it got the
 *   Return,
 * - `attention` — *busy for a long run, then quiet for one second*. That is an
 *   agent between two bursts of output as often as it is one that has stopped
 *   (see `answerWaiting`'s header on the oscillation), and an agent that has
 *   produced output at all is not one that missed the keypress.
 *
 * So only `idle` — which the server reaches from a short run that ended, or
 * from the user typing into the terminal — permits the offer. The same reading
 * is applied at the deadline and to every later transition: an offer already on
 * screen is withdrawn the moment the session shows any sign of life, because by
 * then the premise is simply false.
 *
 * ## Why consuming happens before the write
 *
 * `consumeRetryOffer` spends the ticket and answers `true` at most once, and
 * the composer calls it BEFORE it touches the socket. Two taps in one frame —
 * a double click, a keyboard activation racing a pointer one — would otherwise
 * both see an offer standing and both write a Return, which is the exact
 * double-submit this feature is supposed to be the safe alternative to. The
 * consume is synchronous and the write is not, so ordering them this way is
 * what makes "one Return" a property of the store rather than a hope about the
 * event loop.
 *
 * Spent means spent: a refused write does not hand the ticket back. One offer,
 * one attempt, and the composer's existing `return`-stage failure text says
 * what happened.
 *
 * ## What it holds, and for how long
 *
 * Memory only, and no more than one ticket per session. It must survive a
 * terminal-view remount — every layout change rebuilds `TerminalView`, and an
 * offer held in component state would vanish when the user resized the cell
 * they had just sent from — and it must NOT survive a reload: a recovery
 * control restored from storage would offer to press Enter into a session whose
 * moment passed minutes ago.
 */
import { useSyncExternalStore } from "react";
import { getActivityState, subscribeActivity } from "./useTerminalActivityChannel";

/** How long after an accepted initial Return the offer appears. */
export const RETRY_OFFER_MS = 2000;

interface Ticket {
  /**
   * Which send this ticket belongs to. Every callback the composer carries is
   * stamped with it, so a `ptySubmit` report arriving after the user has sent
   * again is discarded rather than arming an offer for a draft they have moved
   * past.
   */
  generation: number;
  /**
   * The NEWEST utterance the cell held when the draft went out — BOXED, so that
   * "never recorded" (`null`) is a different fact from "the cell had no answer
   * yet" (`{ id: null }`). Any OTHER id reaching {@link noteRetryUtterance} is
   * an answer landing, which is the ticket's premise collapsing: something did
   * reply.
   *
   * Newest and never the cursor — see `speech/utteranceQueue.ts`'s
   * `newestUtteranceId`. Both writers speak that vocabulary, and they have to:
   * this is ONE slot, so a baseline recorded as the cursor and compared against
   * the newest would read the very first push after the send as an arrival.
   */
  sentOn: { id: string | null } | null;
  /** The pending deadline, or `null` once it has fired or been cancelled. */
  timer: ReturnType<typeof setTimeout> | null;
  /** The offer stands and has not been spent. */
  offered: boolean;
  /** The activity subscription opened with the ticket. */
  unsubscribe: () => void;
}

const tickets = new Map<string, Ticket>();
const listeners = new Set<() => void>();

let nextGeneration = 0;

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Drops the session's ticket and everything it owns, and reports whether a
 * VISIBLE offer went with it — the only thing subscribers can see, so the only
 * thing worth waking them for.
 */
function drop(sessionId: string): boolean {
  const ticket = tickets.get(sessionId);
  if (!ticket) return false;
  if (ticket.timer !== null) clearTimeout(ticket.timer);
  ticket.unsubscribe();
  tickets.delete(sessionId);
  return ticket.offered;
}

/**
 * Any sign of life from the session withdraws the ticket: the offer's whole
 * claim is that the Return never landed, and a session producing output has
 * plainly received it. Read `attention` as life too — see the header — so the
 * transition rule and the deadline's gate ask exactly one question between
 * them.
 */
function onActivity(sessionId: string, state: string): void {
  if (state === "idle") return;
  if (drop(sessionId)) notify();
}

/** A composer submit opens a ticket, replacing any older one. Returns its generation. */
export function beginRetryTicket(sessionId: string): number {
  // The older ticket's timer and offer go with it: an offer for the previous
  // send would write a Return that this send has already written.
  const lostOffer = drop(sessionId);
  const generation = ++nextGeneration;
  const ticket: Ticket = {
    generation,
    sentOn: null,
    timer: null,
    offered: false,
    unsubscribe: () => {},
  };
  tickets.set(sessionId, ticket);
  // Opened after the ticket is in the map, and after `ticket.unsubscribe` has
  // a value to be overwritten. `subscribeActivity` adds to a set and replays
  // nothing, so no callback can arrive before this line returns — the ordering
  // is defence rather than a response to a first call that happens. What it
  // defends against is the channel ever gaining a replay: a listener reached
  // before the map write would find no ticket and silently do nothing, and one
  // reached before the assignment below would drop the ticket through the
  // no-op placeholder and leak the very watch it was closing.
  ticket.unsubscribe = subscribeActivity(sessionId, (state) => {
    onActivity(sessionId, state);
  });
  if (lostOffer) notify();
  return generation;
}

/**
 * The newest answer the cell held when this send went out, recorded so a NEWER
 * one can clear the ticket. Ignored when the current ticket already carries
 * one.
 *
 * `generation` is optional only because a caller may have no live ticket left
 * to stamp; every caller that HAS one passes it. Without it, a report from a
 * submit the user has moved past — one that spent three seconds in the
 * reconnect wait while they pressed Enter again — would write its stale
 * baseline into the ticket the newer send just opened. The consequence is
 * benign in today's tree, because a stale baseline is only ever OLDER than the
 * true one and the first real reply still differs from it; it is guarded
 * because this was the one ticket entry point where a superseded submit could
 * reach live state at all, and the other two ({@link armRetryOffer},
 * {@link clearRetryTicket}) already follow the rule.
 */
export function noteRetrySentOn(
  sessionId: string,
  sentOn: string | null,
  generation?: number,
): void {
  const ticket = tickets.get(sessionId);
  // The first push is the send's own newest-answer id; anything after it is a
  // surface re-reporting where the cell stands, and overwriting with that would
  // keep moving the goalposts the ticket is measured against.
  if (!ticket || ticket.sentOn !== null) return;
  if (generation !== undefined && ticket.generation !== generation) return;
  ticket.sentOn = { id: sentOn };
}

/** The initial Return was accepted — start the timer, if `generation` is still current. */
export function armRetryOffer(sessionId: string, generation: number): void {
  const ticket = tickets.get(sessionId);
  if (!ticket || ticket.generation !== generation || ticket.timer !== null) return;
  ticket.timer = setTimeout(() => {
    // The ticket may have been dropped, and `drop` clears this timer — but a
    // timer already handed to the queue cannot be unscheduled in every runtime,
    // so the fired callback re-reads the map rather than trusting its closure.
    const live = tickets.get(sessionId);
    if (!live || live.generation !== generation) return;
    live.timer = null;
    if (getActivityState(sessionId) !== "idle") {
      // Something is happening in there, so the Return was not lost and the
      // ticket has nothing left to offer.
      //
      // Guarded like every other withdrawal in this file, even though no
      // ticket reaching this line can be offered TODAY — the timer is armed
      // once, and `offered` is set two lines below it. It is guarded because
      // that is a property of the arming rule and not of this branch: an
      // `armRetryOffer` that ever ran again after a timer had fired would take
      // a VISIBLE offer down here, and an unnotified withdrawal leaves the
      // button on screen while `isRetryOffered` says it is gone — a control
      // that writes a Return nothing will accept.
      if (drop(sessionId)) notify();
      return;
    }
    live.offered = true;
    notify();
  }, RETRY_OFFER_MS);
}

/** Drop the ticket, its timer, its offer and its activity subscription. */
export function clearRetryTicket(sessionId: string, generation?: number): void {
  const ticket = tickets.get(sessionId);
  if (!ticket) return;
  // A failure report from a submit the user has already moved past must not
  // take the ticket their newer send just opened.
  if (generation !== undefined && ticket.generation !== generation) return;
  if (drop(sessionId)) notify();
}

/**
 * A newer utterance for the session clears the ticket; the recorded one does
 * not. A ticket that has recorded NOTHING adopts the id instead of being
 * cleared by it.
 *
 * ## What the caller must push
 *
 * The NEWEST answer the cell holds — `newestUtteranceId` in
 * `speech/utteranceQueue.ts` — never the one under the cursor. The cursor is
 * wrong in both directions, and both are silent:
 *
 * - it misses the arrival this function exists for. An answer landing while the
 *   voice is reading takes the queue reducer's `speaking: true` arm, which
 *   appends to `pending` and leaves `current` and the cursor exactly where they
 *   were. The id would be byte-identical, the pushing effect's deps unchanged,
 *   and a standing offer would sit through a genuine reply — then write a bare
 *   `\r` into a session that had just answered.
 * - it invents one that did not happen. `previous`/`next` move the same cursor,
 *   so a user stepping back to re-read while waiting would push a different id
 *   and drop the ticket. Nothing re-arms one — {@link armRetryOffer} is
 *   reachable only from `ptySubmit`'s `onReturnDelivered` — so the offer for a
 *   keypress that really was lost would vanish for good, on a gesture that says
 *   nothing whatever about whether the Return landed.
 *
 * {@link noteRetrySentOn} records the same value for the same reason: the
 * ticket has ONE slot, and a baseline in one vocabulary compared against pushes
 * in the other would read the first push after a send as an answer landing.
 *
 * ## Why an unrecorded ticket adopts rather than clears
 *
 * The comparison below is "is this a different answer from the one the send
 * replied to?", and a ticket with nothing recorded is not a ticket that
 * answers `yes` — it is one that has not been told what to compare against.
 * `beginRetryTicket` runs synchronously at the Enter; the id is recorded by
 * `noteRetrySentOn` when the body is WRITTEN, which is not the same instant —
 * a submit made while another is in flight waits behind it, and the reconnect
 * path can hold one for three seconds. Anything pushing the cell's id inside
 * that gap — the bar remounting on a layout change, the ordinary way a remount
 * happens — would otherwise take the ticket, and take it silently, because
 * nothing is on screen yet to vanish. The user would send, get no answer, and
 * get no offer either.
 *
 * So the first push adopts. `noteRetrySentOn` ignores every id after the
 * first, so the pane's own push stays authoritative for every ticket that got
 * that far, and this adoption only ever fills a ticket the pane has not
 * reached. Record-then-compare lives here rather than in the one caller
 * because it is one decision: a caller doing it in two statements is an
 * ordering a later edit can split or reorder with nothing to catch it.
 *
 * ## What the adoption can and cannot get wrong
 *
 * It is wrong only where the adopted id is NOT the one the send replied to —
 * an answer that landed between the Enter and the write. It cannot preserve a
 * VISIBLE offer even then: `noteRetrySentOn` is raised from `onDelivered` and
 * {@link armRetryOffer} from `onReturnDelivered`, which `ptySubmit` raises
 * strictly after it (the return is scheduled in that call's `finally`), so
 * every ticket that reaches a timer has already recorded an id, and the
 * unrecorded window closes before any offer can exist.
 *
 * The tempting stronger claim — that such an answer is output, so the session
 * is busy, so the activity watch withdraws the ticket anyway — is NOT a
 * certainty, and is not what this rests on. `recordOutput` in
 * `server/lib/terminalActivity.ts` notifies only `if (rec.state !== "busy")`,
 * so output into an already-busy session raises no event at all; and activity
 * rides its own socket (`/ws/terminal-activity`, 2s reconnect backoff) while
 * utterances ride the main realtime channel, so an answer can arrive while
 * `getActivityState` is frozen on a stale `idle`. The residual risk is
 * therefore real but bounded: the ticket adopts the one answer that landed in
 * the gap, and two seconds later the deadline's own `getActivityState(...) !==
 * "idle"` gate has to miss it too. The cost if both line up is one
 * user-initiated `\r` into a session that just answered.
 */
export function noteRetryUtterance(sessionId: string, utteranceId: string | null): void {
  const ticket = tickets.get(sessionId);
  if (!ticket) return;
  // Boxed, so that a cell with no answer yet records `{ id: null }` — a fact
  // about where the send went out from — rather than staying indistinguishable
  // from a ticket nothing has been recorded on.
  if (ticket.sentOn === null) {
    ticket.sentOn = { id: utteranceId };
    return;
  }
  // The id the send went out on is the cell standing still — the bar pushes it
  // on every mount and every render that changes nothing.
  if (ticket.sentOn.id === utteranceId) return;
  if (drop(sessionId)) notify();
}

/** Spend the offer. `true` at most once per ticket; `false` when nothing is offered. */
export function consumeRetryOffer(sessionId: string): boolean {
  const ticket = tickets.get(sessionId);
  if (!ticket || !ticket.offered) return false;
  // The whole ticket goes, not merely the flag: one accepted Return earns one
  // offer, and a refused retry is still an offer that was spent.
  drop(sessionId);
  notify();
  return true;
}

export function isRetryOffered(sessionId: string): boolean {
  return tickets.get(sessionId)?.offered ?? false;
}

export function subscribeAnswerRetry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** {@link isRetryOffered}, re-rendering the caller when the offer appears or goes. */
export function useRetryOffered(sessionId: string): boolean {
  return useSyncExternalStore(
    subscribeAnswerRetry,
    () => isRetryOffered(sessionId),
    () => isRetryOffered(sessionId),
  );
}

/** The session is gone: its ticket, timer, offer and activity watch go with it. */
export function forgetAnswerRetry(sessionId: string): void {
  if (drop(sessionId)) notify();
}

export function __resetAnswerRetryForTests(): void {
  for (const sessionId of [...tickets.keys()]) drop(sessionId);
  notify();
}
