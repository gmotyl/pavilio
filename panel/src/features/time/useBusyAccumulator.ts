import { useEffect, useRef, useState } from "react";
import {
  reduce,
  displayMinutes,
  busyEvent,
  tick,
  type AccumulatorState,
} from "./busyAccumulator";

const lsKey = (project: string) => `pavilio.time.${project}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

function load(project: string): AccumulatorState {
  try {
    const raw = localStorage.getItem(lsKey(project));
    if (!raw) return { date: todayStr(), closedMinutes: 0, open: null };
    const s = JSON.parse(raw) as AccumulatorState;
    if (s.date !== todayStr())
      return { date: todayStr(), closedMinutes: 0, open: null };
    return s;
  } catch {
    return { date: todayStr(), closedMinutes: 0, open: null };
  }
}

function save(project: string, s: AccumulatorState): void {
  try {
    localStorage.setItem(lsKey(project), JSON.stringify(s));
  } catch {
    // ignore quota / disabled-storage errors
  }
}

export interface UseBusyAccumulatorOptions {
  project: string;
  agentBusy: boolean;
}

export interface UseBusyAccumulatorResult {
  todayMinutes: number;
  state: AccumulatorState;
  reset: () => void;
}

export function useBusyAccumulator(
  opts: UseBusyAccumulatorOptions,
): UseBusyAccumulatorResult {
  const [state, setState] = useState<AccumulatorState>(() => {
    const loaded = load(opts.project);
    // force-close any stale open block whose lock has already expired
    return reduce(loaded, tick(Date.now()));
  });
  const wasBusy = useRef(false);
  const [now, setNow] = useState<number>(() => Date.now());

  // edge-trigger busy events on false → true transitions only
  useEffect(() => {
    if (opts.agentBusy && !wasBusy.current) {
      setState((s) => reduce(s, busyEvent(Date.now())));
    }
    wasBusy.current = opts.agentBusy;
  }, [opts.agentBusy]);

  // periodic tick: expire locks + refresh display
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setState((s) => reduce(s, tick(t)));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // persist on every state change
  useEffect(() => {
    save(opts.project, state);
  }, [opts.project, state]);

  return {
    todayMinutes: displayMinutes(state, now),
    state,
    reset: () => setState((s) => ({ ...s, closedMinutes: 0, open: null })),
  };
}
