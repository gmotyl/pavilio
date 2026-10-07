/**
 * The **speaking alert**: one persistent in-page card naming whose voice is
 * playing — `Speaking — <project> · <terminal label>` — so a run started by
 * autoplay in a cell (or a project) the user is not looking at can be placed,
 * and reached with one click.
 *
 * It follows the voice, not a cell: one card (`speech-speaking`), raised when a
 * run starts, manual or autoplay, and refreshed in place when the voice moves
 * on to another cell — a barge-in, or the autoplay queue's next answer, which
 * the host reports as a `start` with no `end` in between. Pausing, stopping or
 * the voice running out takes it down programmatically; a resume brings it back.
 *
 * Two user gestures hide it **for the rest of that run**, and the next run
 * raises it again:
 *
 * - The × (or a swipe): the user said they do not want it. Re-raising it on
 *   the next pause/resume of the same run would be arguing with them.
 * - A click: it is `arriveFromNotification` for the speaking cell, so the user
 *   is now looking at the cell that is speaking — the card has done its job,
 *   and bringing it back over the cell it names would be noise. The click
 *   arrives and nothing else: playback goes on.
 *
 * Speech never moves the view by itself. Navigation happens only inside the
 * click; raising, refreshing and dismissing the card touch the alerts store and
 * nothing else.
 */
import { alerts } from "../alerts/store";
import { terminalLabel } from "../notifications/notificationText";
import { arriveAtCell, type AnswerAlertDeps } from "./answerAlert";
import type { SpeechRunEvent } from "./useSpeechHost";

export const SPEAKING_ALERT_ID = "speech-speaking";

export function speakingAlertTitle(project: string, label: string): string {
  return `Speaking — ${project} · ${label}`;
}

/** What the speaking alert needs from the panel: the same plumbing as the answer alert's. */
export type SpeakingAlertDeps = Pick<AnswerAlertDeps, "sessionOf" | "navigate">;

/**
 * The card's state machine, fed the host's run events (`onRunChange`). Returns
 * the listener; `dispose` takes the card down for good (the provider's unmount).
 */
export function createSpeakingAlert(deps: SpeakingAlertDeps): {
  onRunChange: (event: SpeechRunEvent) => void;
  dispose: () => void;
} {
  /** The cell the voice is in, or null while it is silent. */
  let speaking: string | null = null;
  /** Bumped per run, so a gesture on an older run's card cannot hide a newer run's. */
  let run = 0;
  /** The run whose card the user closed or clicked; hidden until the next run. */
  let hiddenRun = -1;

  function raise(): void {
    const sessionId = speaking;
    if (!sessionId || hiddenRun === run) return;
    const session = deps.sessionOf(sessionId);
    // A session the panel does not list has nothing to name or arrive at.
    if (!session) {
      alerts.dismiss(SPEAKING_ALERT_ID);
      return;
    }
    const raisedFor = run;
    alerts.info(speakingAlertTitle(session.project, terminalLabel(session)), {
      id: SPEAKING_ALERT_ID,
      persistent: true,
      // The × and the swipe — never the programmatic dismissals below.
      onDismiss: () => {
        hiddenRun = raisedFor;
      },
      onClick: () => {
        hiddenRun = raisedFor;
        arriveAtCell(sessionId, session.project, deps);
      },
    });
  }

  return {
    onRunChange(event) {
      switch (event.type) {
        case "start":
          speaking = event.sessionId;
          run += 1;
          raise();
          return;
        case "resume":
          raise();
          return;
        case "pause":
          alerts.dismiss(SPEAKING_ALERT_ID);
          return;
        case "end":
          speaking = null;
          alerts.dismiss(SPEAKING_ALERT_ID);
          return;
      }
    },
    dispose() {
      speaking = null;
      alerts.dismiss(SPEAKING_ALERT_ID);
    },
  };
}
