import { useAggregateActivityFlags } from "./useTerminalActivityChannel";
import { useAttentionPulse } from "./useAttentionPulse";

/**
 * Aggregated activity indicator for a project row. Unlike a single collapsing
 * LED, this shows every state present at once:
 *  - a busy dot when any session is working,
 *  - a green "needs attention" dot when any session is waiting (even if another
 *    session is busy), and
 *  - a dim idle dot when sessions are open but none are busy or waiting — so the
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

  if (!hasAny) return null;

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
      {idleOnly && (
        <span
          className="terminal-led"
          data-state="idle"
          title="Idle (terminal open)"
          aria-label="Idle"
        />
      )}
    </span>
  );
}

export default ProjectActivityLed;
