/**
 * Submitting a line of text to a PTY: the body, and then the return that runs
 * it as a write of its own.
 *
 * ## The bug this exists for
 *
 * Every caller used to build one string — `` `${text}\r` `` — and hand it to
 * the cell's `send`. That is one `{ type: "input" }` websocket frame, and the
 * server turns one frame into one `session.pty.write(...)` (`server/watcher.ts`).
 * So the body and the return reached the TUI's stdin as a single burst.
 *
 * A TUI is entitled to read that burst as one thing. Claude Code is an Ink
 * app with bracketed paste enabled on its stdin, and a large arriving chunk is
 * a PASTE: everything in it, the trailing `\r` included, goes into the
 * multi-line editor as text. The reply appeared in the prompt and sat there
 * until the user pressed Enter themselves — Greg's "zacina się wysyłka".
 *
 * It tracked the size and shape of what was sent, which is why it read as
 * intermittent: `claude\r` from a launcher pill is small enough to be taken as
 * typing and runs, while a multi-paragraph reply is not.
 *
 * The fix is to stop asking the TUI to tell body from submit inside one write.
 * The body goes now; the return goes on a later turn of the event loop, as its
 * own frame, so what the app sees is a paste and then a keypress.
 *
 * ## Why a delay rather than a microtask
 *
 * A microtask still runs inside the same task: both frames would leave the
 * socket back to back, arrive in the same TCP segment as often as not, and be
 * read from the pty as one chunk again — which is the burst this is splitting.
 * The gap has to be a real one. {@link SUBMIT_RETURN_MS} is a few tens of
 * milliseconds: long enough that the reader drains the paste first,
 * imperceptible to the person who pressed the button.
 *
 * This is not a timer that DECIDES anything — it schedules a write that was
 * already decided on. Nothing here reads or changes the answer pane's waiting
 * state, whose exits stay the events `answerWaiting.ts` documents.
 *
 * ## Why the queue
 *
 * Two submits in quick succession — the send button pressed twice, a pill and
 * then a reply — must not produce `body1 body2 \r \r` on one prompt line. So a
 * session's submits are serialised: while one is in flight the next body is
 * held back, and it is written only once the return before it has gone out.
 * Per session, because two cells are two PTYs and neither should wait on the
 * other.
 *
 * ## Why a submit can fail, and what failing means here
 *
 * `send` reports whether the frame reached an OPEN socket. It used to report
 * nothing at all, which is how a reply typed into the answer form on a dead
 * socket vanished: the body was dropped in silence, this module believed it had
 * gone and scheduled the return, and the composer cleared. So a refusal is
 * propagated to whoever asked for the submit, through {@link SubmitFailure},
 * and the two halves are told apart because they mean opposite things to the
 * caller. A refused BODY means nothing at all reached the agent — the text is
 * still only in the browser, and the composer must keep it. A refused RETURN
 * means the body is sitting in the TUI's prompt unsubmitted — the text exists
 * on the far side, so putting it back in the composer would make two copies of
 * one reply, and what the user needs is to be told the line never ran.
 *
 * Delivery is reported for the same reason refusal is. A caller that moves the
 * UI on — the answer pane into its waiting state, the launcher row from its
 * pills to `start` — must do it where the body is actually written, and for a
 * submit held behind another that is a gap after the click that asked for it.
 * So the two are one report with two halves ({@link SubmitReport}) rather than
 * a refusal channel beside a return value nobody could trust.
 *
 * Nothing is queued for a retry and nothing is re-attempted on reconnect. That
 * was weighed and rejected: an answer that lands two minutes later replies to a
 * prompt the agent has moved past, and a silent retry is a worse failure than
 * an honest refusal.
 *
 * ## Why a refused BODY is nevertheless offered the socket a second time
 *
 * That paragraph rules out remembering a refused submit. It does not rule out
 * finishing the gesture the user is still in the middle of. A refused body
 * almost always means one thing — the socket under this cell died while nobody
 * was looking — and the repair for it already exists and is already permitted:
 * ADR 0010 holds that activating a session is consent to reopen it, and a send
 * is as explicit an activation as there is. So a refused body reconnects the
 * session and offers the SAME frame to the replacement socket ONCE, inside the
 * same gesture, before reporting anything.
 *
 * This is emphatically not the rejected retry queue. Nothing is remembered
 * across the gesture, nothing is re-attempted on a later reconnect this module
 * did not ask for, there is no second retry, and {@link RECONNECT_WAIT_MS}
 * bounds the whole thing. What changes for the user is only which answer comes
 * first: the socket is repaired first, and the refusal text is the second
 * resort rather than the first response.
 *
 * Three cases are deliberately NOT reconnected, because in each of them a
 * reopen would repair nothing and the wait would only delay the truth:
 *
 * - the session has EXITED — a dead agent is not a dead socket, and reattaching
 *   to a process that is gone says nothing about why the send failed;
 * - the session is UNATTACHED — this browser holds no terminal for it, so
 *   `reconnectSession` is a no-op and there is no handshake to wait on;
 * - the send SUCCEEDED — a live socket has nothing to repair, which is why a
 *   healthy submit never reaches any of this.
 *
 * ## Why the retry cannot be a straight-line one
 *
 * `send` is synchronous and a reconnect is not: a fresh WebSocket has to open,
 * which happens turns later and may not happen at all. So the retry is parked
 * on the session's connection state and woken by it — `onConnectionChange`
 * reports "connected" when the replacement socket's handshake lands, and
 * "disconnected" when it fails, and those are exactly the two answers the retry
 * is waiting for.
 *
 * The subscription is taken AFTER the reconnect, and that ordering is
 * load-bearing. `connectWs` emits an optimistic "connected" at the ws identity
 * swap, synchronously inside `reopen()`, while the new socket is still
 * CONNECTING — a retry woken by THAT emit would write into a socket that is not
 * open yet and report a refusal for a reconnect that was about to succeed.
 * Subscribing after the reconnect steps over it, so the first event this hears
 * is the handshake's own.
 *
 * And the wait is bounded by a timer, because a handshake that neither opens
 * nor errors emits nothing at all. A submit that never finishes never calls
 * {@link advance}, and `advance` is what hands on the session's turn — so an
 * unbounded wait would not merely lose this reply, it would freeze every later
 * submit on the cell behind a submit that can never complete. The bound turns
 * the worst case back into the failure the user already understands.
 *
 * A refused body does not strand the submits behind it either. There is no
 * return to wait for — nothing was written that a return could submit — so the
 * queue advances immediately instead of after {@link SUBMIT_RETURN_MS}, and
 * each entry is attempted and reports its own refusal. Dropping the rest of the
 * queue on the floor would put this module straight back in the business of
 * losing text without saying so.
 *
 * ## Why the bookkeeping sits in a `finally`
 *
 * Every report raised here — the delivery, either refusal — is a call into code
 * this module does not own and cannot vet. The answer composer hands over the
 * pane's move into its waiting state, the launcher row hands over a store
 * notification that reaches every subscriber of it, and any of that is entitled
 * to throw. What must not follow from a caller throwing is that the queue is
 * left mid-submit. A session's entry in {@link queues} IS its busy flag, so an
 * entry left standing with no return scheduled and no {@link advance} to come
 * is a cell whose composer and launcher pills are dead until the page is
 * reloaded: every later submit for it is pushed onto an array nothing will ever
 * drain. That invariant belongs to the queue and must not be contingent on how
 * a caller behaves, so each report is raised inside a `try` whose `finally`
 * carries out the bookkeeping that was owed.
 *
 * On the delivered path that `finally` also owes the return itself. The body is
 * already on the socket by the time the caller hears about it, so a caller that
 * throws out of `onDelivered` must not take the return down with it — that
 * would leave the user's line sitting in the TUI's prompt with nobody having
 * pressed Enter on it, which is a worse outcome than the throw it came from.
 *
 * The exception is not swallowed: `finally` rather than `catch`, deliberately.
 * The bookkeeping happens and the error goes on propagating to the caller, who
 * is the one with the bug to fix. An error quietly eaten in the submit path is
 * the very class of defect the rest of this file exists to undo.
 */

