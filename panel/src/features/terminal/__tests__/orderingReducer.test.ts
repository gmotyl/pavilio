import { describe, it, expect } from "vitest";
import { orderingReducer, type OrderingAction, type OrderingState } from "../orderingReducer";
import type { ColumnLayout } from "../columnLayout";

const layout = (...columns: [string, number][][]): ColumnLayout =>
  columns.map((column) => column.map(([sessionId, weight]) => ({ sessionId, weight })));

const state = (order: string[], columns: ColumnLayout): OrderingState => ({
  order,
  layout: columns,
});

// The layout a caller resolves the empty sentinel to before dispatching a layout op.
const resolved = layout([["A", 1], ["B", 1]], [["C", 1]]);

describe("orderingReducer", () => {
  it("applying the same action twice equals applying it once", () => {
    const base = state(["A", "B", "C"], layout([["A", 1]], [["B", 1], ["C", 1]]));

    const actions: OrderingAction[] = [
      { type: "sync", ids: ["A", "B", "C", "D"] },
      { type: "sync", ids: ["A", "B"] },
      { type: "append", id: "D" },
      { type: "reorder", fromId: "C", toId: "A" },
      { type: "merge", sessionId: "A", targetId: "B", resolved },
      { type: "join", sessionId: "B", targetId: "C", resolved },
      { type: "split", sessionId: "B", gutterIndex: 0, resolved },
      { type: "preset", order: ["A", "B", "C"], sizes: [1, 2] },
      { type: "preset", order: ["A", "B", "C"], sizes: [] },
      { type: "reset", state: state(["X"], layout([["X", 1]])) },
    ];

    for (const action of actions) {
      const once = orderingReducer(base, action);
      const twice = orderingReducer(once, action);
      expect(twice, `replaying ${action.type} changed the state`).toEqual(once);
    }

    // `swap` is deliberately excluded above: it is an involution by contract
    // (swapping the same pair back is a user-visible feature), so a *sequential*
    // second dispatch must undo the first. What StrictMode actually replays is
    // the reducer call itself — same state in, same state out — so that is the
    // property asserted for it.
    const swap: OrderingAction = { type: "swap", idA: "A", idB: "C" };
    expect(orderingReducer(base, swap)).toEqual(orderingReducer(base, swap));
    expect(orderingReducer(orderingReducer(base, swap), swap)).toEqual(base);
  });

  it("sync removes closed sessions from order and layout together", () => {
    const base = state(["A", "B", "C"], layout([["A", 1]], [["B", 1], ["C", 1]]));

    const next = orderingReducer(base, { type: "sync", ids: ["A", "C"] });

    expect(next.order).toEqual(["A", "C"]);
    expect(next.layout).toEqual(layout([["A", 1]], [["C", 1]]));
  });

  it("sync appends exactly one layout entry per new session", () => {
    const base = state(["A", "B"], layout([["A", 1]], [["B", 1]]));

    const next = orderingReducer(base, { type: "sync", ids: ["A", "B", "C"] });

    expect(next.order).toEqual(["A", "B", "C"]);
    const ids = next.layout.flat().map((entry) => entry.sessionId);
    expect(ids.filter((id) => id === "C")).toHaveLength(1);
    expect(ids).toEqual(["A", "B", "C"]);
  });

  it("sync returns the same state reference when nothing changed", () => {
    const base = state(["A", "B"], layout([["A", 1]], [["B", 1]]));

    expect(orderingReducer(base, { type: "sync", ids: ["A", "B"] })).toBe(base);
  });

  it("an empty preset resets the layout to the sentinel", () => {
    const base = state(["A", "B"], layout([["A", 1]], [["B", 1]]));

    const next = orderingReducer(base, { type: "preset", order: ["A", "B"], sizes: [] });

    expect(next.layout).toEqual([]);
    expect(next.order).toBe(base.order);
  });
});
