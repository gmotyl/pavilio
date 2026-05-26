import { useEffect, useRef, useState } from "react";
import {
  reduce,
  displayMinutes,
  busyEvent,
  tick,
  type AccumulatorState,
} from "./busyAccumulator";

// Must match the server's BUSY_THRESHOLD_MS in panel/server/lib/terminalActivity.ts.
// A busy state shorter than this is treated as a screen-refresh flicker and not counted.
const BUSY_DEBOUNCE_MS = 10_000;

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
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // edge-trigger busy events on false → true transitions, debounced by
  // BUSY_DEBOUNCE_MS so screen-refresh flickers (< 10s) do not open a block.
  useEffect(() => {
    if (!opts.project) return;

    if (opts.agentBusy && !wasBusy.current) {
      // false → true: arm debounce
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        // only dispatch if still busy at fire time
        if (wasBusy.current) {
          setState((s) => reduce(s, busyEvent(Date.now())));
        }
      }, BUSY_DEBOUNCE_MS);
    } else if (!opts.agentBusy && wasBusy.current) {
      // true → false during debounce: cancel pending dispatch
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    }
    wasBusy.current = opts.agentBusy;

    return () => {
      // cleanup on unmount or before next effect run
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [opts.agentBusy, opts.project]);

  // periodic tick: expire locks + refresh display, and extend lock while
  // continuously busy past the debounce so blocks > 15min stay open.
  useEffect(() => {
    if (!opts.project) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setState((s) => {
        let next = s;
        // debounce already elapsed (timer cleared) and still busy → extend the
        // lock another 15min before the tick checks for expiry.
        if (wasBusy.current && debounceTimerRef.current === null) {
          next = reduce(next, busyEvent(t));
        }
        return reduce(next, tick(t));
      });
    }, 60_000);
    return () => clearInterval(id);
  }, [opts.project]);

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
