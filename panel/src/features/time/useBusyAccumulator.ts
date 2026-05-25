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
    if (!opts.project) return { date: todayStr(), closedMinutes: 0, open: null };
    const loaded = load(opts.project);
    // force-close any stale open block whose lock has already expired
    return reduce(loaded, tick(Date.now()));
  });
  const wasBusy = useRef(false);
  const [now, setNow] = useState<number>(() => Date.now());
  const projectRef = useRef(opts.project);

  // reload state when the project identity changes (route param swap without unmount)
  useEffect(() => {
    if (projectRef.current === opts.project) return;
    projectRef.current = opts.project;
    // reset edge-trigger so a still-busy agent on the new project doesn't replay
    wasBusy.current = false;
    if (!opts.project) {
      setState({ date: todayStr(), closedMinutes: 0, open: null });
      return;
    }
    setState(reduce(load(opts.project), tick(Date.now())));
  }, [opts.project]);

  // edge-trigger busy events on false → true transitions only
  useEffect(() => {
    if (!opts.project) return;
    if (opts.agentBusy && !wasBusy.current) {
      setState((s) => reduce(s, busyEvent(Date.now())));
    }
    wasBusy.current = opts.agentBusy;
  }, [opts.agentBusy, opts.project]);

  // periodic tick: expire locks + refresh display
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setState((s) => reduce(s, tick(t)));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // persist on every state change (skip empty project — nothing to bind state to)
  useEffect(() => {
    if (!opts.project) return;
    save(opts.project, state);
  }, [opts.project, state]);

  return {
    todayMinutes: displayMinutes(state, now),
    state,
    reset: () => setState((s) => ({ ...s, closedMinutes: 0, open: null })),
  };
}
