import { useState, useReducer, useEffect, useCallback, useMemo } from "react";
import {
  expandPreset,
  getLayoutPresets,
  isValidLayout,
  readingOrder,
  type LayoutPreset,
  type TileLayout,
} from "./tileLayout";
import {
  orderingReducer,
  type LayoutCommitKind,
  type OrderingState,
} from "./orderingReducer";
import { preferences } from "../../preferences/declarations";
import { clearPreference, readPreference, writePreference } from "../../preferences/store";
import type { SessionMeta } from "./useTerminalSessions";

/**
 * True when `scopeKey` names something. `ProjectView` renders
 * `projectName={name || ""}`, so a blank scope reaches this hook on a real
 * route — and `storageKey` throws on one rather than letting every project
 * share a single key. An unresolved scope reads the declared defaults and
 * writes nothing.
 */
function resolved(scopeKey: string): boolean {
  return typeof scopeKey === "string" && scopeKey.trim() !== "";
}

export interface TerminalOrdering {
  sessionOrder: string[];
  orderedSessions: SessionMeta[];
  /** The rectangle tiling for this scope; always a full tiling once sessions exist. */
  tiles: TileLayout;
  /** Merge the server's id set into the stored order and reconcile the tiling in one cycle. */
  syncIds: (ids: string[]) => void;
  /** Append a just-created session id and reconcile the tiling in the same cycle. */
  appendId: (id: string) => void;
  /** Drop a just-closed session id and hand its rectangle to the survivors. */
  removeId: (id: string) => void;
  reorder: (fromId: string, toId: string) => void;
  /**
   * Commit a layout a gesture already computed and displayed. `kind` says which
   * gesture: a placement re-derives the session order from the new tiling, a seam
   * resize carries the existing order over untouched.
   */
  placeTiles: (layout: TileLayout, kind?: LayoutCommitKind) => void;
  applyPreset: (preset: LayoutPreset) => void;
}

function readOrder(scopeKey: string): string[] {
  if (!resolved(scopeKey)) return preferences.terminalOrder.default;
  return readPreference(preferences.terminalOrder, scopeKey);
}

/**
 * Three superseded shapes are discarded rather than migrated: the count-only
 * `panel-terminal-columns-` key, the weighted column `panel-terminal-layout-`
 * key, and now the raw `panel-terminal-grid-` key this declaration replaces.
 * Mapping arbitrary column counts and weights onto 48 zones rounds, so a
 * migration would hand back a layout that is *almost* the one the user had —
 * and those layouts were built with the merge tool this model replaced.
 *
 * The two `removeItem` calls that used to sweep the first two keys are GONE,
 * not re-pointed. They were the only raw storage left here, and sweeping two
 * orphans while `panel-terminal-grid-` and every other `// was:` key in
 * `declarations.ts` is left in place was never a policy — the registry's is:
 * "the old raw keys each `// was:` names are ORPHANED — left in the browser,
 * read by nothing". These two join them.
 */
function readTiles(scopeKey: string): TileLayout {
  if (!resolved(scopeKey)) return preferences.terminalGrid.default;
  const parsed: unknown = readPreference(preferences.terminalGrid, scopeKey);
  if (!Array.isArray(parsed)) return [];
  // A layout that does not tile the grid is not rendered at all: the caller falls
  // back to the default preset, which is always well-formed. Repairing tile-by-tile
  // (as the column model did) cannot restore a covering, only guess at one.
  return isValidLayout(parsed as TileLayout) ? (parsed as TileLayout) : [];
}

/** True when `order` is a permutation of exactly the sessions `layout` seats. */
function namesExactly(order: string[], layout: TileLayout): boolean {
  const seated = new Set(layout.map((tile) => tile.sessionId));
  const named = new Set(order);
  return (
    named.size === order.length &&
    named.size === seated.size &&
    order.every((id) => seated.has(id))
  );
}

/** Both halves of one scope's stored ordering model, read together. */
function readScope(scopeKey: string): OrderingState {
  const layout = readTiles(scopeKey);
  if (layout.length === 0) return { order: readOrder(scopeKey), layout };

  // The order and the tiling are one model, so a stored order read back blind could let
  // the two disagree — which is why this used to re-derive from the tiling and ignore
  // the stored key outright. It cannot any more: a seam resize deliberately keeps the
  // session order it had rather than the tiling's reading order (a horizontal seam move
  // rewrites y, `readingOrder`'s primary key, so it can renumber terminals the gesture
  // promised not to touch), and re-deriving here would undo that on the next mount.
  // Set equality is what makes trusting the stored order safe: only a permutation of
  // exactly this layout's sessions is honoured, so a stale, partial, or foreign order
  // still loses to the reading order and the two halves can never silently drift.
  const stored = readOrder(scopeKey);
  const order = namesExactly(stored, layout)
    ? stored
    : readingOrder(layout).map((tile) => tile.sessionId);
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

  // Both persist effects are unchanged in shape — they still run on mount — and
  // that costs nothing on the server: these two are `portable: false`, so the
  // write lands in `localStorage` and never in a PATCH. The store also skips a
  // write whose stored representation is unchanged, so a mount that re-asserts
  // what is already there does not even notify.
  useEffect(() => {
    if (!resolved(scopeKey)) return;
    writePreference(preferences.terminalOrder, sessionOrder, scopeKey);
  }, [scopeKey, sessionOrder]);

  useEffect(() => {
    if (!resolved(scopeKey)) return;
    // Empty is CLEARED rather than stored as `[]`, mirroring the `removeItem`
    // this replaces: an empty tiling means "nothing stored for this scope", and
    // the caller falls back to the default preset either way.
    if (storedTiles.length === 0) clearPreference(preferences.terminalGrid, scopeKey);
    else writePreference(preferences.terminalGrid, storedTiles, scopeKey);
  }, [scopeKey, storedTiles]);

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

  const removeId = useCallback((id: string) => {
    dispatch({ type: "remove", id });
  }, []);

  const reorder = useCallback((fromId: string, toId: string) => {
    dispatch({ type: "reorder", fromId, toId });
  }, []);

  const placeTiles = useCallback(
    (layout: TileLayout, kind: LayoutCommitKind = "placement") => {
      dispatch({ type: kind === "resize" ? "resize" : "place", layout });
    },
    [],
  );

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
    removeId,
    appendId,
    reorder,
    placeTiles,
    applyPreset,
  };
}
