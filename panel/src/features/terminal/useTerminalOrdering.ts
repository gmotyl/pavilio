import { useState, useEffect, useCallback, useMemo } from "react";
import { reorderIds, swapIds, mergeOrder } from "./sessionOrder";
import {
  reconcileLayout,
  dedupeLayout,
  mergeInColumn,
  joinOtherColumn,
  splitToNewColumn,
  expandPreset,
  getLayoutPresets,
  swapInLayout,
  type ColumnLayout,
} from "./columnLayout";
import type { SessionMeta } from "./useTerminalSessions";

export interface TerminalOrdering {
  sessionOrder: string[];
  orderedSessions: SessionMeta[];
  columnLayout: ColumnLayout;
  /** Merge the server's id set into the stored order and reconcile the layout in one cycle. */
  syncIds: (ids: string[]) => void;
  /** Append a just-created session id and reconcile the layout in the same cycle. */
  appendId: (id: string) => void;
  reorder: (fromId: string, toId: string) => void;
  swapSessions: (idA: string, idB: string) => void;
  mergeColumn: (sessionId: string, targetId: string) => void;
  joinColumn: (sessionId: string, targetId: string) => void;
  splitColumn: (sessionId: string, gutterIndex: number) => void;
  applyPreset: (sizes: number[]) => void;
}

function readOrder(scopeKey: string): string[] {
  try {
    const stored = localStorage.getItem(`panel-terminal-order-${scopeKey}`);
    return stored ? (JSON.parse(stored) as string[]) : [];
  } catch {
    return [];
  }
}

function readLayout(scopeKey: string): ColumnLayout {
  // The old count-only `panel-terminal-columns-<scope>` key is a different
  // shape (number[]) and isn't migrated — just discarded.
  try {
    localStorage.removeItem(`panel-terminal-columns-${scopeKey}`);
  } catch {
    // ignore
  }
  try {
    const stored = localStorage.getItem(`panel-terminal-layout-${scopeKey}`);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    // Keys written before the layout uniqueness invariant landed can already name a
    // session twice (a replayed reconcile appended it again), which renders that session
    // in two grid cells. Repair silently on read — the persist effect then writes the
    // clean shape back, so the key heals on the first load after this fix. Idempotent, so
    // an already-clean layout comes back byte-identical (same reference).
    return dedupeLayout(parsed as ColumnLayout);
  } catch (err) {
    console.warn(`[terminal] read layout from localStorage failed:`, err);
    return [];
  }
}

/**
 * The terminal grid's ordering model — the flat `sessionOrder` and the weighted
 * `columnLayout` — for one *scope*: a project name for a per-project surface,
 * `__all__` for the cross-project terminals page. Both structures are always
 * mutated together (a layout op reconciles against the order it was resolved
 * from), so they live in one hook rather than one per consumer; that split is
 * what let the global tab ship with the order half only and every Ctrl+drag
 * commit silently no-op.
 *
 * `sessions` is the caller's already-scoped session list (per-project surfaces
 * pass their filtered list); this hook only orders it.
 */
