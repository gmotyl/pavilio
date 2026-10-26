import { reorderIds, mergeOrder } from "./sessionOrder";
import {
  expandPreset,
  getLayoutPresets,
  isValidLayout,
  readingOrder,
  reconcileTiles,
  type LayoutPreset,
  type TileLayout,
} from "./tileLayout";

/**
 * The terminal grid's ordering model as one value. `layout` is the rectangle tiling;
 * `order` is the flat session order the tab strip renders.
 *
 * The two halves are kept in lockstep by one invariant: **`order` is always the
 * layout's reading order**. Rectangles are slots and the order says who sits in
 * which, so a change to either half re-derives the other in the same transition —
 * that is what keeps the tab strip and the grid expressing one order.
 *
 * A seam resize is the one transition that does not re-derive: moving a boundary
 * must not renumber the user's terminals, so `resize` keeps `order` exactly as it
 * was. A horizontal seam move can therefore leave the two out of step — the price
 * of the promise, and the reason the exception is a distinct action rather than a
 * flag. See ADR 0008's 2026-09-10 amendment.
 *
 * `minimised` is the subset of `order` taken out of the grid on this surface. The
 * layout tiles the *visible* sessions only, so the invariant above holds for the
 * visible subsequence of `order`; a minimised session keeps its index in `order`,
 * which is where `restore` puts it back.
 */
export interface OrderingState {
  /** All sessions, minimised included. */
  order: string[];
  /** Tiles the visible sessions only. */
  layout: TileLayout;
  /** Subset of `order`. */
  minimised: string[];
}

/**
 * How a committed tiling came about — the two gestures that hand the model a whole
 * layout differ only in what they mean for the session order, so the caller says
 * which it is rather than the reducer guessing from the geometry.
 */
export type LayoutCommitKind = "placement" | "resize";

/**
 * `place` carries a layout the caller already computed — the drag overlay paints the
 * repaired result and hands that exact value to the drop. The reducer stores it
 * rather than re-deriving anything, because re-deriving the action from whatever sits
 * under the cursor at drop time is precisely the defect this model replaced.
 *
 * `resize` carries a layout too, and differs from `place` in exactly one way: it is
 * not a reordering event.
 */
export type OrderingAction =
  | { type: "sync"; ids: string[] }
  | { type: "append"; id: string }
  | { type: "remove"; id: string }
  | { type: "reorder"; fromId: string; toId: string }
  | { type: "place"; layout: TileLayout }
  | { type: "resize"; layout: TileLayout }
  | { type: "preset"; preset: LayoutPreset; order?: string[] }
  | { type: "minimise"; id: string }
  | { type: "restore"; id: string }
  | { type: "reset"; state: OrderingState };

function sameLayout(a: TileLayout, b: TileLayout): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((tile, i) => {
    const other = b[i];
    return (
      tile.sessionId === other.sessionId &&
      tile.x === other.x &&
      tile.y === other.y &&
      tile.w === other.w &&
      tile.h === other.h
    );
  });
}

function sameOrder(a: string[], b: string[]): boolean {
  return a === b || (a.length === b.length && a.every((id, i) => id === b[i]));
}

/**
 * Builds the next state and collapses to the *same reference* when neither half
 * actually moved — the reducer equivalent of React bailing out of a setState handed
 * the value it already held. That keeps the 8s session poll from re-running the
 * persist effects on every unchanged tick.
 */
function commit(
  state: OrderingState,
  order: string[],
  layout: TileLayout,
  minimised: string[] = state.minimised,
): OrderingState {
  const layoutUnchanged = sameLayout(layout, state.layout);
  const orderUnchanged = sameOrder(order, state.order);
  const minimisedUnchanged = sameOrder(minimised, state.minimised);
  if (layoutUnchanged && orderUnchanged && minimisedUnchanged) return state;
  return {
    order: orderUnchanged ? state.order : order,
    layout: layoutUnchanged ? state.layout : layout,
    minimised: minimisedUnchanged ? state.minimised : minimised,
  };
}

/** The sessions the grid tiles: `order` minus the minimised ones, in order. */
function visibleOf(order: string[], minimised: string[]): string[] {
  if (minimised.length === 0) return order;
  const hidden = new Set(minimised);
  return order.filter((id) => !hidden.has(id));
}

/**
 * Writes a new visible sequence back into `order`, leaving every minimised session at
 * the index it already held. With nothing minimised the result is `visible` itself.
 */
function weave(order: string[], minimised: string[], visible: string[]): string[] {
  if (minimised.length === 0) return visible;
  const hidden = new Set(minimised);
  const queue = [...visible];
  const woven: string[] = [];
  for (const id of order) {
    if (hidden.has(id)) woven.push(id);
    else if (queue.length > 0) woven.push(queue.shift()!);
  }
  return [...woven, ...queue];
}

