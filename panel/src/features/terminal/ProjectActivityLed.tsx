import { usePanelSpeech } from "../speech/SpeechHostProvider";
import { SessionSpeaker } from "./SessionSpeaker";
import { useAggregateActivityFlags } from "./useTerminalActivityChannel";
import { useAttentionPulse } from "./useAttentionPulse";

/**
 * The aggregate activity dot for a project row: one fixed-width slot holding
 * at most one thing, picked by priority —
 *  1. a speaker when any session of the project is being spoken,
 *  2. a green "needs attention" dot when any session is waiting,
 *  3. a busy dot when any session is working,
 *  4. a dim idle dot when sessions are open but none of the above holds.
 * With no open terminals the slot renders empty. It is never dropped: every
 * project row reserves the same width before its mark tile, so the tiles line
 * up whether a row has a dot or not.
 */
export function ProjectActivityLed({
  sessionIds,
}: {
  sessionIds: readonly string[];
}) {
  const { hasBusy, hasAttention, hasAny, attentionSinceAt } =
    useAggregateActivityFlags(sessionIds);
  const pulsing = useAttentionPulse(attentionSinceAt, hasAttention);
  const { stateFor } = usePanelSpeech();

  // WHY attention wins over busy: a waiting session must never be hidden by a
  // working one. The speaker outranks both only while its audio plays — the
  // row is where a listener finds which project is talking. Only one cell can
  // make sound at a time, so the first speaking id names the icon.
  const speakingId = hasAny
    ? sessionIds.find((id) => stateFor(id) === "speaking")
    : undefined;

  let content = null;
  if (speakingId !== undefined) {
    content = <SessionSpeaker sessionId={speakingId} />;
  } else if (hasAttention) {
    content = (
      <span
        className="terminal-led"
        data-state="attention"
        data-pulse={pulsing ? "1" : "0"}
        title="Needs attention"
        aria-label="Needs attention"
      />
    );
  } else if (hasBusy) {
    content = (
      <span
        className="terminal-led"
        data-state="busy"
        title="Busy"
        aria-label="Busy"
      />
    );
  } else if (hasAny) {
    content = (
      <span
        className="terminal-led"
        data-state="idle"
        title="Idle (terminal open)"
        aria-label="Idle"
      />
    );
  }

  return (
    <span className="project-activity-slot" data-testid="project-activity-slot">
      {content}
    </span>
  );
}

export default ProjectActivityLed;
