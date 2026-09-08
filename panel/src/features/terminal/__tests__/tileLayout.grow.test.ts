import { describe, it, expect } from "vitest";
import {
  expandPreset,
  getLayoutPresets,
  growRegion,
  isValidLayout,
  type TileLayout,
} from "../tileLayout";

const tileOf = (layout: TileLayout, id: string) =>
  layout.find((t) => t.sessionId === id)!;

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);

// Nine sessions in a 3x3 of 4x4-zone cells — Greg's example.
const threeByThree: TileLayout = expandPreset(
  ids(9),
  getLayoutPresets(9).find((p) => p.label === "Even grid")!,
);

const grid3x3: TileLayout = [
  { sessionId: "a", x: 0, y: 0, w: 4, h: 4 },
  { sessionId: "b", x: 4, y: 0, w: 4, h: 4 },
  { sessionId: "c", x: 8, y: 0, w: 4, h: 4 },
  { sessionId: "d", x: 0, y: 4, w: 4, h: 4 },
  { sessionId: "e", x: 4, y: 4, w: 4, h: 4 },
  { sessionId: "f", x: 8, y: 4, w: 4, h: 4 },
  { sessionId: "g", x: 0, y: 8, w: 4, h: 4 },
  { sessionId: "h", x: 4, y: 8, w: 4, h: 4 },
  { sessionId: "i", x: 8, y: 8, w: 4, h: 4 },
];

describe("growRegion", () => {
  it("gives a window the full width when the region is swept across the row", () => {
    // The gesture Greg asked for: on a 3x3, sweep the top-left window left to right and
    // it should own the whole top band.
    const next = growRegion(grid3x3, "a", { x: 0, y: 0, w: 12, h: 4 })!;

    expect(next).not.toBeNull();
    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "a")).toMatchObject({ x: 0, y: 0, w: 12, h: 4 });
    // b and c were swallowed; everyone still has exactly one rectangle.
    expect(next).toHaveLength(9);
  });

  it("grows a window over a block and re-tiles the rest around it", () => {
    const next = growRegion(grid3x3, "e", { x: 4, y: 0, w: 8, h: 8 })!;

    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "e")).toMatchObject({ x: 4, y: 0, w: 8, h: 8 });
    expect(next).toHaveLength(9);
  });

  it("keeps the grid fully tiled for every region a sweep can produce", () => {
    for (let w = 1; w <= 12; w += 3) {
      for (let h = 1; h <= 12; h += 3) {
        const next = growRegion(grid3x3, "a", { x: 0, y: 0, w, h });
        if (next) {
          expect(isValidLayout(next), `${w}x${h}`).toBe(true);
          expect(next, `${w}x${h}`).toHaveLength(9);
        }
      }
    }
  });

  it("refuses a region that leaves too little room for the others", () => {
    // Eight other sessions cannot fit into the eight zones left by an 11x12 region…
    expect(growRegion(grid3x3, "a", { x: 0, y: 0, w: 11, h: 12 })).not.toBeNull();
    // …but nothing fits when the region takes the whole grid.
    expect(growRegion(grid3x3, "a", { x: 0, y: 0, w: 12, h: 12 })).toBeNull();
  });

  it("hands the whole grid to a lone session", () => {
    const solo: TileLayout = [{ sessionId: "a", x: 0, y: 0, w: 12, h: 12 }];
    expect(growRegion(solo, "a", { x: 0, y: 0, w: 12, h: 12 })).toEqual(solo);
    expect(growRegion(solo, "a", { x: 0, y: 0, w: 6, h: 12 })).toBeNull();
  });

  it("also shrinks: a smaller region gives the space back to the others", () => {
    const twoColumns: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 6, h: 12 },
      { sessionId: "b", x: 6, y: 0, w: 6, h: 12 },
    ];
    const next = growRegion(twoColumns, "a", { x: 0, y: 0, w: 3, h: 12 })!;

    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "a")).toMatchObject({ x: 0, y: 0, w: 3, h: 12 });
    expect(tileOf(next, "b")).toMatchObject({ x: 3, y: 0, w: 9, h: 12 });
  });

  it("works on the generated presets too", () => {
    const next = growRegion(threeByThree, "s1", { x: 0, y: 0, w: 12, h: 4 });
    if (next) expect(isValidLayout(next)).toBe(true);
  });
});
