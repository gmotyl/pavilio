import { usePanelSpeech } from "../speech/SpeechHostProvider";
import { SessionSpeaker } from "./SessionSpeaker";
import { useAggregateActivityFlags } from "./useTerminalActivityChannel";
import { useAttentionPulse } from "./useAttentionPulse";

/**
 * Aggregated activity indicator for a project row. Unlike a single collapsing
 * LED, this shows every state present at once:
 *  - a busy dot when any session is working,
 *  - a green "needs attention" dot when any session is waiting (even if another
 *    session is busy),
 *  - a speaker when any session is being spoken, and
 *  - a dim idle dot when sessions are open but none of the above holds — so the
 *    row still signals "something is open here".
 * Renders nothing when the project has no open terminals.
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

  if (!hasAny) return null;

  // WHY the speaker is a flag in this group rather than a replacement for it:
  // the collapsed row is where a listener finds which project is talking, so
  // speaking has to be visible here — but it is a status like busy or
  // attention, not a summary of the project. Collapsing the group down to the
  // speaker would hide an attention signal that belongs to a DIFFERENT session,
  // for as long as the audio plays. Only one cell can make sound at a time, so
  // the first speaking id names the icon.
  const speakingId = sessionIds.find((id) => stateFor(id) === "speaking");

  const idleOnly = !hasBusy && !hasAttention;

  return (
    <span className="flex items-center gap-1">
      {hasBusy && (
        <span className="terminal-led" data-state="busy" title="Busy" />
      )}
      {hasAttention && (
        <span
          className="terminal-led"
          data-state="attention"
          data-pulse={pulsing ? "1" : "0"}
          title="Needs attention"
          aria-label="Needs attention"
        />
      )}
      {/* The speaker takes the idle dot's slot: "idle" says nothing the speaker
          does not already imply, while busy and attention do. */}
      {speakingId !== undefined ? (
        <SessionSpeaker sessionId={speakingId} />
      ) : (
        idleOnly && (
          <span
            className="terminal-led"
            data-state="idle"
            title="Idle (terminal open)"
            aria-label="Idle"
          />
        )
      )}
    </span>
  );
}

export default ProjectActivityLed;