import {
  getConnectionState,
  hasExited,
  onConnectionChange,
  reconnectSession,
} from "./terminalInstances";

/** The submitting return itself — the key the TUI runs a line on. */
const RETURN = "\r";

/**
 * How long the return waits behind its body.
 *
 * Tens of milliseconds, deliberately: a microtask or a `0` timeout leaves both
 * writes in the same burst (see above), and anything long enough to notice
 * would make the send feel lagged.
 */
export const SUBMIT_RETURN_MS = 40;

/**
 * How long a refused body waits for the socket it just asked to be rebuilt.
 *
 * Three seconds, and the number is chosen from both ends. A ws handshake to
 * the panel is milliseconds on a LAN and well under a second over a tunnel to
 * a phone, so three seconds is several times the worst honest case — a
 * reconnect that has not landed by then is not slow, it is not coming. And it
 * is the longest the session's queue can be stalled by one refused submit
 * (see "Why the retry cannot be a straight-line one" above), which is the cost
 * side: three seconds of a launcher pill or a second reply waiting its turn is
 * a pause, where thirty would read as the cell having died.
 *
 * It is a ceiling and not a delay: the common outcomes — handshake open,
 * handshake failed — both arrive as events and settle the wait the moment they
 * do, so this timer only ever fires for a socket that has gone silent.
 */