/** Commits a tiling and the order it implies — the two always move together. */
function commitLayout(state: OrderingState, layout: TileLayout): OrderingState {
  const visible = readingOrder(layout).map((tile) => tile.sessionId);
  return commit(state, weave(state.order, state.minimised, visible), layout);
}

/**
 * Minimise and restore re-tile with the default preset for the new visible count:
 * the visible set changed shape, so the user's custom seams are discarded.
 */
function defaultTiling(visible: string[]): TileLayout {
  const [preset] = getLayoutPresets(visible.length);
  return preset ? expandPreset(visible, preset) : [];
}

/** Re-seats sessions into the layout's slots following `order`. */
function assign(layout: TileLayout, order: string[]): TileLayout {
  return readingOrder(layout).map((slot, i) => ({
    ...slot,
    sessionId: order[i] ?? slot.sessionId,
  }));
}

/** Keeps the sentinel empty; otherwise brings the stored tiling in line with `order`. */
function reconcile(layout: TileLayout, order: string[]): TileLayout {
  return layout.length === 0 ? layout : reconcileTiles(layout, order);
}

/**
 * One pure transition over `{order, layout, minimised}`. The two halves must always move
 * together, and a reducer is what makes that atomic — the shape this replaced (a
 * layout setter nested inside an order setter) was an impure updater that StrictMode
 * replayed, rendering one session in two cells.
 */
export function orderingReducer(state: OrderingState, action: OrderingAction): OrderingState {
  switch (action.type) {
    // An empty `layout` is the "no custom shape stored" sentinel: the caller resolves it
    // to the default preset for the live session count. The three order-only transitions
    // below deliberately keep it empty, so opening or closing a terminal re-derives that
    // per-count default instead of pinning the shape the count happened to have.
    case "sync": {
      // An ended session leaves the minimised set with it; the layout only ever saw
      // visible sessions, so dropping a minimised one does not touch it.
      const order = mergeOrder(state.order, action.ids);
      const minimised = state.minimised.filter((id) => order.includes(id));
      return commit(
        state,
        order,
        reconcile(state.layout, visibleOf(order, minimised)),
        minimised,
      );
    }

    case "append": {
      // A new session always starts visible.
      if (state.order.includes(action.id)) return state;
      const order = [...state.order, action.id];
      return commit(state, order, reconcile(state.layout, visibleOf(order, state.minimised)));
    }

    case "remove": {
      // The close counterpart of `append`. A per-project surface has no poll, so
      // without this the closed session keeps its slot in the order and its
      // rectangle in the layout — an invisible hole the survivors never absorb,
      // and one the next `append` splits instead of the whole grid.
      if (!state.order.includes(action.id)) return state;
      const order = state.order.filter((id) => id !== action.id);
      const minimised = state.minimised.filter((id) => id !== action.id);
      return commit(
        state,
        order,
        reconcile(state.layout, visibleOf(order, minimised)),
        minimised,
      );
    }

    case "reorder": {
      // A tab drag moves sessions between slots; the shape stays exactly as it was.
      const order = reorderIds(state.order, action.fromId, action.toId);
      return commit(state, order, assign(state.layout, visibleOf(order, state.minimised)));
    }

    case "place":
      // Stored verbatim — the overlay already computed and displayed this layout. One
      // that does not tile the grid is a caller bug, not a state worth persisting.
      if (!isValidLayout(action.layout)) return state;
      return commitLayout(state, action.layout);

    case "resize":
      // A seam move is a resize, not a reordering event, so the order carries over
      // untouched instead of being re-derived from the new tiling. `readingOrder`
      // sorts y-major, and a horizontal seam move rewrites y — it can carry a tile
      // across another's row and come back renumbered, while still producing a
      // tiling `isValidLayout` accepts. Re-deriving here would renumber the user's
      // terminals for a gesture that promises not to. See ADR 0008's amendment.
      if (!isValidLayout(action.layout)) return state;
      return commit(state, state.order, action.layout);

    case "preset": {
      // `order` is passed explicitly by the hook: before the first session sync the
      // reducer's own order is still empty, and a preset click would expand to nothing.
      const order = action.order ?? state.order;
      return commit(
        state,
        order,
        expandPreset(visibleOf(order, state.minimised), action.preset),
      );
    }

    case "minimise": {
      // The grid is never left empty: the last visible session cannot be minimised.
      if (!state.order.includes(action.id) || state.minimised.includes(action.id)) {
        return state;
      }
      const minimised = [...state.minimised, action.id];
      const visible = visibleOf(state.order, minimised);
      if (visible.length === 0) return state;
      return commit(state, state.order, defaultTiling(visible), minimised);
    }

    case "restore": {
      // The session returns at the index it kept in `order`.
      if (!state.minimised.includes(action.id)) return state;
      const minimised = state.minimised.filter((id) => id !== action.id);
      return commit(
        state,
        state.order,
        defaultTiling(visibleOf(state.order, minimised)),
        minimised,
      );
    }

    case "reset":
      // A scope change: the caller has already read the new scope's stored state.
      return action.state;
  }
}
