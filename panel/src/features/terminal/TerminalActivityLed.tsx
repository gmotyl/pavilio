import { useAggregateActivityState } from "./useTerminalActivityChannel";
import { ATTENTION_PULSE_MS, useAttentionPulse } from "./useAttentionPulse";

export { ATTENTION_PULSE_MS };

type Props = {
  size?: "sm" | "lg";
  title?: string;
  hideWhenIdle?: boolean;
} & ({ sessionId: string } | { sessionIds: readonly string[] });

const LABEL: Record<string, string> = {
  idle: "Idle",
  busy: "Busy",
  attention: "Needs attention",
};

/**
 * Tri-state activity LED. Pass `sessionId` for a single session or
 * `sessionIds` for an aggregate (busy > attention > idle).
 * See index.css for the per-state colors and pulse animations.
 */
export function TerminalActivityLed(props: Props) {
  const { size = "sm", title, hideWhenIdle } = props;
  const ids: readonly string[] =
    "sessionId" in props ? [props.sessionId] : props.sessionIds;
  const { state, attentionSinceAt } = useAggregateActivityState(ids);
  const pulsing = useAttentionPulse(attentionSinceAt, state === "attention");

  if (hideWhenIdle && state === "idle") return null;

  return (
    <span
      className={`terminal-led ${size === "lg" ? "terminal-led-lg" : ""}`}
      data-state={state}
      data-pulse={state === "attention" && pulsing ? "1" : "0"}
      title={title ?? LABEL[state]}
      aria-label={LABEL[state]}
    />
  );
}

export default TerminalActivityLed;
