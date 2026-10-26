import { describe, it, expect } from "vitest";
import { orderingReducer, type OrderingAction, type OrderingState } from "../orderingReducer";
import {
  appendSession,
  expandPreset,
  getLayoutPresets,
  isValidLayout,
  readingOrder,
  removeSession,
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
  minimised: [],
});

const idsOf = (layout: TileLayout) => readingOrder(layout).map((t) => t.sessionId);

/**
 * Freeze a state and everything reachable from it. React state is shared, not owned by
 * the reducer, so an in-place write is the impurity that actually corrupts it; under a
 * frozen input such a write throws instead of silently succeeding.
 */
function deepFreezeState(input: OrderingState): OrderingState {
  Object.freeze(input.order);
  Object.freeze(input.minimised);
  for (const tile of input.layout) Object.freeze(tile);
  Object.freeze(input.layout);
  return Object.freeze(input);
}

describe("orderingReducer", () => {
  it("remove drops the session and hands its rectangle to a survivor", () => {
    const base = deepFreezeState({
      order: ["A", "B", "C"],
      layout: [
        { sessionId: "A", x: 0, y: 0, w: 48, h: 20 },
        { sessionId: "B", x: 0, y: 20, w: 16, h: 28 },
        { sessionId: "C", x: 16, y: 20, w: 32, h: 28 },
      ],
      minimised: [],
    });

    const next = orderingReducer(base, { type: "remove", id: "B" });

    expect(next.order).toEqual(["A", "C"]);
    expect(isValidLayout(next.layout)).toBe(true);
    expect(idsOf(next.layout)).toEqual(["A", "C"]);
    expect(next.layout.find((t) => t.sessionId === "C")).toMatchObject({
      x: 0,
      y: 20,
      w: 48,
      h: 28,
    });
  });

  it("remove of the last session restores the empty sentinel", () => {
    const base = deepFreezeState({
      order: ["A"],
      layout: [{ sessionId: "A", x: 0, y: 0, w: 48, h: 48 }],
      minimised: [],
    });

    const next = orderingReducer(base, { type: "remove", id: "A" });

    // Empty means "no custom shape stored": the next terminal gets the default
    // preset for one session — the whole grid — not a slice of a ghost layout.
    expect(next.order).toEqual([]);
    expect(next.layout).toEqual([]);
    expect(orderingReducer(next, { type: "append", id: "B" }).layout).toEqual([]);
  });

  it("remove of an id it does not hold is the same state", () => {
    const base = deepFreezeState(state(["A", "B"]));

    expect(orderingReducer(base, { type: "remove", id: "Z" })).toBe(base);
  });

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
    const empty: OrderingState = { order: [], layout: [], minimised: [] };
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

describe("orderingReducer — minimised sessions", () => {
  /** A hand-seamed tiling of A, B, C — deliberately not any preset. */
  const customThree: TileLayout = [
    { sessionId: "A", x: 0, y: 0, w: 48, h: 20 },
    { sessionId: "B", x: 0, y: 20, w: 16, h: 28 },
    { sessionId: "C", x: 16, y: 20, w: 32, h: 28 },
  ];

  it("minimise takes a session out of the layout and re-tiles with the default preset", () => {
    const base = deepFreezeState({
      order: ["A", "B", "C", "D"],
      layout: [
        { sessionId: "A", x: 0, y: 0, w: 30, h: 24 },
        { sessionId: "B", x: 30, y: 0, w: 18, h: 24 },
        { sessionId: "C", x: 0, y: 24, w: 20, h: 24 },
        { sessionId: "D", x: 20, y: 24, w: 28, h: 24 },
      ],
      minimised: [],
    });

    const next = orderingReducer(base, { type: "minimise", id: "B" });

    expect(next.minimised).toEqual(["B"]);
    expect(next.order).toEqual(["A", "B", "C", "D"]);
    expect(next.layout).toEqual(expandPreset(["A", "C", "D"], getLayoutPresets(3)[0]));
  });

  it("minimise is a no-op on the last visible session", () => {
    const base = deepFreezeState({
      order: ["A", "B"],
      layout: [{ sessionId: "A", x: 0, y: 0, w: 48, h: 48 }],
      minimised: ["B"],
    });

    expect(orderingReducer(base, { type: "minimise", id: "A" })).toBe(base);

    const single = deepFreezeState(state(["A"]));
    expect(orderingReducer(single, { type: "minimise", id: "A" })).toBe(single);
  });

  it("minimise ignores unknown or already-minimised ids", () => {
    const base = deepFreezeState({
      order: ["A", "B", "C"],
      layout: defaultLayout(["A", "C"]),
      minimised: ["B"],
    });

    expect(orderingReducer(base, { type: "minimise", id: "B" })).toBe(base);
    expect(orderingReducer(base, { type: "minimise", id: "Z" })).toBe(base);
  });

  it("restore returns the session at its order position with the default preset", () => {
    const base = deepFreezeState({
      order: ["A", "B", "C", "D"],
      layout: [
        { sessionId: "A", x: 0, y: 0, w: 48, h: 10 },
        { sessionId: "C", x: 0, y: 10, w: 48, h: 38 },
      ],
      minimised: ["B", "D"],
    });

    const next = orderingReducer(base, { type: "restore", id: "B" });

    expect(next.minimised).toEqual(["D"]);
    expect(next.order).toEqual(["A", "B", "C", "D"]);
    expect(next.layout).toEqual(expandPreset(["A", "B", "C"], getLayoutPresets(3)[0]));
    expect(idsOf(next.layout)).toEqual(["A", "B", "C"]);
  });

  it("sync drops ended sessions from the minimised set", () => {
    const base = deepFreezeState({
      order: ["A", "B", "C", "D"],
      layout: customThree,
      minimised: ["D"],
    });

    const next = orderingReducer(base, { type: "sync", ids: ["A", "B", "C"] });

    expect(next.minimised).toEqual([]);
    expect(next.order).toEqual(["A", "B", "C"]);
    expect(next.layout).toEqual(customThree);
  });

  it("a session appended while others are minimised starts visible", () => {
    const base = deepFreezeState({
      order: ["A", "B", "C", "D"],
      layout: customThree,
      minimised: ["D"],
    });

    const next = orderingReducer(base, { type: "append", id: "E" });

    expect(next.minimised).toEqual(["D"]);
    expect(next.order).toContain("E");
    expect(next.layout).toEqual(appendSession(customThree, "E"));
    expect(isValidLayout(next.layout)).toBe(true);
  });

  it("removing a visible session absorbs over visible tiles only", () => {
    const base = deepFreezeState({
      order: ["A", "B", "C", "D"],
      layout: customThree,
      minimised: ["D"],
    });

    const next = orderingReducer(base, { type: "remove", id: "B" });

    expect(next.minimised).toEqual(["D"]);
    expect(next.order).toEqual(["A", "C", "D"]);
    expect(next.layout).toEqual(removeSession(customThree, "B"));
  });

  it("presets and placement tile visible sessions only", () => {
    const base = deepFreezeState({
      order: ["A", "B", "C", "D"],
      layout: customThree,
      minimised: ["B"],
    });
    const visible = ["A", "C", "D"];
    const rows = getLayoutPresets(3).find((p) => p.label === "3 rows")!;

    const preset = orderingReducer(base, { type: "preset", preset: rows });
    expect(preset.layout).toEqual(expandPreset(visible, rows));
    expect(preset.minimised).toEqual(["B"]);
    expect(preset.order).toEqual(["A", "B", "C", "D"]);

    const placed: TileLayout = [
      { sessionId: "D", x: 0, y: 0, w: 48, h: 24 },
      { sessionId: "A", x: 0, y: 24, w: 24, h: 24 },
      { sessionId: "C", x: 24, y: 24, w: 24, h: 24 },
    ];
    const afterPlace = orderingReducer(preset, { type: "place", layout: placed });
    expect(afterPlace.layout).toEqual(placed);
    expect(afterPlace.minimised).toEqual(["B"]);
    // The minimised session keeps its slot in the order; visible ones follow the tiling.
    expect(afterPlace.order).toEqual(["D", "B", "A", "C"]);

    const resized: TileLayout = [
      { sessionId: "D", x: 0, y: 0, w: 48, h: 20 },
      { sessionId: "A", x: 0, y: 20, w: 24, h: 28 },
      { sessionId: "C", x: 24, y: 20, w: 24, h: 28 },
    ];
    const afterResize = orderingReducer(afterPlace, { type: "resize", layout: resized });
    expect(afterResize.layout).toEqual(resized);
    expect(afterResize.minimised).toEqual(["B"]);
    expect(afterResize.order).toEqual(afterPlace.order);
  });
});
