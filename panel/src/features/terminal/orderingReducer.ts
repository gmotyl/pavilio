import { reorderIds, swapIds, mergeOrder } from "./sessionOrder";
import {
  reconcileLayout,
  mergeInColumn,
  joinOtherColumn,
  splitToNewColumn,
  swapInLayout,
  expandPreset,
  type ColumnLayout,
} from "./columnLayout";

/**
 * The terminal grid's ordering model as one value. `order` is the flat session
 * order; `layout` is the weighted column layout, with `[]` as the "no custom
 * layout stored" sentinel (resolved to the default preset for rendering, and
 * persisted by *removing* the key).
 */
export interface OrderingState {
  order: string[];
  layout: ColumnLayout;
}

/**
 * `resolved` carries the caller-resolved layout — the empty-layout sentinel
 * expanded to the default preset — so a layout op commits against the layout
 * the user is actually looking at. Handed a literal `[]`, every pure layout
 * function takes its "id not found" no-op path.
 */
export type OrderingAction =
  | { type: "sync"; ids: string[] }
  | { type: "append"; id: string }
  | { type: "reorder"; fromId: string; toId: string }
  | { type: "swap"; idA: string; idB: string }
  | { type: "merge"; sessionId: string; targetId: string; resolved: ColumnLayout }
  | { type: "join"; sessionId: string; targetId: string; resolved: ColumnLayout }
  | { type: "split"; sessionId: string; gutterIndex: number; resolved: ColumnLayout }
  | { type: "preset"; order: string[]; sizes: number[] }
  | { type: "reset"; state: OrderingState };

function sameLayout(a: ColumnLayout, b: ColumnLayout): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((column, ci) => {
    const other = b[ci];
    if (column.length !== other.length) return false;
    return column.every(
      (entry, ei) =>
        entry.sessionId === other[ei].sessionId && entry.weight === other[ei].weight,
    );
  });
}

/**
 * Builds the next state, collapsing to the *same reference* when neither half
 * actually moved — the reducer equivalent of React bailing out of a setState
 * that was handed the value it already held. Keeps the 8s session poll from
 * re-running the persist effects on every unchanged tick (`mergeOrder` already
 * guards the order half by reference; the layout half needs a value compare,
 * since `reconcileLayout` rebuilds its columns).
 */
function commit(state: OrderingState, order: string[], layout: ColumnLayout): OrderingState {
  const nextLayout = sameLayout(layout, state.layout) ? state.layout : layout;
  if (order === state.order && nextLayout === state.layout) return state;
  return { order, layout: nextLayout };
}

/**
 * One pure transition over `{order, layout}`. The two halves must always move
 * together — a layout op reconciles against the order it was resolved from —
 * and a reducer is what makes that atomic. The previous shape (a
 * `setColumnLayout` call nested inside a `setSessionOrder` updater) was an
 * impure updater: StrictMode replays it, and the layout append ran twice, so
 * one session rendered in two grid cells.
 */
export function orderingReducer(state: OrderingState, action: OrderingAction): OrderingState {
  switch (action.type) {
    case "sync": {
      // Reconcile the layout against the PRE-merge order — the same `prev` that
      // mergeOrder consumes — in this one transition. See reconcileLayout's contract.
      const order = mergeOrder(state.order, action.ids);
      return commit(state, order, reconcileLayout(state.order, state.layout, order));
    }

    case "append": {
      if (state.order.includes(action.id)) return state;
      const order = [...state.order, action.id];
      return commit(state, order, reconcileLayout(state.order, state.layout, order));
    }

    case "reorder":
      return commit(
        state,
        reorderIds(state.order, action.fromId, action.toId),
        state.layout,
      );

    case "swap":
      // Reads the RAW layout, not a resolved one, on purpose: a plain swap is the
      // one op fully expressible through `order`, which the default resolution
      // already consumes — so with no custom layout stored it stays a no-op here
      // and the grid re-derives the preset against the swapped order.
      return commit(
        state,
        swapIds(state.order, action.idA, action.idB),
        swapInLayout(state.layout, action.idA, action.idB),
      );

    case "merge":
      return commit(
        state,
        state.order,
        mergeInColumn(action.resolved, action.sessionId, action.targetId),
      );

    case "join":
      return commit(
        state,
        state.order,
        joinOtherColumn(action.resolved, action.sessionId, action.targetId),
      );

    case "split":
      return commit(
        state,
        state.order,
        splitToNewColumn(action.resolved, action.sessionId, action.gutterIndex),
      );

    case "preset":
      // `sizes: []` is the deliberate reset: expandPreset returns [], the persist
      // path drops the key, and the grid falls back to the default preset. Do not
      // "guard" the empty case — it is the contract.
      return commit(state, state.order, expandPreset(action.order, action.sizes));

    case "reset":
      // A scope change: the caller has already read the new scope's stored order
      // and layout, so this replaces both halves wholesale.
      return action.state;
  }
}
