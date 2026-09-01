import { useEffect, useCallback, useState } from "react";
import type { SessionMeta } from "./useTerminalSessions";
import { useWebSocket } from "../realtime/useWebSocket";
import { useTerminalOrdering } from "./useTerminalOrdering";

/**
 * Scope key for the cross-project terminals page. Shared verbatim with
 * `useTerminalMaximized("__all__")` and the shipped `panel-terminal-order-__all__`
 * key, so it cannot be renamed without orphaning stored state. Invariant: no
 * project may be named `__all__` — it would share order/layout storage with
 * this page.
 */
const ALL_SCOPE = "__all__";

export function useAllTerminalSessions(pollMs = 8000) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const { lastMessage } = useWebSocket();

  // Same ordering model as a per-project surface, under the `__all__` scope —
  // so Ctrl+drag merge/join/split and the preset picker commit here too.
  const ordering = useTerminalOrdering(ALL_SCOPE, sessions);
  const { syncIds } = ordering;

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
      syncIds(data.map((s) => s.id));
    } catch (err) {
      console.warn(`[terminal] useAllTerminalSessions fetch failed:`, err);
    }
  }, [syncIds]);

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

  return {
    sessions: ordering.orderedSessions,
    refresh: fetchAll,
    reorder: ordering.reorder,
    // A plain drag swaps identity in the order *and* in the layout, matching
    // the per-project surface's swapSessions.
    swapOrder: ordering.swapSessions,
    columnLayout: ordering.columnLayout,
    mergeColumn: ordering.mergeColumn,
    joinColumn: ordering.joinColumn,
    splitColumn: ordering.splitColumn,
    applyPreset: ordering.applyPreset,
  };
}
