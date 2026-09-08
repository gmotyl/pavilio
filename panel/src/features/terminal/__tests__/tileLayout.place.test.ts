import { describe, it, expect } from "vitest";
import {
  isValidLayout,
  placeRegion,
  regionOfTiles,
  type TileLayout,
} from "../tileLayout";

// a | b   — two full-height columns
const twoColumns: TileLayout = [
  { sessionId: "a", x: 0, y: 0, w: 6, h: 12 },
  { sessionId: "b", x: 6, y: 0, w: 6, h: 12 },
];

// a | b   — a on the left, b over c on the right (the reported 3-window shape)
const oneLeftTwoRight: TileLayout = [
  { sessionId: "a", x: 0, y: 0, w: 6, h: 12 },
  { sessionId: "b", x: 6, y: 0, w: 6, h: 6 },
  { sessionId: "c", x: 6, y: 6, w: 6, h: 6 },
];

const tileOf = (layout: TileLayout, id: string) =>
  layout.find((t) => t.sessionId === id)!;

describe("regionOfTiles", () => {
  it("takes the bounding box of the named sessions", () => {
    expect(regionOfTiles(oneLeftTwoRight, ["b", "c"])).toEqual({
      x: 6,
      y: 0,
      w: 6,
      h: 12,
    });
  });
});

describe("placeRegion", () => {
  it("swaps two sessions when the region is exactly another tile", () => {
    const next = placeRegion(twoColumns, "a", { x: 6, y: 0, w: 6, h: 12 })!;

    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "a")).toMatchObject({ x: 6, y: 0, w: 6, h: 12 });
    expect(tileOf(next, "b")).toMatchObject({ x: 0, y: 0, w: 6, h: 12 });
  });

  it("splits a tile at the nearest boundary and gives the dragged session the hovered part", () => {
    // c is dragged onto b's top band: b spans y 0..5, so the split lands at y 3.
    const next = placeRegion(oneLeftTwoRight, "c", { x: 6, y: 0, w: 6, h: 3 })!;

    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "c")).toMatchObject({ x: 6, y: 0, w: 6, h: 3 });
    // b keeps the complementary band and then absorbs the rectangle c vacated.
    expect(tileOf(next, "b")).toMatchObject({ x: 6, y: 3, w: 6, h: 9 });
    expect(tileOf(next, "a")).toMatchObject({ x: 0, y: 0, w: 6, h: 12 });
  });

  it("absorbs the vacated rectangle so the split leaves no hole", () => {
    const next = placeRegion(oneLeftTwoRight, "c", { x: 6, y: 0, w: 6, h: 3 })!;
    // Only b can extend into y 6..11 of the right column rectangularly.
    expect(tileOf(next, "b")).toMatchObject({ x: 6, y: 3, w: 6, h: 9 });
  });

  it("slices the vacated rectangle into strips for several displaced sessions", () => {
    const next = placeRegion(oneLeftTwoRight, "a", { x: 6, y: 0, w: 6, h: 12 })!;

    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "a")).toMatchObject({ x: 6, y: 0, w: 6, h: 12 });
    // b and c share a's vacated full-height column, split along its longer axis.
    expect(tileOf(next, "b")).toMatchObject({ x: 0, y: 0, w: 6, h: 6 });
    expect(tileOf(next, "c")).toMatchObject({ x: 0, y: 6, w: 6, h: 6 });
  });

  it("cuts strips on the shorter axis when the longer one has too few zones", () => {
    // d's tile is 12 wide and 1 tall: three displaced sessions must be cut on x.
    const layout: TileLayout = [
      { sessionId: "d", x: 0, y: 11, w: 12, h: 1 },
      { sessionId: "a", x: 0, y: 0, w: 4, h: 11 },
      { sessionId: "b", x: 4, y: 0, w: 4, h: 11 },
      { sessionId: "c", x: 8, y: 0, w: 4, h: 11 },
    ];
    const next = placeRegion(layout, "d", { x: 0, y: 0, w: 12, h: 11 })!;

    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "d")).toMatchObject({ x: 0, y: 0, w: 12, h: 11 });
    expect(tileOf(next, "a")).toMatchObject({ y: 11, h: 1 });
    expect(tileOf(next, "c")).toMatchObject({ y: 11, h: 1 });
  });

  it("returns null when the displaced sessions cannot fit the vacated rectangle", () => {
    const layout: TileLayout = [
      { sessionId: "d", x: 0, y: 11, w: 1, h: 1 },
      { sessionId: "e", x: 1, y: 11, w: 11, h: 1 },
      { sessionId: "a", x: 0, y: 0, w: 4, h: 11 },
      { sessionId: "b", x: 4, y: 0, w: 4, h: 11 },
      { sessionId: "c", x: 8, y: 0, w: 4, h: 11 },
    ];
    // Three sessions cannot be tiled into d's single zone.
    expect(placeRegion(layout, "d", { x: 0, y: 0, w: 12, h: 11 })).toBeNull();
  });

  it("returns null when the region only partially covers a tile without splitting it cleanly", () => {
    expect(placeRegion(twoColumns, "a", { x: 3, y: 0, w: 6, h: 12 })).toBeNull();
  });

  it("returns null when the region swallows the dragged session's own tile", () => {
    expect(placeRegion(oneLeftTwoRight, "b", { x: 0, y: 0, w: 12, h: 12 })).toBeNull();
  });

  it("always returns a valid tiling", () => {
    const regions = [
      { x: 6, y: 0, w: 6, h: 6 },
      { x: 6, y: 6, w: 6, h: 6 },
      { x: 6, y: 0, w: 6, h: 12 },
      { x: 6, y: 0, w: 3, h: 6 },
    ];
    for (const region of regions) {
      const next = placeRegion(oneLeftTwoRight, "a", region);
      if (next) expect(isValidLayout(next), JSON.stringify(region)).toBe(true);
    }
  });

  it("is idempotent when re-applied to its own result", () => {
    const region = { x: 6, y: 0, w: 6, h: 12 };
    const once = placeRegion(oneLeftTwoRight, "a", region)!;
    const twice = placeRegion(once, "a", region)!;
    expect(twice).toEqual(once);
  });
});
