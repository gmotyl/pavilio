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
 */

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

interface Submission {
  readonly send: (data: string) => void;
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

function write(sessionId: string, submission: Submission): void {
  submission.send(submission.body);
  timers.set(
    sessionId,
    setTimeout(() => {
      timers.delete(sessionId);
      submission.send(RETURN);
      const queued = queues.get(sessionId);
      const next = queued?.shift();
      if (!next) {
        queues.delete(sessionId);
        return;
      }
      write(sessionId, next);
    }, SUBMIT_RETURN_MS),
  );
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
 */
export function submitToPty(
  sessionId: string,
  send: (data: string) => void,
  body: string,
): void {
  const queued = queues.get(sessionId);
  if (queued) {
    queued.push({ send, body });
    return;
  }
  queues.set(sessionId, []);
  write(sessionId, { send, body });
}

/** Drops every queued submit and the returns still scheduled for them. */
export function __resetPtySubmitForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  queues.clear();
}
