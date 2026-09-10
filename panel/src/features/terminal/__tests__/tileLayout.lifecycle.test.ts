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
    expect(tileOf(next, "a")).toMatchObject({ x: 0, y: 0, w: 24, h: 48 });
    // b is last in reading order; its longer axis is height, so it splits there.
    expect(tileOf(next, "b")).toMatchObject({ x: 24, y: 0, w: 24, h: 24 });
    expect(tileOf(next, "c")).toMatchObject({ x: 24, y: 24, w: 24, h: 24 });
  });

  it("splits along the longer axis", () => {
    const layout: TileLayout = [{ sessionId: "a", x: 0, y: 0, w: 48, h: 48 }];
    const next = appendSession(layout, "b");
    // A square splits on x (width >= height), giving two columns.
    expect(tileOf(next, "a")).toMatchObject({ w: 24, h: 48 });
    expect(tileOf(next, "b")).toMatchObject({ x: 24, w: 24, h: 48 });
  });

  it("walks back to a larger tile when the last one is too small to split", () => {
    const layout: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 48, h: 36 },
      { sessionId: "b", x: 0, y: 36, w: 48, h: 8 },
      { sessionId: "c", x: 0, y: 44, w: 48, h: 4 },
    ];
    const next = appendSession(layout, "d");

    expect(isValidLayout(next)).toBe(true);
    // c (1 zone) and b (2 zones on the split axis) are below the 4-zone preference,
    // so the split falls back to a, which has 9.
    expect(tileOf(next, "c")).toMatchObject({ y: 44, h: 4 });
    expect(tileOf(next, "d").h).toBeGreaterThan(1);
  });

  it("splits the last tile anyway when nothing qualifies", () => {
    const layout: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 48, h: 36 },
      { sessionId: "b", x: 0, y: 36, w: 24, h: 12 },
      { sessionId: "c", x: 24, y: 36, w: 24, h: 12 },
    ];
    // Force the fallback with tiles that all fail the preference on their split axis.
    const tight: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 12, h: 12 },
      { sessionId: "b", x: 12, y: 0, w: 36, h: 12 },
      { sessionId: "c", x: 0, y: 12, w: 48, h: 36 },
    ];
    expect(isValidLayout(appendSession(layout, "d"))).toBe(true);
    expect(isValidLayout(appendSession(tight, "d"))).toBe(true);
  });

  it("starts from the default preset when the layout is empty", () => {
    expect(appendSession([], "a")).toEqual([
      { sessionId: "a", x: 0, y: 0, w: 48, h: 48 },
    ]);
  });
});

describe("removeSession", () => {
  it("absorbs a closed session's rectangle into its longest-edge neighbour", () => {
    const layout = defaultFor(["a", "b", "c"]); // a left, b over c on the right
    const next = removeSession(layout, "c");

    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "b")).toMatchObject({ x: 24, y: 0, w: 24, h: 48 });
  });

  it("breaks absorption ties in top-to-left order", () => {
    // The removed tile's four sides all share an edge of the same length.
    const layout: TileLayout = [
      { sessionId: "top", x: 0, y: 0, w: 48, h: 16 },
      { sessionId: "gone", x: 0, y: 16, w: 48, h: 16 },
      { sessionId: "bottom", x: 0, y: 32, w: 48, h: 16 },
    ];
    const next = removeSession(layout, "gone");

    expect(tileOf(next, "top")).toMatchObject({ y: 0, h: 32 });
    expect(tileOf(next, "bottom")).toMatchObject({ y: 32, h: 16 });
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
