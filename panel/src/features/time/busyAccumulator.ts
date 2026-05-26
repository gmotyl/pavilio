const SLOT_MS = 15 * 60 * 1000;

export type AccumulatorState = {
  date: string; // YYYY-MM-DD
  closedMinutes: number; // sum of closed blocks today (multiples of 15)
  open: { startMs: number; lockUntilMs: number } | null;
};

export type Event =
  | { type: "busy"; at: number }
  | { type: "tick"; at: number }
  | { type: "rollover"; at: number; newDate: string }
  | { type: "reset"; at: number };

export const busyEvent = (at: number): Event => ({ type: "busy", at });
export const tick = (at: number): Event => ({ type: "tick", at });

export function reduce(state: AccumulatorState, ev: Event): AccumulatorState {
  switch (ev.type) {
    case "busy": {
      if (!state.open) {
        return {
          ...state,
          open: { startMs: ev.at, lockUntilMs: ev.at + SLOT_MS },
        };
      }
      return {
        ...state,
        open: {
          ...state.open,
          lockUntilMs: Math.max(state.open.lockUntilMs, ev.at + SLOT_MS),
        },
      };
    }
    case "tick": {
      if (!state.open || ev.at < state.open.lockUntilMs) return state;
      const slots = Math.ceil(
        (state.open.lockUntilMs - state.open.startMs) / SLOT_MS,
      );
      return {
        ...state,
        closedMinutes: state.closedMinutes + slots * 15,
        open: null,
      };
    }
    case "rollover":
      // open block closed and DISCARDED here; the caller is responsible for
      // persisting a busy_block entry to JSONL under the previous date BEFORE
      // dispatching the rollover (see useBusyAccumulator).
      return { date: ev.newDate, closedMinutes: 0, open: null };
    case "reset":
      return { ...state, closedMinutes: 0, open: null };
  }
}

export function displayMinutes(
  state: AccumulatorState,
  now: number,
): number {
  let openMinutes = 0;
  if (state.open) {
    const ageMs = now - state.open.startMs;
    const lockMs = state.open.lockUntilMs - state.open.startMs;
    // slot N covered when now ≥ start + (N-1)·SLOT_MS AND lockUntil ≥ start + (N-1)·SLOT_MS
    const slotsByAge = Math.max(1, Math.floor(ageMs / SLOT_MS) + 1);
    const slotsByLock = Math.ceil(lockMs / SLOT_MS);
    openMinutes = Math.min(slotsByAge, slotsByLock) * 15;
  }
  return state.closedMinutes + openMinutes;
}
