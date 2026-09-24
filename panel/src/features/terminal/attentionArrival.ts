import { sendDismiss } from "./terminalInstances";
import { getActivityState } from "./useTerminalActivityChannel";

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
 */
export function dismissAttentionOnArrival(sessionId: string): void {
  if (getActivityState(sessionId) !== "attention") return;
  sendDismiss(sessionId);
}

export default dismissAttentionOnArrival;
