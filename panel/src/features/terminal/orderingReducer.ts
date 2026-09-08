import { reorderIds, mergeOrder } from "./sessionOrder";
import {
  expandPreset,
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
 */
export interface OrderingState {
  order: string[];
  layout: TileLayout;
}

/**
 * `place` carries a layout the caller already computed — the drag overlay paints the
 * repaired result and hands that exact value to the drop. The reducer stores it
 * rather than re-deriving anything, because re-deriving the action from whatever sits
 * under the cursor at drop time is precisely the defect this model replaced.
 */
export type OrderingAction =
  | { type: "sync"; ids: string[] }
  | { type: "append"; id: string }
  | { type: "reorder"; fromId: string; toId: string }
  | { type: "place"; layout: TileLayout }
  | { type: "preset"; preset: LayoutPreset; order?: string[] }
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
function commit(state: OrderingState, order: string[], layout: TileLayout): OrderingState {
  const layoutUnchanged = sameLayout(layout, state.layout);
  const orderUnchanged = sameOrder(order, state.order);
  if (layoutUnchanged && orderUnchanged) return state;
  return {
    order: orderUnchanged ? state.order : order,
    layout: layoutUnchanged ? state.layout : layout,
  };
}

/** Commits a tiling and the order it implies — the two always move together. */
function commitLayout(state: OrderingState, layout: TileLayout): OrderingState {
  return commit(state, readingOrder(layout).map((tile) => tile.sessionId), layout);
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
 * One pure transition over `{order, layout}`. The two halves must always move
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
      const order = mergeOrder(state.order, action.ids);
      return commit(state, order, reconcile(state.layout, order));
    }

    case "append": {
      if (state.order.includes(action.id)) return state;
      const order = [...state.order, action.id];
      return commit(state, order, reconcile(state.layout, order));
    }

    case "reorder": {
      // A tab drag moves sessions between slots; the shape stays exactly as it was.
      const order = reorderIds(state.order, action.fromId, action.toId);
      return commit(state, order, assign(state.layout, order));
    }

    case "place":
      // Stored verbatim — the overlay already computed and displayed this layout. One
      // that does not tile the grid is a caller bug, not a state worth persisting.
      if (!isValidLayout(action.layout)) return state;
      return commitLayout(state, action.layout);

    case "preset": {
      // `order` is passed explicitly by the hook: before the first session sync the
      // reducer's own order is still empty, and a preset click would expand to nothing.
      const order = action.order ?? state.order;
      return commit(state, order, expandPreset(order, action.preset));
    }

    case "reset":
      // A scope change: the caller has already read the new scope's stored state.
      return action.state;
  }
}
