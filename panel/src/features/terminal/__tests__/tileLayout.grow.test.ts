import { describe, it, expect } from "vitest";
import {
  GRID,
  expandPreset,
  getLayoutPresets,
  growRegion,
  isValidLayout,
  type TileLayout,
} from "../tileLayout";

const tileOf = (layout: TileLayout, id: string) =>
  layout.find((t) => t.sessionId === id)!;

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);

// Nine sessions in a 3x3 of 16x16-zone cells — Greg's example.
const threeByThree: TileLayout = expandPreset(
  ids(9),
  getLayoutPresets(9).find((p) => p.label === "Even grid")!,
);

const grid3x3: TileLayout = [
  { sessionId: "a", x: 0, y: 0, w: 16, h: 16 },
  { sessionId: "b", x: 16, y: 0, w: 16, h: 16 },
  { sessionId: "c", x: 32, y: 0, w: 16, h: 16 },
  { sessionId: "d", x: 0, y: 16, w: 16, h: 16 },
  { sessionId: "e", x: 16, y: 16, w: 16, h: 16 },
  { sessionId: "f", x: 32, y: 16, w: 16, h: 16 },
  { sessionId: "g", x: 0, y: 32, w: 16, h: 16 },
  { sessionId: "h", x: 16, y: 32, w: 16, h: 16 },
  { sessionId: "i", x: 32, y: 32, w: 16, h: 16 },
];

describe("growRegion", () => {
  it("gives a window the full width when the region is swept across the row", () => {
    // The gesture Greg asked for: on a 3x3, sweep the top-left window left to right and
    // it should own the whole top band.
    const next = growRegion(grid3x3, "a", { x: 0, y: 0, w: 48, h: 16 })!;

    expect(next).not.toBeNull();
    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "a")).toMatchObject({ x: 0, y: 0, w: 48, h: 16 });
    // b and c were swallowed; everyone still has exactly one rectangle.
    expect(next).toHaveLength(9);
  });

  it("grows a window over a block and re-tiles the rest around it", () => {
    const next = growRegion(grid3x3, "e", { x: 16, y: 0, w: 32, h: 32 })!;

    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "e")).toMatchObject({ x: 16, y: 0, w: 32, h: 32 });
    expect(next).toHaveLength(9);
  });

  it("keeps the grid fully tiled for every region a sweep can produce", () => {
    for (let w = 4; w <= GRID; w += 12) {
      for (let h = 4; h <= GRID; h += 12) {
        const next = growRegion(grid3x3, "a", { x: 0, y: 0, w, h });
        if (next) {
          expect(isValidLayout(next), `${w}x${h}`).toBe(true);
          expect(next, `${w}x${h}`).toHaveLength(9);
        }
      }
    }
  });

  it("refuses a region that leaves too little room for the others", () => {
    // Eight other sessions still fit the 4x48 strip a 44x48 region leaves…
    expect(growRegion(grid3x3, "a", { x: 0, y: 0, w: 44, h: 48 })).not.toBeNull();
    // …but nothing fits when the region takes the whole grid.
    expect(growRegion(grid3x3, "a", { x: 0, y: 0, w: 48, h: 48 })).toBeNull();
  });

  it("hands the whole grid to a lone session", () => {
    const solo: TileLayout = [{ sessionId: "a", x: 0, y: 0, w: 48, h: 48 }];
    expect(growRegion(solo, "a", { x: 0, y: 0, w: 48, h: 48 })).toEqual(solo);
    expect(growRegion(solo, "a", { x: 0, y: 0, w: 24, h: 48 })).toBeNull();
  });

  it("also shrinks: a smaller region gives the space back to the others", () => {
    const twoColumns: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 24, h: 48 },
      { sessionId: "b", x: 24, y: 0, w: 24, h: 48 },
    ];
    const next = growRegion(twoColumns, "a", { x: 0, y: 0, w: 12, h: 48 })!;

    expect(isValidLayout(next)).toBe(true);
    expect(tileOf(next, "a")).toMatchObject({ x: 0, y: 0, w: 12, h: 48 });
    expect(tileOf(next, "b")).toMatchObject({ x: 12, y: 0, w: 36, h: 48 });
  });

  it("works on the generated presets too", () => {
    const next = growRegion(threeByThree, "s1", { x: 0, y: 0, w: 48, h: 16 });
    if (next) expect(isValidLayout(next)).toBe(true);
  });
});