export const RECONNECT_WAIT_MS = 3000;

/**
 * Which half of a submit was refused.
 *
 * `"body"` — nothing reached the PTY; the text is still only in the browser.
 * `"return"` — the body landed and the return that runs it did not, so the
 * text is in the TUI's prompt with nobody having pressed Enter on it.
 */
export type SubmitFailure = "body" | "return";

/**
 * How a submit reports what became of it.
 *
 * Both halves are optional and a submit raises at most one of them: a body
 * either reaches the socket, in which case {@link SubmitReport.onDelivered} is
 * raised there and then, or it does not, in which case
 * {@link SubmitReport.onFailed} is. A refused RETURN comes after a delivered
 * body and is the one case that raises both, in that order — which is the
 * truth of it: the text IS on the far side, it simply has not been run.
 *
 * An object rather than two positional callbacks because the two mean opposite
 * things and nothing in a call site reading `submitToPty(id, send, body, f, g)`
 * would say which was which.
 */
export interface SubmitReport {
  /**
   * The body has just been written to an OPEN socket. Raised at most once, at
   * the moment of that write — which is NOT necessarily the moment the submit
   * was asked for: a submit made while the session already has one in flight
   * is enqueued, and is written a gap later when its turn comes.
   *
   * That timing is the whole reason this is a callback rather than a boolean
   * returned from {@link submitToPty}. A caller that ADVANCES on a submit —
   * the answer pane's waiting state, the launcher row swapping its pills for
   * `start` — has to advance on the write, and anything it could read
   * synchronously on an enqueued submit would be a guess about a write that
   * has not happened yet.
   */
  readonly onDelivered?: () => void;
  /** Raised at most once, with the half that was refused. */
  readonly onFailed?: (stage: SubmitFailure) => void;
}

interface Submission extends SubmitReport {
  readonly send: (data: string) => boolean;
  readonly body: string;
}

/**
 * The submits a session has queued BEHIND the one in flight. An entry exists
 * exactly while that session has a submit in flight, so its presence is also
 * the "busy" flag — a separate set would be the same fact written twice.
 */
const queues = new Map<string, Submission[]>();

/** The pending return per session, so a reset can drop it. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * How to abandon the reconnect wait a session is sitting in, per session.
 *
 * At most one entry per session by construction: a session waiting on a
 * reconnect has a submit in flight, and the queue lets it have only one.
 * Exists so {@link __resetPtySubmitForTests} can drop a wait's subscription
 * and its timer, the same way it drops a pending return.
 */
const reconnectWaits = new Map<string, () => void>();

/**
 * Hand the session's turn to whatever is queued behind the submit that has
 * just finished — delivered or refused — and forget the session when nothing
 * is.
 */
function advance(sessionId: string): void {
  const queued = queues.get(sessionId);
  const next = queued?.shift();
  if (!next) {
    queues.delete(sessionId);
    return;
  }
  write(sessionId, next);
}

/**
 * The body reached the socket: tell the caller, and owe the return.
 *
 * Reached from the first attempt and from the retry alike, because a body
 * delivered after a reconnect is a delivery in every way that matters — it is
 * on the far side, the caller may move its UI on, and the line still needs the
 * keypress that runs it.
 */
function deliver(sessionId: string, submission: Submission): void {
  // The body is on the socket. Said HERE rather than where the submit was
  // asked for, because this line is the first moment it is true — for an
  // enqueued submit it runs a gap after the caller's own code did, and for a
  // retried one a reconnect after that.
  //
  // The return is scheduled in the `finally` because from this line on the body
  // exists on the far side: a caller that throws out of `onDelivered` must
  // still get the keypress that runs the line, or its own bug becomes a reply
  // left unsubmitted in the agent's prompt.
  try {
    submission.onDelivered?.();
  } finally {
    timers.set(
      sessionId,
      setTimeout(() => {
        timers.delete(sessionId);
        // The body is on the far side either way: a refused return leaves it in
        // the prompt, which is a different failure from having sent nothing.
        // The queue is handed on regardless, for the reason it is above.
        try {
          if (!submission.send(RETURN)) submission.onFailed?.("return");
        } finally {
          advance(sessionId);
        }
      }, SUBMIT_RETURN_MS),
    );
  }
}

/**
 * Nothing reached the PTY, and nothing is going to. Report it and hand on the
 * session's turn.
 *
 * There is nothing for a return to submit and no reason to make the next
 * submit wait a gap that only exists to separate a paste from a keypress. The
 * handing on of the session's turn is owed whatever the caller's own code does
 * with the news — see "Why the bookkeeping sits in a `finally`" above.
 */
