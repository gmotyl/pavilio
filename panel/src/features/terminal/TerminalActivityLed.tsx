import { useEffect, useState } from "react";
import {
  useActivityState,
  useAttentionSinceAt,
} from "./useTerminalActivityChannel";

export const ATTENTION_PULSE_MS = 5 * 60 * 1000; // 5 min

interface Props {
  sessionId: string;
  size?: "sm" | "lg";
  title?: string;
}

const LABEL: Record<string, string> = {
  idle: "Idle",
  busy: "Busy",
  attention: "Needs attention",
};

/**
 * Tri-state activity LED rendered next to every session reference.
 * See index.css for the per-state colors and pulse animations.
 */
export function TerminalActivityLed({
  sessionId,
  size = "sm",
  title,
}: Props) {
  const state = useActivityState(sessionId);
  const attentionSinceAt = useAttentionSinceAt(sessionId);
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
