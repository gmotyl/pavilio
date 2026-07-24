import { useEffect, useState } from "react";

export const ATTENTION_PULSE_MS = 5 * 60 * 1000; // 5 min

/**
 * True while an attention state is fresh (< 5 min old), then false so the LED
 * settles into a solid green. `active` gates the timer so callers can stop
 * pulsing when the underlying state is no longer "attention".
 */
export function useAttentionPulse(
  attentionSinceAt: number | null,
  active: boolean,
): boolean {
  const [pulsing, setPulsing] = useState<boolean>(
    () =>
      active &&
      attentionSinceAt != null &&
      Date.now() - attentionSinceAt < ATTENTION_PULSE_MS,
  );

  useEffect(() => {
    if (!active || attentionSinceAt == null) {
      setPulsing(false);
      return;
    }
    const elapsed = Date.now() - attentionSinceAt;
    if (elapsed >= ATTENTION_PULSE_MS) {
      setPulsing(false);
      return;
    }
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), ATTENTION_PULSE_MS - elapsed);
    return () => clearTimeout(t);
  }, [active, attentionSinceAt]);

  return pulsing;
}
