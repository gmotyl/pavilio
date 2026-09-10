import { describe, it, expect } from "vitest";
import {
  isValidLayout,
  placeRegion,
  regionOfTiles,
  type TileLayout,
} from "../tileLayout";

// a | b   — two full-height columns
const twoColumns: TileLayout = [
  { sessionId: "a", x: 0, y: 0, w: 24, h: 48 },
  { sessionId: "b", x: 24, y: 0, w: 24, h: 48 },
];

// a | b   — a on the left, b over c on the right (the reported 3-window shape)
const oneLeftTwoRight: TileLayout = [
  { sessionId: "a", x: 0, y: 0, w: 24, h: 48 },
  { sessionId: "b", x: 24, y: 0, w: 24, h: 24 },
  { sessionId: "c", x: 24, y: 24, w: 24, h: 24 },
];

const tileOf = (layout: TileLayout, id: string) =>
  layout.find((t) => t.sessionId === id)!;

describe("regionOfTiles", () => {
  it("takes the bounding box of the named sessions", () => {
    expect(regionOfTiles(oneLeftTwoRight, ["b", "c"])).toEqual({
      x: 24,
      y: 0,
      w: 24,
      h: 48,
    });
  });
});

describe("placeRegion", () => {
  it("swaps two sessions when the region is exactly another tile", () => {
    const next = placeRegion(twoColumns, "a", { x: 24, y: 0, w: 24, h: 48 })!;

    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "a")).toMatchObject({ x: 24, y: 0, w: 24, h: 48 });
    expect(tileOf(next, "b")).toMatchObject({ x: 0, y: 0, w: 24, h: 48 });
  });

  it("splits a tile at the nearest boundary and gives the dragged session the hovered part", () => {
    // c is dragged onto b's top band: b spans y 0..5, so the split lands at y 3.
    const next = placeRegion(oneLeftTwoRight, "c", { x: 24, y: 0, w: 24, h: 12 })!;

    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "c")).toMatchObject({ x: 24, y: 0, w: 24, h: 12 });
    // b keeps the complementary band and then absorbs the rectangle c vacated.
    expect(tileOf(next, "b")).toMatchObject({ x: 24, y: 12, w: 24, h: 36 });
    expect(tileOf(next, "a")).toMatchObject({ x: 0, y: 0, w: 24, h: 48 });
  });

  it("absorbs the vacated rectangle so the split leaves no hole", () => {
    const next = placeRegion(oneLeftTwoRight, "c", { x: 24, y: 0, w: 24, h: 12 })!;
    // Only b can extend into y 6..11 of the right column rectangularly.
    expect(tileOf(next, "b")).toMatchObject({ x: 24, y: 12, w: 24, h: 36 });
  });

  it("slices the vacated rectangle into strips for several displaced sessions", () => {
    const next = placeRegion(oneLeftTwoRight, "a", { x: 24, y: 0, w: 24, h: 48 })!;

    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "a")).toMatchObject({ x: 24, y: 0, w: 24, h: 48 });
    // b and c share a's vacated full-height column, split along its longer axis.
    expect(tileOf(next, "b")).toMatchObject({ x: 0, y: 0, w: 24, h: 24 });
    expect(tileOf(next, "c")).toMatchObject({ x: 0, y: 24, w: 24, h: 24 });
  });

  it("cuts strips on the shorter axis when the longer one has too few zones", () => {
    // d's tile is 12 wide and 1 tall: three displaced sessions must be cut on x.
    const layout: TileLayout = [
      { sessionId: "d", x: 0, y: 44, w: 48, h: 4 },
      { sessionId: "a", x: 0, y: 0, w: 16, h: 44 },
      { sessionId: "b", x: 16, y: 0, w: 16, h: 44 },
      { sessionId: "c", x: 32, y: 0, w: 16, h: 44 },
    ];
    const next = placeRegion(layout, "d", { x: 0, y: 0, w: 48, h: 44 })!;

    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "d")).toMatchObject({ x: 0, y: 0, w: 48, h: 44 });
    expect(tileOf(next, "a")).toMatchObject({ y: 44, h: 4 });
    expect(tileOf(next, "c")).toMatchObject({ y: 44, h: 4 });
  });

  it("returns null when the displaced sessions cannot fit the vacated rectangle", () => {
    const layout: TileLayout = [
      { sessionId: "d", x: 0, y: 47, w: 1, h: 1 },
      { sessionId: "e", x: 1, y: 47, w: 47, h: 1 },
      { sessionId: "a", x: 0, y: 0, w: 16, h: 47 },
      { sessionId: "b", x: 16, y: 0, w: 16, h: 47 },
      { sessionId: "c", x: 32, y: 0, w: 16, h: 47 },
    ];
    // Three sessions cannot be tiled into d's single zone.
    expect(placeRegion(layout, "d", { x: 0, y: 0, w: 48, h: 47 })).toBeNull();
  });

  it("returns null when the region only partially covers a tile without splitting it cleanly", () => {
    expect(placeRegion(twoColumns, "a", { x: 12, y: 0, w: 24, h: 48 })).toBeNull();
  });

  it("returns null when the region swallows the dragged session's own tile", () => {
    expect(placeRegion(oneLeftTwoRight, "b", { x: 0, y: 0, w: 48, h: 48 })).toBeNull();
  });

  it("always returns a valid tiling", () => {
    const regions = [
      { x: 24, y: 0, w: 24, h: 24 },
      { x: 24, y: 24, w: 24, h: 24 },
      { x: 24, y: 0, w: 24, h: 48 },
      { x: 24, y: 0, w: 12, h: 24 },
    ];
    for (const region of regions) {
      const next = placeRegion(oneLeftTwoRight, "a", region);
      if (next) expect(isValidLayout(next), JSON.stringify(region)).toBe(true);
    }
  });

  it("is idempotent when re-applied to its own result", () => {
    const region = { x: 24, y: 0, w: 24, h: 48 };
    const once = placeRegion(oneLeftTwoRight, "a", region)!;
    const twice = placeRegion(once, "a", region)!;
    expect(twice).toEqual(once);
  });
});
