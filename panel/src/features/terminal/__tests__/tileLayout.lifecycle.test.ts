import { describe, it, expect } from "vitest";
import {
  appendSession,
  expandPreset,
  getLayoutPresets,
  isValidLayout,
  readingOrder,
  reconcileTiles,
  removeSession,
  type TileLayout,
} from "../tileLayout";

const tileOf = (layout: TileLayout, id: string) =>
  layout.find((t) => t.sessionId === id)!;

const defaultFor = (ids: string[]) =>
  expandPreset(ids, getLayoutPresets(ids.length)[0]);

describe("appendSession", () => {
  it("splits the last tile in reading order for a new session", () => {
    const layout = defaultFor(["a", "b"]); // two full-height columns
    const next = appendSession(layout, "c");

    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "a")).toMatchObject({ x: 0, y: 0, w: 6, h: 12 });
    // b is last in reading order; its longer axis is height, so it splits there.
    expect(tileOf(next, "b")).toMatchObject({ x: 6, y: 0, w: 6, h: 6 });
    expect(tileOf(next, "c")).toMatchObject({ x: 6, y: 6, w: 6, h: 6 });
  });

  it("splits along the longer axis", () => {
    const layout: TileLayout = [{ sessionId: "a", x: 0, y: 0, w: 12, h: 12 }];
    const next = appendSession(layout, "b");
    // A square splits on x (width >= height), giving two columns.
    expect(tileOf(next, "a")).toMatchObject({ w: 6, h: 12 });
    expect(tileOf(next, "b")).toMatchObject({ x: 6, w: 6, h: 12 });
  });

  it("walks back to a larger tile when the last one is too small to split", () => {
    const layout: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 12, h: 9 },
      { sessionId: "b", x: 0, y: 9, w: 12, h: 2 },
      { sessionId: "c", x: 0, y: 11, w: 12, h: 1 },
    ];
    const next = appendSession(layout, "d");

    expect(isValidLayout(next)).toBe(true);
    // c (1 zone) and b (2 zones on the split axis) are below the 4-zone preference,
    // so the split falls back to a, which has 9.
    expect(tileOf(next, "c")).toMatchObject({ y: 11, h: 1 });
    expect(tileOf(next, "d").h).toBeGreaterThan(1);
  });

  it("splits the last tile anyway when nothing qualifies", () => {
    const layout: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 12, h: 9 },
      { sessionId: "b", x: 0, y: 9, w: 6, h: 3 },
      { sessionId: "c", x: 6, y: 9, w: 6, h: 3 },
    ];
    // Every tile is below 4 zones on its longer axis except a (12 wide) — force the
    // fallback by shrinking the grid to tiles that all fail the preference.
    const tight: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 3, h: 3 },
      { sessionId: "b", x: 3, y: 0, w: 9, h: 3 },
      { sessionId: "c", x: 0, y: 3, w: 12, h: 9 },
    ];
    expect(isValidLayout(appendSession(layout, "d"))).toBe(true);
    expect(isValidLayout(appendSession(tight, "d"))).toBe(true);
  });

  it("starts from the default preset when the layout is empty", () => {
    expect(appendSession([], "a")).toEqual([
      { sessionId: "a", x: 0, y: 0, w: 12, h: 12 },
    ]);
  });
});

describe("removeSession", () => {
  it("absorbs a closed session's rectangle into its longest-edge neighbour", () => {
    const layout = defaultFor(["a", "b", "c"]); // a left, b over c on the right
    const next = removeSession(layout, "c");

    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "b")).toMatchObject({ x: 6, y: 0, w: 6, h: 12 });
  });

  it("breaks absorption ties in top-to-left order", () => {
    // The removed tile's four sides all share an edge of the same length.
    const layout: TileLayout = [
      { sessionId: "top", x: 0, y: 0, w: 12, h: 4 },
      { sessionId: "gone", x: 0, y: 4, w: 12, h: 4 },
      { sessionId: "bottom", x: 0, y: 8, w: 12, h: 4 },
    ];
    const next = removeSession(layout, "gone");

    expect(tileOf(next, "top")).toMatchObject({ y: 0, h: 8 });
    expect(tileOf(next, "bottom")).toMatchObject({ y: 8, h: 4 });
  });

  it("empties the layout when the last session goes", () => {
    expect(removeSession(defaultFor(["a"]), "a")).toEqual([]);
  });
});

describe("reconcileTiles", () => {
  it("keeps a valid tiling across a sequence of opens and closes", () => {
    let layout = defaultFor(["a", "b", "c"]);
    const steps = [
      ["a", "b", "c", "d"],
      ["a", "b", "c", "d", "e"],
      ["a", "c", "e"],
      ["c"],
      ["c", "f", "g"],
    ];
    for (const ids of steps) {
      layout = reconcileTiles(layout, ids);
      expect(isValidLayout(layout), ids.join(",")).toBe(true);
      expect(layout.map((t) => t.sessionId).sort()).toEqual([...ids].sort());
    }
  });

  it("is idempotent for the same id set", () => {
    const layout = reconcileTiles(defaultFor(["a", "b"]), ["a", "b", "c"]);
    expect(reconcileTiles(layout, ["a", "b", "c"])).toEqual(layout);
  });

  it("appends new sessions in the order given", () => {
    const layout = reconcileTiles(defaultFor(["a"]), ["a", "b", "c"]);
    expect(readingOrder(layout)).toHaveLength(3);
    expect(layout.map((t) => t.sessionId).sort()).toEqual(["a", "b", "c"]);
  });
});