export function useTerminalOrdering(
  scopeKey: string,
  sessions: SessionMeta[],
): TerminalOrdering {
  const ORDER_KEY = `panel-terminal-order-${scopeKey}`;
  const LAYOUT_KEY = `panel-terminal-layout-${scopeKey}`;

  const [sessionOrder, setSessionOrder] = useState<string[]>(() =>
    readOrder(scopeKey),
  );
  const [columnLayout, setColumnLayout] = useState<ColumnLayout>(() =>
    readLayout(scopeKey),
  );

  // Re-read on a scope change only. The consumer component is reused across
  // route navigations (no remount), so switching project must swap in that
  // project's stored order/layout; on mount the useState initialisers have
  // already done it.
  //
  // Adjusted during render (React's documented "reset state when a prop
  // changes" pattern) rather than in an effect: an effect would only *queue*
  // the swap, and the persist effects below run in that same commit — writing
  // the previous scope's order and layout to the NEW scope's keys before the
  // queued state landed. Self-correcting on the next render, but an unmount
  // inside that one-commit window (navigate twice quickly) leaves the new
  // scope's storage holding the old scope's data.
  const [loadedScope, setLoadedScope] = useState(scopeKey);
  if (loadedScope !== scopeKey) {
    setLoadedScope(scopeKey);
    setSessionOrder(readOrder(scopeKey));
    setColumnLayout(readLayout(scopeKey));
  }

  // Persist order to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(sessionOrder));
    } catch {
      // ignore
    }
  }, [ORDER_KEY, sessionOrder]);

  // Persist columnLayout to localStorage whenever it changes — remove the key
  // entirely when empty, mirroring useTerminalMaximized's remove-when-falsy
  // convention (an empty array means "no custom layout stored").
  useEffect(() => {
    try {
      if (columnLayout.length === 0) {
        localStorage.removeItem(LAYOUT_KEY);
      } else {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(columnLayout));
      }
    } catch (err) {
      console.warn(`[terminal] write layout to localStorage failed:`, err);
    }
  }, [LAYOUT_KEY, columnLayout]);

  // O(N) index map for sort
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

  // Reconcile columnLayout against the PRE-merge sessionOrder (the `prev` that
  // mergeOrder itself consumes), in the same update cycle as the sessionOrder
  // merge — see columnLayout.reconcileLayout's contract.
  const syncIds = useCallback((ids: string[]) => {
    setSessionOrder((prev) => {
      const next = mergeOrder(prev, ids);
      setColumnLayout((prevLayout) => reconcileLayout(prev, prevLayout, next));
      return next;
    });
  }, []);

  const appendId = useCallback((id: string) => {
    setSessionOrder((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      setColumnLayout((prevLayout) => reconcileLayout(prev, prevLayout, next));
      return next;
    });
  }, []);

  const reorder = useCallback((fromId: string, toId: string) => {
    setSessionOrder((prev) => reorderIds(prev, fromId, toId));
  }, []);

  // An empty `columnLayout` is the "no custom layout stored" sentinel, and
  // TerminalLayoutGrid resolves it to the default preset for both rendering
  // and its live Ctrl+drag preview. The commit callbacks below must resolve
  // the SAME layout the user is looking at — handed a literal [], every pure
  // function takes its documented "id not found" no-op path, so the preview
  // was correct while the drop silently changed nothing. Expanded against
  // `orderedSessions` (not `sessionOrder`) to match the grid's own resolution
  // id-for-id even before the mount-time fetch has merged the stored order.
  const resolvedLayout = useMemo(() => {
    if (columnLayout.length > 0) return columnLayout;
    const order = orderedSessions.map((s) => s.id);
    return expandPreset(order, getLayoutPresets(order.length)[0]?.sizes ?? []);
  }, [columnLayout, orderedSessions]);

  // `ColumnLayout` v2 is self-contained (each entry names its own sessionId),
  // so these callbacks each touch at most one piece of state computed by a
  // single pure function; we read state directly from the closure and issue
  // precomputed setState calls rather than mixing in functional updaters —
  // one calling convention for every "commit a layout op" callback.
  const mergeColumn = useCallback(
    (sessionId: string, targetId: string) => {
      setColumnLayout(mergeInColumn(resolvedLayout, sessionId, targetId));
    },
    [resolvedLayout],
  );

  const joinColumn = useCallback(
    (sessionId: string, targetId: string) => {
      setColumnLayout(joinOtherColumn(resolvedLayout, sessionId, targetId));
    },
    [resolvedLayout],
  );

  const splitColumn = useCallback(
    (sessionId: string, gutterIndex: number) => {
      setColumnLayout(splitToNewColumn(resolvedLayout, sessionId, gutterIndex));
    },
    [resolvedLayout],
  );

  // Expands over `orderedSessions`, like every other commit callback: before
  // the first fetch merge `sessionOrder` is still [], and after a close it can
  // name sessions that no longer exist — either way a preset click would land
  // as a no-op or a layout missing live sessions.
  const applyPreset = useCallback(
    (sizes: number[]) => {
      // `applyPreset([])` is the deliberate reset: expandPreset returns [],
      // the persist effect drops the key, and the grid falls back to the
      // default preset. Do not "guard" the empty case — it is the contract
      // (see useTerminalSessions.columns.test.ts).
      setColumnLayout(expandPreset(orderedSessions.map((s) => s.id), sizes));
    },
    [orderedSessions],
  );

  // Reads raw `columnLayout`, not `resolvedLayout`, on purpose: a plain swap is
  // the one op fully expressible through sessionOrder, which the default
  // resolution already consumes — so with no custom layout stored it stays a
  // no-op here and the grid re-derives the preset against the swapped order.
  // Resolving would spend the sentinel on a swap that needs no layout of its
  // own, and later session-count changes would then follow reconcileLayout
  // (append to the last column) instead of re-defaulting to the preset.
  const swapSessions = useCallback(
    (idA: string, idB: string) => {
      setSessionOrder(swapIds(sessionOrder, idA, idB));
      setColumnLayout(swapInLayout(columnLayout, idA, idB));
    },
    [sessionOrder, columnLayout],
  );

  return {
    sessionOrder,
    orderedSessions,
    columnLayout,
    syncIds,
    appendId,
    reorder,
    swapSessions,
    mergeColumn,
    joinColumn,
    splitColumn,
    applyPreset,
  };
}
