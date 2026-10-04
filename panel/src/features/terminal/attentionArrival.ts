import { closeSessionNotifications } from "../notifications/registerServiceWorker";
import { sendDismiss } from "./terminalInstances";
import {
  type ActivityState,
  getActivityState,
  subscribeActivity,
} from "./useTerminalActivityChannel";

/**
 * The user has arrived at this cell: clear its attention LED if one is lit.
 *
 * `TerminalsSurface.handleFocus` has said this about a focused terminal since
 * the LED existed — the green "done" light is a *check me* notification, and a
 * notification is over the moment the person it was for is looking. Every other
 * arrival in the panel is that same sentence through a different door: the
 * caret landing in the answer composer, and a press of a play/pause control,
 * wherever that control happens to live.
 *
 * ## One rule, because five copies did not stay in step
 *
 * The doors are the cell header's speak button, the speech bar's play/pause
 * button, `Ctrl+Shift+Space`, the OS media session's `play` and `pause`, and
 * the composer's focus. For a while only two of them dismissed, which meant a
 * single cell carried two visible play buttons that disagreed about whether
 * the LED went out — the kind of inconsistency that is invisible in each file
 * and obvious on screen. This function is the rule; every door calls it, and
 * there is nowhere left for a sixth door to quietly diverge.
 *
 * ## Why a press of PAUSE dismisses too
 *
 * The rule is keyed on the gesture, not on the direction the transport moves.
 * Nobody pauses an answer they are not listening to, and an LED still burning
 * behind somebody who has heard the reply and stopped it to think about it is
 * precisely the stale notification the dismiss exists to prevent.
 *
 * It is also what keeps the surfaces identical. Three of the four transport
 * doors are ONE control whose meaning depends on where the run is — the bar's
 * button, the header's button, the chord — so a rule that fired only on the
 * play half would be a rule that depended on what the audio happened to be
 * doing when the user reached for it. The OS media session is the same control
 * split into two actions by the platform, so both of its actions call this for
 * the same reason.
 *
 * `previous` and `next` are deliberately NOT doors. They step between answers
 * the cell is already holding; this is the rule for arriving at a cell, not for
 * moving around inside something already in hand. Left out knowingly rather
 * than forgotten.
 *
 * ## Why only `attention`
 *
 * `busy` is the AGENT's state, not a message to the user, and turning it off
 * because somebody looked would claim the agent had stopped working. `idle` has
 * nothing to clear, so sending anyway would be a websocket frame per press that
 * changes nothing — which is why the check is here rather than left to the
 * server to ignore. The composer's focus is the case that settles it: that
 * field is focused and re-focused constantly while a reply is being written.
 *
 * ## Why the state is read imperatively
 *
 * `useActivityState` would work, and it would re-render exactly ONE cell —
 * `AnswerPane` already subscribes per session and nothing has ever noticed. So
 * the reason is not cost, it is shape: this fact is wanted only inside an event
 * handler, and nothing any caller RENDERS depends on it. Two of the callers are
 * not components at all — `useSpeechKeys` and `useMediaSessionTransport` bind
 * their handlers once and read through a ref — so for those there is no render
 * for a subscription to feed in the first place.
 *
 * ## Why `features/speech` is handed this rather than importing it
 *
 * Both facts read here belong to the terminal feature: the activity channel is
 * the terminal's, and the dismiss goes down the terminal's own socket. The
 * arrow between the two features already points terminal → speech, twenty-odd
 * times over, and `terminalInstances.ts` imports `speechTransportKeyFor` from
 * `features/speech/useSpeechKeys` — so a `useSpeechKeys` that imported this
 * would close a real import cycle through the panel's heaviest module, and drag
 * xterm into a suite that today needs nothing but React.
 *
 * The two hooks therefore take the arrival as a parameter and stay ignorant of
 * terminals. `SpeechHostProvider` passes this one in: it is already the single
 * place where the panel's one speech host is bolted onto the panel, so it is
 * the place that is allowed to know both sides.
 *
 * ## Why nothing here reports failure
 *
 * `sendDismiss` writes a frame on an OPEN socket and returns; a session with no
 * instance, or with a socket that is not open, is a silent no-op — see
 * `terminalInstances.test.ts`, which pins that. A dropped dismiss costs a stale
 * LED until the next activity broadcast, which is not worth a toast over a
 * gesture the user made for another reason entirely.
 *
 * Silent is not the same as blind, though: `sendDismiss` reports whether the
 * frame was written, and one door needs that. Every door above is a gesture
 * inside a running page, where the cell's socket is already open. The one
 * that is not is a notification tapped with no panel running: that page is
 * opened for the tap, and the tap is processed before the cell has a socket —
 * or before the channel has even said the session is waiting.
 * {@link dismissAttentionWhenReady} is the same rule for that door, kept alive
 * until the channel says it landed.
 *
 * ## The system notification goes out with the LED
 *
 * A session that wanted you while the panel was hidden may also have raised a
 * system notification (`features/notifications`), tagged with its session id.
 * Closing it is part of THIS rule rather than a sixth door beside it, so every
 * door above — and tapping the notification itself — puts out both together,
 * and neither can outlive the other.
 *
 * It sits behind the same `attention` check, deliberately. The rule outside
 * `attention` stays a no-op exactly as before: the spec closes a notification
 * on "a gesture that already dismisses attention", and the composer's focus,
 * which fires constantly, should not go to the service worker for nothing. A
 * notification is raised only on the edge INTO `attention`, so one still
 * showing for a session that has since left it is stale news that the next
 * attention edge replaces (same tag) or the user swipes away. That trade was
 * taken over widening the rule.
 *
 * `closeSessionNotifications` is fire-and-forget and never throws, so the
 * rule stays synchronous and silent for every existing caller.
 */