function reportBodyRefused(sessionId: string, submission: Submission): void {
  try {
    submission.onFailed?.("body");
  } finally {
    advance(sessionId);
  }
}

/**
 * Is there a socket here worth rebuilding?
 *
 * The same predicate `reconnectOnActivate` guards itself with, minus its
 * "already connected" arm: a send has just been refused, so whatever the pool
 * last announced, this cell's socket is not usable right now — a CLOSING one,
 * or one still mid-handshake, both read as "connected" and both refuse writes.
 * What is left to rule out is the two states a reopen genuinely cannot help.
 */
function canRepairSocket(sessionId: string): boolean {
  if (hasExited(sessionId)) return false;
  return getConnectionState(sessionId) !== "unattached";
}

/**
 * Rebuild the session's socket and offer the body to it once.
 *
 * The submit stays in flight for the whole of this — the session's entry in
 * {@link queues} is untouched — so anything submitted meanwhile is enqueued
 * behind it rather than written past it or dropped.
 */
function reconnectAndRetry(sessionId: string, submission: Submission): void {
  // `auto-activate` is the reconnect log's own name for "reconnected because
  // the user activated this session". A send is that, from a narrower control
  // than a focus; sharing the trigger keeps the two halves of ADR 0010's
  // consent legible as one line in the log rather than two vocabularies.
  //
  // Called BEFORE the subscription below on purpose: the optimistic
  // "connected" this emits at the ws identity swap must not be mistaken for
  // the handshake landing. See the module header.
  reconnectSession(sessionId, "auto-activate");

  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  /** Stop listening and stop counting; safe to call more than once. */
  const stopWaiting = (): void => {
    settled = true;
    unsubscribe?.();
    unsubscribe = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  /**
   * The one retry, or the refusal — whichever the wait ended in. Guarded by
   * `settled` because the timer and the connection event race each other, and
   * a second entry here would be the second attempt this must not make.
   */
  const settle = (socketIsBack: boolean): void => {
    if (settled) return;
    stopWaiting();
    reconnectWaits.delete(sessionId);
    if (socketIsBack && submission.send(submission.body)) {
      deliver(sessionId, submission);
      return;
    }
    // Either the reconnect failed, or it succeeded and the frame was refused
    // anyway. Both are the end of it: the user is told, the draft is still
    // theirs, and the queue moves on.
    reportBodyRefused(sessionId, submission);
  };

  unsubscribe = onConnectionChange(sessionId, (state) => {
    settle(state === "connected");
  });
  timer = setTimeout(() => settle(false), RECONNECT_WAIT_MS);
  reconnectWaits.set(sessionId, stopWaiting);
}

function write(sessionId: string, submission: Submission): void {
  if (submission.send(submission.body)) {
    deliver(sessionId, submission);
    return;
  }
  // Refused. Almost always a socket that died while nobody was looking, and
  // the user pressing send is the consent to rebuild it (ADR 0010) — so the
  // refusal text is the second resort, not the first response.
  if (canRepairSocket(sessionId)) {
    reconnectAndRetry(sessionId, submission);
    return;
  }
  reportBodyRefused(sessionId, submission);
}

/**
 * Write `body` to the session's PTY and submit it.
 *
 * `send` is passed in rather than looked up: the callers already hold the
 * cell's own write — `TerminalView`'s `send`, read off the live instance at
 * call time — and one of them wraps it (the answer pane). `sessionId` is only
 * the queue's key.
 *
 * `body` is written verbatim and is never trimmed or split: its newlines are
 * the user's, and a per-line write would submit each line separately.
 *
 * `report` is how a caller hears what became of the submit — see
 * {@link SubmitReport}. Both halves are optional because not every caller has
 * somewhere to say it, but a caller that CLEARS anything on submit needs
 * `onFailed`, or it is clearing on the strength of a write that never
 * happened, and a caller that ADVANCES on one needs `onDelivered`, for the
 * same reason read the other way round.
 */
export function submitToPty(
  sessionId: string,
  send: (data: string) => boolean,
  body: string,
  report: SubmitReport = {},
): void {
  const queued = queues.get(sessionId);
  if (queued) {
    queued.push({ send, body, ...report });
    return;
  }
  queues.set(sessionId, []);
  write(sessionId, { send, body, ...report });
}

/**
 * Drops every queued submit, the returns still scheduled for them, and any
 * reconnect a refused body is still waiting on — a wait left behind would keep
 * a connection subscription and a timer alive into the next test and settle
 * against a submission that file has forgotten about.
 */
export function __resetPtySubmitForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  for (const stopWaiting of reconnectWaits.values()) stopWaiting();
  reconnectWaits.clear();
  queues.clear();
}
