import { useState, useReducer, useEffect, useCallback, useMemo } from "react";
import {
  expandPreset,
  getLayoutPresets,
  isValidLayout,
  readingOrder,
  type LayoutPreset,
  type TileLayout,
} from "./tileLayout";
import { orderingReducer, type OrderingState } from "./orderingReducer";
import type { SessionMeta } from "./useTerminalSessions";

export interface TerminalOrdering {
  sessionOrder: string[];
  orderedSessions: SessionMeta[];
  /** The rectangle tiling for this scope; always a full tiling once sessions exist. */
  tiles: TileLayout;
  /** Merge the server's id set into the stored order and reconcile the tiling in one cycle. */
  syncIds: (ids: string[]) => void;
  /** Append a just-created session id and reconcile the tiling in the same cycle. */
  appendId: (id: string) => void;
  reorder: (fromId: string, toId: string) => void;
  /** Commit a layout the drag overlay already computed and displayed. */
  placeTiles: (layout: TileLayout) => void;
  applyPreset: (preset: LayoutPreset) => void;
}

function readOrder(scopeKey: string): string[] {
  try {
    const stored = localStorage.getItem(`panel-terminal-order-${scopeKey}`);
    return stored ? (JSON.parse(stored) as string[]) : [];
  } catch {
    return [];
  }
}

function readTiles(scopeKey: string): TileLayout {
  // Two superseded shapes are discarded rather than migrated: the count-only
  // `panel-terminal-columns-` key and the weighted column `panel-terminal-layout-`
  // key. Mapping arbitrary column counts and weights onto 12 zones rounds, so a
  // migration would hand back a layout that is *almost* the one the user had — and
  // those layouts were built with the merge tool this model replaced.
  try {
    localStorage.removeItem(`panel-terminal-columns-${scopeKey}`);
    localStorage.removeItem(`panel-terminal-layout-${scopeKey}`);
  } catch {
    // ignore
  }

  try {
    const stored = localStorage.getItem(`panel-terminal-grid-${scopeKey}`);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    // A layout that does not tile the grid is not rendered at all: the caller falls
    // back to the default preset, which is always well-formed. Repairing tile-by-tile
    // (as the column model did) cannot restore a covering, only guess at one.
    return isValidLayout(parsed as TileLayout) ? (parsed as TileLayout) : [];
  } catch (err) {
    console.warn(`[terminal] read tiles from localStorage failed:`, err);
    return [];
  }
}

/** Both halves of one scope's stored ordering model, read together. */
function readScope(scopeKey: string): OrderingState {
  const layout = readTiles(scopeKey);
  // The order is the tiling's reading order whenever a tiling is stored — the two are
  // one model, and trusting a separately-stored order here would let them disagree.
  const order =
    layout.length > 0
      ? readingOrder(layout).map((tile) => tile.sessionId)
      : readOrder(scopeKey);
  return { order, layout };
}

/**
 * The terminal grid's ordering model — the flat `sessionOrder` and the `tiles` — for
 * one *scope*: a project name for a per-project surface, `__all__` for the
 * cross-project terminals page. Both structures always move together (the order is
 * the tiling's reading order), so they live in one hook rather than one per consumer.
 *
 * `sessions` is the caller's already-scoped session list; this hook only orders it.
 */
export function useTerminalOrdering(
  scopeKey: string,
  sessions: SessionMeta[],
): TerminalOrdering {
  const ORDER_KEY = `panel-terminal-order-${scopeKey}`;
  const GRID_KEY = `panel-terminal-grid-${scopeKey}`;

  const [{ order: sessionOrder, layout: storedTiles }, dispatch] = useReducer(
    orderingReducer,
    scopeKey,
    readScope,
  );

  // Re-read on a scope change only. The consumer component is reused across route
  // navigations (no remount), so switching project must swap in that project's stored
  // state; on mount the useReducer initialiser has already done it.
  //
  // Adjusted during render (React's documented "reset state when a prop changes"
  // pattern) rather than in an effect: an effect would only *queue* the swap, and the
  // persist effects below run in that same commit — writing the previous scope's data
  // to the NEW scope's keys before the queued state landed.
  const [loadedScope, setLoadedScope] = useState(scopeKey);
  if (loadedScope !== scopeKey) {
    setLoadedScope(scopeKey);
    dispatch({ type: "reset", state: readScope(scopeKey) });
  }

  useEffect(() => {
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(sessionOrder));
    } catch {
      // ignore
    }
  }, [ORDER_KEY, sessionOrder]);

  useEffect(() => {
    try {
      if (storedTiles.length === 0) {
        localStorage.removeItem(GRID_KEY);
      } else {
        localStorage.setItem(GRID_KEY, JSON.stringify(storedTiles));
      }
    } catch (err) {
      console.warn(`[terminal] write tiles to localStorage failed:`, err);
    }
  }, [GRID_KEY, storedTiles]);

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

  /**
   * What the grid renders: the stored tiling, or the default preset expanded against
   * the live sessions when nothing is stored (a fresh scope, or a stored layout that
   * failed validation). Resolved here rather than in the grid so the overlay and the
   * commit path both compute against the same value.
   */
  const tiles = useMemo(() => {
    if (storedTiles.length > 0) return storedTiles;
    const ids = orderedSessions.map((s) => s.id);
    const preset = getLayoutPresets(ids.length)[0];
    return preset ? expandPreset(ids, preset) : [];
  }, [storedTiles, orderedSessions]);

  const syncIds = useCallback((ids: string[]) => {
    dispatch({ type: "sync", ids });
  }, []);

  const appendId = useCallback((id: string) => {
    dispatch({ type: "append", id });
  }, []);

  const reorder = useCallback((fromId: string, toId: string) => {
    dispatch({ type: "reorder", fromId, toId });
  }, []);

  const placeTiles = useCallback((layout: TileLayout) => {
    dispatch({ type: "place", layout });
  }, []);

  // `order` is the live session order, not the reducer's: before the first fetch sync
  // the stored order is still empty, and after a close it can name sessions that no
  // longer exist — either way a preset click would land as a no-op.
  const applyPreset = useCallback(
    (preset: LayoutPreset) => {
      dispatch({ type: "preset", preset, order: orderedSessions.map((s) => s.id) });
    },
    [orderedSessions],
  );

  return {
    sessionOrder,
    orderedSessions,
    tiles,
    syncIds,
    appendId,
    reorder,
    placeTiles,
    applyPreset,
  };
}
