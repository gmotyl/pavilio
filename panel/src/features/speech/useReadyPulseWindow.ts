import { useEffect, useState } from "react";

export const READY_PULSE_MS = 10_000; // 10 s

/**
 * True from the moment `active && key !== null` is first observed for this `key`
 * until `ms` later; false whenever `active` is false or `key` is null. A new
 * `key` restarts the window, and so does leaving and re-entering `active` —
 * the pulse marks the arrival, and every arrival deserves its own ten seconds.
 *
 * The bar's pulse is capped while the header speak control's is not: the bar is
 * a large control sitting over the terminal, so a pulse that never stops there
 * reads as a nag over the work. The header control stays the place that says
 * something is still waiting, however long it waits.
 */
export function useReadyPulseWindow(
  active: boolean,
  key: string | null,
  ms: number = READY_PULSE_MS,
): boolean {
  // Seeded rather than left false so the first render already pulses; the
  // effect below is what ends the window and what restarts it.
  const [pulsing, setPulsing] = useState<boolean>(() => active && key != null);

  useEffect(() => {
    if (!active || key == null) {
      setPulsing(false);
      return;
    }
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), ms);
    return () => clearTimeout(t);
  }, [active, key, ms]);

  return pulsing;
}
