import { useEffect, useState } from "react";
import { useAggregateActivityState } from "./useTerminalActivityChannel";

export const ATTENTION_PULSE_MS = 5 * 60 * 1000; // 5 min

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
  const [pulsing, setPulsing] = useState<boolean>(() =>
    attentionSinceAt != null &&
    Date.now() - attentionSinceAt < ATTENTION_PULSE_MS,
  );

  useEffect(() => {
    if (state !== "attention" || attentionSinceAt == null) {
      setPulsing(false);
      return;
    }
    const elapsed = Date.now() - attentionSinceAt;
    if (elapsed >= ATTENTION_PULSE_MS) {
      setPulsing(false);
      return;
    }
    setPulsing(true);
    const t = setTimeout(
      () => setPulsing(false),
      ATTENTION_PULSE_MS - elapsed,
    );
    return () => clearTimeout(t);
  }, [state, attentionSinceAt]);

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
