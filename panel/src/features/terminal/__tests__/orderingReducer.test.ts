import { describe, it, expect } from "vitest";
import { orderingReducer, type OrderingAction, type OrderingState } from "../orderingReducer";
import {
  expandPreset,
  getLayoutPresets,
  isValidLayout,
  readingOrder,
  type TileLayout,
} from "../tileLayout";

const presetFor = (ids: string[], label?: string) => {
  const presets = getLayoutPresets(ids.length);
  return label ? presets.find((p) => p.label === label)! : presets[0];
};

const defaultLayout = (ids: string[]): TileLayout => expandPreset(ids, presetFor(ids));

const state = (ids: string[]): OrderingState => ({
  order: ids,
  layout: defaultLayout(ids),
});

const idsOf = (layout: TileLayout) => readingOrder(layout).map((t) => t.sessionId);

/**
 * Freeze a state and everything reachable from it. React state is shared, not owned by
 * the reducer, so an in-place write is the impurity that actually corrupts it; under a
 * frozen input such a write throws instead of silently succeeding.
 */
function deepFreezeState(input: OrderingState): OrderingState {
  Object.freeze(input.order);
  for (const tile of input.layout) Object.freeze(tile);
  Object.freeze(input.layout);
  return Object.freeze(input);
}

describe("orderingReducer", () => {
  it("stores a placed layout verbatim and re-derives the order from it", () => {
    const base = state(["A", "B", "C"]);
    const placed: TileLayout = [
      { sessionId: "C", x: 0, y: 0, w: 48, h: 24 },
      { sessionId: "A", x: 0, y: 24, w: 24, h: 24 },
      { sessionId: "B", x: 24, y: 24, w: 24, h: 24 },
    ];

    const next = orderingReducer(base, { type: "place", layout: placed });

    expect(next.layout).toEqual(placed);
    expect(next.order).toEqual(["C", "A", "B"]);
  });

  it("reconciles the tiling when sync adds and removes ids", () => {
    const base = state(["A", "B", "C"]);

    const grown = orderingReducer(base, { type: "sync", ids: ["A", "B", "C", "D"] });
    expect(isValidLayout(grown.layout)).toBe(true);
    expect([...idsOf(grown.layout)].sort()).toEqual(["A", "B", "C", "D"]);

    const shrunk = orderingReducer(grown, { type: "sync", ids: ["B", "D"] });
    expect(isValidLayout(shrunk.layout)).toBe(true);
    expect([...idsOf(shrunk.layout)].sort()).toEqual(["B", "D"]);
    expect(shrunk.order).toEqual(idsOf(shrunk.layout));
  });

  it("appends a session into the tiling in one transition", () => {
    const next = orderingReducer(state(["A", "B"]), { type: "append", id: "C" });

    expect(isValidLayout(next.layout)).toBe(true);
    expect(next.order).toEqual(idsOf(next.layout));
    expect(next.order).toContain("C");
  });

  it("reorders tabs without touching the tiling", () => {
    const base = state(["A", "B", "C"]);
    const shape = readingOrder(base.layout).map(({ x, y, w, h }) => ({ x, y, w, h }));

    const next = orderingReducer(base, { type: "reorder", fromId: "C", toId: "A" });

    expect(next.order).toEqual(["C", "A", "B"]);
    expect(readingOrder(next.layout).map(({ x, y, w, h }) => ({ x, y, w, h }))).toEqual(
      shape,
    );
    expect(idsOf(next.layout)).toEqual(["C", "A", "B"]);
  });

  it("expands the chosen preset against the current order", () => {
    const base = state(["A", "B", "C"]);
    const rows = presetFor(["A", "B", "C"], "3 rows");

    const next = orderingReducer(base, { type: "preset", preset: rows });

    expect(next.layout).toEqual(expandPreset(["A", "B", "C"], rows));
    expect(next.order).toEqual(["A", "B", "C"]);
  });

  it("returns the same state reference when nothing moved", () => {
    const base = state(["A", "B"]);

    expect(orderingReducer(base, { type: "sync", ids: ["A", "B"] })).toBe(base);
    expect(orderingReducer(base, { type: "append", id: "A" })).toBe(base);
    expect(orderingReducer(base, { type: "place", layout: base.layout })).toBe(base);
  });

  it("keeps the empty-layout sentinel while no custom shape has been chosen", () => {
    // An empty layout means "no custom shape stored": the caller resolves it to the
    // default preset for the live count, so pinning a shape here would stop the grid
    // re-defaulting when a terminal is opened or closed.
    const empty: OrderingState = { order: [], layout: [] };
    const next = orderingReducer(empty, { type: "sync", ids: ["A", "B", "C"] });

    expect(next.layout).toEqual([]);
    expect(next.order).toEqual(["A", "B", "C"]);
  });

  it("replaces both halves on reset", () => {
    const replacement = state(["X", "Y"]);
    expect(orderingReducer(state(["A"]), { type: "reset", state: replacement })).toBe(
      replacement,
    );
  });

  it("applying the same action twice equals applying it once", () => {
    const base = deepFreezeState(state(["A", "B", "C"]));
    const placed: TileLayout = [
      { sessionId: "A", x: 0, y: 0, w: 48, h: 16 },
      { sessionId: "B", x: 0, y: 16, w: 48, h: 16 },
      { sessionId: "C", x: 0, y: 32, w: 48, h: 16 },
    ];

    const actions: OrderingAction[] = [
      { type: "sync", ids: ["A", "B", "C", "D"] },
      { type: "sync", ids: ["A", "B"] },
      { type: "append", id: "D" },
      { type: "reorder", fromId: "C", toId: "A" },
      { type: "place", layout: placed },
      { type: "preset", preset: presetFor(["A", "B", "C"], "3 columns") },
      { type: "reset", state: state(["X"]) },
    ];

    for (const action of actions) {
      const once = orderingReducer(base, action);
      const twice = orderingReducer(once, action);
      expect(twice, `replaying ${action.type} changed the state`).toEqual(once);
      // StrictMode double-*invokes* the reducer with the same state and action and keeps
      // the second result, so purity is the property that actually guards against it.
      expect(
        orderingReducer(base, action),
        `${action.type} is not a pure function of (state, action)`,
      ).toEqual(once);
    }
  });

  it("keeps a valid tiling through any sequence of actions", () => {
    let current = state(["A", "B"]);
    const script: OrderingAction[] = [
      { type: "append", id: "C" },
      { type: "reorder", fromId: "C", toId: "A" },
      { type: "sync", ids: ["A", "C", "D", "E"] },
      { type: "preset", preset: presetFor(["A", "C", "D", "E"], "4 columns") },
      { type: "sync", ids: ["D"] },
    ];

    for (const action of script) {
      current = orderingReducer(current, action);
      expect(isValidLayout(current.layout), action.type).toBe(true);
      expect(current.order, action.type).toEqual(idsOf(current.layout));
    }
  });
});
