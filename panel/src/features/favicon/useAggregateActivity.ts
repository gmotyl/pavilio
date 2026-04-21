import { useEffect, useState } from "react";
import { useAllTerminalSessions } from "../terminal/useAllTerminalSessions";
import {
  getActivityState,
  subscribeActivity,
  type ActivityState,
} from "../terminal/useTerminalActivityChannel";
import type { FaviconState } from "./faviconSvg";

function reduce(states: ActivityState[]): FaviconState {
  if (states.some((s) => s === "busy")) return "busy";
  if (states.some((s) => s === "attention")) return "attention";
  return "idle";
}

export function useAggregateActivity(): FaviconState {
  const { sessions } = useAllTerminalSessions();
  const [state, setState] = useState<FaviconState>("idle");

  useEffect(() => {
    const ids = sessions.map((s) => s.id);

    const recompute = () => {
      setState(reduce(ids.map(getActivityState)));
    };

    recompute();

    const unsubs = ids.map((id) => subscribeActivity(id, recompute));
    return () => {
      for (const u of unsubs) u();
    };
  }, [sessions]);

  return state;
}

export { reduce as __reduceForTests };
