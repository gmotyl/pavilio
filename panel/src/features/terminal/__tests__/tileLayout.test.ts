import { describe, it, expect } from "vitest";
import {
  GRID,
  isValidLayout,
  readingOrder,
  splitPoint,
  type TileLayout,
} from "../tileLayout";

const full: TileLayout = [{ sessionId: "a", x: 0, y: 0, w: GRID, h: GRID }];

describe("isValidLayout", () => {
  it("accepts a single full-grid tile", () => {
    expect(isValidLayout(full)).toBe(true);
  });

  it("accepts a two-column split", () => {
    expect(
      isValidLayout([
        { sessionId: "a", x: 0, y: 0, w: 6, h: 12 },
        { sessionId: "b", x: 6, y: 0, w: 6, h: 12 },
      ]),
    ).toBe(true);
  });

  it("rejects a layout leaving a zone uncovered", () => {
    expect(
      isValidLayout([
        { sessionId: "a", x: 0, y: 0, w: 6, h: 12 },
        { sessionId: "b", x: 6, y: 0, w: 5, h: 12 },
      ]),
    ).toBe(false);
  });

  it("rejects overlapping tiles", () => {
    expect(
      isValidLayout([
        { sessionId: "a", x: 0, y: 0, w: 7, h: 12 },
        { sessionId: "b", x: 6, y: 0, w: 6, h: 12 },
      ]),
    ).toBe(false);
  });

  it("rejects the same session in two tiles", () => {
    expect(
      isValidLayout([
        { sessionId: "a", x: 0, y: 0, w: 6, h: 12 },
        { sessionId: "a", x: 6, y: 0, w: 6, h: 12 },
      ]),
    ).toBe(false);
  });

  it("rejects a tile with a zero or negative side", () => {
    expect(
      isValidLayout([
        { sessionId: "a", x: 0, y: 0, w: 12, h: 12 },
        { sessionId: "b", x: 0, y: 0, w: 0, h: 0 },
      ]),
    ).toBe(false);
  });

  it("rejects a tile reaching outside the matrix", () => {
    expect(isValidLayout([{ sessionId: "a", x: 0, y: 0, w: 13, h: 12 }])).toBe(false);
  });

  it("treats the empty layout as valid only when it covers nothing on purpose", () => {
    expect(isValidLayout([])).toBe(false);
  });
});

describe("splitPoint", () => {
  it("splits an even span in half and an odd span nearest the middle", () => {
    expect(splitPoint(2)).toBe(1);
    expect(splitPoint(3)).toBe(1);
    expect(splitPoint(4)).toBe(2);
    expect(splitPoint(5)).toBe(2);
    expect(splitPoint(12)).toBe(6);
  });
});

describe("readingOrder", () => {
  it("orders tiles top to bottom, then left to right", () => {
    const layout: TileLayout = [
      { sessionId: "c", x: 0, y: 6, w: 12, h: 6 },
      { sessionId: "b", x: 6, y: 0, w: 6, h: 6 },
      { sessionId: "a", x: 0, y: 0, w: 6, h: 6 },
    ];
    expect(readingOrder(layout).map((t: { sessionId: string }) => t.sessionId)).toEqual(["a", "b", "c"]);
  });
});
