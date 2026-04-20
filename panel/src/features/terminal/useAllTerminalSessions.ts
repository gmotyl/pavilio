import { useEffect, useCallback, useMemo, useState } from "react";
import type { SessionMeta } from "./useTerminalSessions";
import { useWebSocket } from "../realtime/useWebSocket";
import { mergeOrder, reorderIds, swapIds } from "./sessionOrder";

const ALL_ORDER_KEY = "panel-terminal-order-__all__";

export function useAllTerminalSessions(pollMs = 8000) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const { lastMessage } = useWebSocket();

  const [sessionOrder, setSessionOrder] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(ALL_ORDER_KEY);
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
      return [];
    }
  });

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch("/api/terminal/sessions");
      if (!res.ok) {
        console.warn(
          `[terminal] useAllTerminalSessions got ${res.status} from server`,
        );
        return;
      }
      const data: SessionMeta[] = await res.json();
      setSessions(data);
      setSessionOrder((prev) => mergeOrder(prev, data.map((s) => s.id)));
    } catch (err) {
      console.warn(`[terminal] useAllTerminalSessions fetch failed:`, err);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const id = setInterval(fetchAll, pollMs);
    return () => clearInterval(id);
  }, [fetchAll, pollMs]);

  // Refresh on any WS message — cheap and covers create/delete made in other tabs.
  useEffect(() => {
    if (lastMessage) fetchAll();
  }, [lastMessage, fetchAll]);

  useEffect(() => {
    try {
      localStorage.setItem(ALL_ORDER_KEY, JSON.stringify(sessionOrder));
    } catch {
      // ignore
    }
  }, [sessionOrder]);

  const orderIndex = useMemo(
    () => new Map(sessionOrder.map((id, i) => [id, i])),
    [sessionOrder],
  );

  const orderedSessions = useMemo(() => {
    if (sessionOrder.length === 0) return sessions;
    return [...sessions].sort((a, b) => {
      const ai = orderIndex.get(a.id) ?? sessions.length;
      const bi = orderIndex.get(b.id) ?? sessions.length;
      return ai - bi;
    });
  }, [sessions, sessionOrder, orderIndex]);

  const reorder = useCallback((fromId: string, toId: string) => {
    setSessionOrder((prev) => reorderIds(prev, fromId, toId));
  }, []);

  const swapOrder = useCallback((idA: string, idB: string) => {
    setSessionOrder((prev) => swapIds(prev, idA, idB));
  }, []);

  return { sessions: orderedSessions, refresh: fetchAll, reorder, swapOrder };
}
