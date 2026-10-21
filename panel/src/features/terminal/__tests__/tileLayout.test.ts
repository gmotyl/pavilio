import { describe, it, expect } from "vitest";
import {
  GRID,
  isValidLayout,
  readingOrder,
  splitPoint,
  type TileLayout,
} from "../tileLayout";

const full: TileLayout = [{ sessionId: "a", x: 0, y: 0, w: GRID, h: GRID }];

const HALF = GRID / 2;

describe("isValidLayout", () => {
  it.each<[label: string, layout: TileLayout]>([
    ["a single full-grid tile", full],
    [
      "a two-column split",
      [
        { sessionId: "a", x: 0, y: 0, w: HALF, h: GRID },
        { sessionId: "b", x: HALF, y: 0, w: HALF, h: GRID },
      ],
    ],
  ])("accepts %s", (_label, layout) => {
    expect(isValidLayout(layout)).toBe(true);
  });

  it.each<[label: string, layout: TileLayout]>([
    [
      "a layout leaving a zone uncovered",
      [
        { sessionId: "a", x: 0, y: 0, w: HALF, h: GRID },
        { sessionId: "b", x: HALF, y: 0, w: HALF - 1, h: GRID },
      ],
    ],
    [
      "overlapping tiles",
      [
        { sessionId: "a", x: 0, y: 0, w: HALF + 1, h: GRID },
        { sessionId: "b", x: HALF, y: 0, w: HALF, h: GRID },
      ],
    ],
    [
      "the same session in two tiles",
      [
        { sessionId: "a", x: 0, y: 0, w: HALF, h: GRID },
        { sessionId: "a", x: HALF, y: 0, w: HALF, h: GRID },
      ],
    ],
    [
      "a tile with a zero or negative side",
      [
        { sessionId: "a", x: 0, y: 0, w: GRID, h: GRID },
        { sessionId: "b", x: 0, y: 0, w: 0, h: 0 },
      ],
    ],
    ["a tile reaching outside the matrix", [{ sessionId: "a", x: 0, y: 0, w: GRID + 1, h: GRID }]],
    ["the empty layout (it covers nothing)", []],
    // A two-column split exactly as the 12-zone era wrote it. On the 48-zone matrix
    // it covers only the top-left quarter, so the read-repair gate drops it and the
    // scope falls back to its count's default preset — no migration code needed.
    [
      "a layout stored against the 12-zone matrix",
      [
        { sessionId: "a", x: 0, y: 0, w: 6, h: 12 },
        { sessionId: "b", x: 6, y: 0, w: 6, h: 12 },
      ],
    ],
  ])("rejects %s", (_label, layout) => {
    expect(isValidLayout(layout)).toBe(false);
  });
});

describe("splitPoint", () => {
  // An even span splits in half, an odd span nearest the middle.
  it.each<[span: number, point: number]>([
    [2, 1],
    [3, 1],
    [4, 2],
    [5, 2],
    [GRID, GRID / 2],
  ])("splits a span of %i at %i", (span, point) => {
    expect(splitPoint(span)).toBe(point);
  });
});

describe("readingOrder", () => {
  it("orders tiles top to bottom, then left to right", () => {
    const layout: TileLayout = [
      { sessionId: "c", x: 0, y: HALF, w: GRID, h: HALF },
      { sessionId: "b", x: HALF, y: 0, w: HALF, h: HALF },
      { sessionId: "a", x: 0, y: 0, w: HALF, h: HALF },
    ];
    expect(readingOrder(layout).map((t: { sessionId: string }) => t.sessionId)).toEqual(["a", "b", "c"]);
  });
});
