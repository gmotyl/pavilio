import { useEffect, useMemo, useRef } from "react";
import { useAllTerminalSessions } from "../terminal/useAllTerminalSessions";
import { useAggregateActivityState } from "../terminal/useTerminalActivityChannel";
import { useBusyAccumulator } from "./useBusyAccumulator";

export interface UseProjectBusyTrackerResult {
  todayMinutes: number;
}

interface OpenBlock {
  startMs: number;
  lockUntilMs: number;
}

const SLOT_MS = 15 * 60 * 1000;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function useProjectBusyTracker(
  projectName: string,
): UseProjectBusyTrackerResult {
  const { sessions } = useAllTerminalSessions();

  const sessionIds = useMemo(
    () => sessions.filter((s) => s.project === projectName).map((s) => s.id),
    [sessions, projectName],
  );

  const { state } = useAggregateActivityState(sessionIds);
  const agentBusy = state === "busy";

  const { todayMinutes, state: accState } = useBusyAccumulator({
    project: projectName,
    agentBusy,
  });

  // Track the most recently observed open block so we can describe it on close.
  const lastOpenRef = useRef<OpenBlock | null>(null);
  const prevOpenRef = useRef<OpenBlock | null>(null);

  useEffect(() => {
    const prev = prevOpenRef.current;
    const curr = accState.open;
    if (curr) lastOpenRef.current = curr;

    // open → null transition: a block just closed
    if (prev && !curr) {
      const closed = lastOpenRef.current ?? prev;
      const slots = Math.ceil(
        (closed.lockUntilMs - closed.startMs) / SLOT_MS,
      );
      const minutes = slots * 15;
      const entry = {
        type: "busy_block" as const,
        date: isoDate(closed.startMs),
        start: new Date(closed.startMs).toISOString(),
        end: new Date(closed.lockUntilMs).toISOString(),
        minutes,
      };
      void fetch("/api/time/append", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: projectName, entry }),
      }).catch((err) => {
        console.warn("[time] busy_block POST failed", err);
      });
      lastOpenRef.current = null;
    }
    prevOpenRef.current = curr;
  }, [accState.open, projectName]);

  return { todayMinutes };
}
