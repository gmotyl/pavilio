import { useState, useReducer, useEffect, useCallback, useMemo } from "react";
import {
  dedupeLayout,
  expandPreset,
  getLayoutPresets,
  type ColumnLayout,
} from "./columnLayout";
import { orderingReducer, type OrderingState } from "./orderingReducer";
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

/** Both halves of one scope's stored ordering model, read together. */
function readScope(scopeKey: string): OrderingState {
  return { order: readOrder(scopeKey), layout: readLayout(scopeKey) };
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

  // The flat order and the weighted layout must always move together — a layout
  // op reconciles against the order it was resolved from — so they are one
  // reducer state, mutated by one pure transition per user action. See
  // orderingReducer.
  const [{ order: sessionOrder, layout: columnLayout }, dispatch] = useReducer(
    orderingReducer,
    scopeKey,
    readScope,
  );

  // Re-read on a scope change only. The consumer component is reused across
  // route navigations (no remount), so switching project must swap in that
  // project's stored order/layout; on mount the useReducer initialiser has
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
    dispatch({ type: "reset", state: readScope(scopeKey) });
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

  const syncIds = useCallback((ids: string[]) => {
    dispatch({ type: "sync", ids });
  }, []);

  const appendId = useCallback((id: string) => {
    dispatch({ type: "append", id });
  }, []);

  const reorder = useCallback((fromId: string, toId: string) => {
    dispatch({ type: "reorder", fromId, toId });
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

  // Each layout op carries `resolvedLayout` as its `resolved` payload — the
  // reducer commits against the layout the user is actually looking at, and
  // cannot derive that itself (only the caller knows how the grid resolved the
  // sentinel).
  const mergeColumn = useCallback(
    (sessionId: string, targetId: string) => {
      dispatch({ type: "merge", sessionId, targetId, resolved: resolvedLayout });
    },
    [resolvedLayout],
  );

  const joinColumn = useCallback(
    (sessionId: string, targetId: string) => {
      dispatch({ type: "join", sessionId, targetId, resolved: resolvedLayout });
    },
    [resolvedLayout],
  );

  const splitColumn = useCallback(
    (sessionId: string, gutterIndex: number) => {
      dispatch({ type: "split", sessionId, gutterIndex, resolved: resolvedLayout });
    },
    [resolvedLayout],
  );

  // `preset.order` is the expansion *source*, not the state's order half: it is
  // `orderedSessions` ids, like every other commit callback. Before the first
  // fetch merge `sessionOrder` is still [], and after a close it can name
  // sessions that no longer exist — either way a preset click would land as a
  // no-op or a layout missing live sessions.
  //
  // `applyPreset([])` is the deliberate reset: expandPreset returns [], the
  // persist effect drops the key, and the grid falls back to the default
  // preset. Do not "guard" the empty case — it is the contract (see
  // useTerminalSessions.columns.test.ts).
  const applyPreset = useCallback(
    (sizes: number[]) => {
      dispatch({ type: "preset", order: orderedSessions.map((s) => s.id), sizes });
    },
    [orderedSessions],
  );

  // No `resolved` payload: the reducer's `swap` reads the raw layout on purpose,
  // since a plain swap is the one op fully expressible through sessionOrder,
  // which the default resolution already consumes. Dispatched once per user
  // action — `swapIds`/`swapInLayout` are involutions, so a second *sequential*
  // dispatch would visibly undo the first. (StrictMode double-invokes the
  // reducer, which is safe; it does not double-dispatch.)
  const swapSessions = useCallback((idA: string, idB: string) => {
    dispatch({ type: "swap", idA, idB });
  }, []);

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