export function dismissAttentionOnArrival(sessionId: string): void {
  if (getActivityState(sessionId) !== "attention") return;
  sendDismiss(sessionId);
  closeSessionNotifications(sessionId);
}

/**
 * The rule as one attempt that only counts when the frame went out. A miss
 * leaves the notification alone too: retried every few hundred milliseconds,
 * closing it on every miss would be a service-worker round trip per tick for a
 * notification the tap has already closed.
 */
function dismissIfReady(sessionId: string): boolean {
  if (getActivityState(sessionId) !== "attention") return false;
  if (!sendDismiss(sessionId)) return false;
  closeSessionNotifications(sessionId);
  return true;
}

/** How often {@link dismissAttentionWhenReady} looks again for an open socket. */
export const ARRIVAL_RETRY_MS = 250;

/** The most dismisses one {@link dismissAttentionWhenReady} wait will send. */
export const ARRIVAL_MAX_SENDS = 3;

/**
 * The arrival rule for a page that is still starting: keep applying
 * {@link dismissAttentionOnArrival}'s rule until the channel publishes `idle`
 * for the session after a dismiss went out, or `timeoutMs` passes. Returns a
 * cancel function; calling it after the wait ended is harmless.
 *
 * Two facts may be missing when the arrival happens: the channel may not have
 * said the session is in `attention` yet (looked at again on every state it
 * publishes for the session), and the cell may not have acquired its terminal
 * and opened its socket yet (nothing announces that to this module, so it is
 * polled every `retryMs`).
 *
 * ## Why a sent frame is not the end of it
 *
 * The socket's first act on opening is a `resize`, and the server answers the
 * attach by resizing the PTY: the TUI repaints, and that output flips the
 * session from `attention` to `busy` on the server. A dismiss written right
 * after the open lands there while the session is `busy`, the server's dismiss
 * clears only `attention`, so the frame is dropped — and once the repaint goes
 * quiet the session settles back into `attention` and the LED relights. This
 * page still read `attention` when it sent, because the `busy` broadcast had
 * not arrived yet. So success is the channel saying `idle`, not the write.
 *
 * Sends are rationed per attention episode: after a send, nothing more goes
 * out until the channel has published something other than `attention` and
 * then `attention` again — the flap a swallowed dismiss produces. A republished
 * `attention` within the same episode is not a reason to send again. At most
 * `maxSends` go out in total; past that the wait ends, since a session that
 * keeps relighting is not one more frame away from going dark.
 *
 * An `idle` before anything was sent does not end the wait: on a cold start
 * the channel's first word may well be a state the session leaves for
 * `attention` a moment later. A session that never gets there — it was
 * dismissed elsewhere, or its cell never mounts — is let go in silence at the
 * timeout, for the same reason a dropped dismiss is silent everywhere else.
 */
export function dismissAttentionWhenReady(
  sessionId: string,
  {
    timeoutMs,
    retryMs = ARRIVAL_RETRY_MS,
    maxSends = ARRIVAL_MAX_SENDS,
  }: { timeoutMs: number; retryMs?: number; maxSends?: number },
): () => void {
  let settled = false;
  let sends = 0;
  // True from a send until the channel publishes a state other than attention.
  let sentThisEpisode = false;

  const stop = () => {
    if (settled) return;
    settled = true;
    unsubscribe();
    clearInterval(interval);
    clearTimeout(timeout);
  };
  const attempt = () => {
    if (settled || sentThisEpisode) return;
    if (!dismissIfReady(sessionId)) return;
    sends += 1;
    sentThisEpisode = true;
    if (sends >= maxSends) stop();
  };
  const onState = (state: ActivityState) => {
    if (settled) return;
    if (state === "attention") {
      attempt();
      return;
    }
    if (state === "idle" && sends > 0) {
      stop();
      return;
    }
    sentThisEpisode = false;
  };

  const unsubscribe = subscribeActivity(sessionId, onState);
  const interval = setInterval(attempt, retryMs);
  const timeout = setTimeout(stop, timeoutMs);
  attempt();
  return stop;
}
