import { useEffect, useRef, useState } from "react";
import { useAllTerminalSessions } from "../terminal/useAllTerminalSessions";
import {
  getActivityState,
  subscribeActivity,
  type ActivityState,
} from "../terminal/useTerminalActivityChannel";
import type { FaviconState } from "./faviconSvg";

// A transient "busy" below this threshold (shell prompt redraws, async
// powerlevel10k refreshes, etc.) should not flip the favicon to red. Non-busy
// transitions (attention, idle) still propagate immediately.
export const BUSY_FAVICON_DEBOUNCE_MS = 2000;

function reduce(states: ActivityState[]): FaviconState {
  if (states.some((s) => s === "busy")) return "busy";
  if (states.some((s) => s === "attention")) return "attention";
  return "idle";
}

export function useAggregateActivity(
  busyDebounceMs: number = BUSY_FAVICON_DEBOUNCE_MS,
): FaviconState {
  const { sessions } = useAllTerminalSessions();
  const [rawState, setRawState] = useState<FaviconState>("idle");
  const [visibleState, setVisibleState] = useState<FaviconState>("idle");
  const busyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ids = sessions.map((s) => s.id);

    const recompute = () => {
      setRawState(reduce(ids.map(getActivityState)));
    };

    recompute();

    const unsubs = ids.map((id) => subscribeActivity(id, recompute));
    return () => {
      for (const u of unsubs) u();
    };
  }, [sessions]);

  useEffect(() => {
    if (busyTimerRef.current) {
      clearTimeout(busyTimerRef.current);
      busyTimerRef.current = null;
    }
    if (rawState !== "busy") {
      setVisibleState(rawState);
      return;
    }
    busyTimerRef.current = setTimeout(() => {
      setVisibleState("busy");
      busyTimerRef.current = null;
    }, busyDebounceMs);
    return () => {
      if (busyTimerRef.current) {
        clearTimeout(busyTimerRef.current);
        busyTimerRef.current = null;
      }
    };
  }, [rawState, busyDebounceMs]);

  return visibleState;
}

export { reduce as __reduceForTests };
