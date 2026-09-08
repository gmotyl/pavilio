import { describe, it, expect } from "vitest";
import {
  GRID,
  expandPreset,
  getLayoutPresets,
  isValidLayout,
  readingOrder,
} from "../tileLayout";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);

describe("getLayoutPresets", () => {
  it("returns the curated shapes for counts 1 through 6", () => {
    expect(getLayoutPresets(1).map((p) => p.label)).toEqual(["1 terminal"]);
    expect(getLayoutPresets(2).map((p) => p.label)).toEqual(["2 columns", "2 rows"]);
    expect(getLayoutPresets(3).map((p) => p.label)).toEqual([
      "1 left, 2 stacked right",
      "3 columns",
      "3 rows",
      "2 stacked left, 1 right",
      "1 top, 2 below",
      "2 top, 1 bottom",
    ]);
    expect(getLayoutPresets(4).map((p) => p.label)).toEqual([
      "2 by 2",
      "4 columns",
      "1 left, 3 stacked right",
      "1 top, 3 below",
    ]);
    expect(getLayoutPresets(5).map((p) => p.label)).toEqual([
      "1 left, 4 right",
      "1 top, 4 below",
      "2 top, 3 bottom",
      "3 top, 2 bottom",
    ]);
    expect(getLayoutPresets(6).map((p) => p.label)).toEqual([
      "3 by 2",
      "2 by 3",
      "6 columns",
      "1 left, 5 right",
    ]);
  });

  it("offers three rows and three columns for three sessions", () => {
    const three = getLayoutPresets(3);
    const rows = three.find((p) => p.label === "3 rows")!;
    const columns = three.find((p) => p.label === "3 columns")!;

    expect(rows.slots).toEqual([
      { x: 0, y: 0, w: 12, h: 4 },
      { x: 0, y: 4, w: 12, h: 4 },
      { x: 0, y: 8, w: 12, h: 4 },
    ]);
    expect(columns.slots).toEqual([
      { x: 0, y: 0, w: 4, h: 12 },
      { x: 4, y: 0, w: 4, h: 12 },
      { x: 8, y: 0, w: 4, h: 12 },
    ]);
  });

  it("generates an even grid and a one-large-left shape for 7 and above", () => {
    expect(getLayoutPresets(7).map((p) => p.label)).toEqual([
      "Even grid",
      "1 large left, rest in two columns",
    ]);
    expect(getLayoutPresets(11).map((p) => p.label)).toEqual([
      "Even grid",
      "1 large left, rest in two columns",
    ]);
  });

  it("returns no presets for a count of zero", () => {
    expect(getLayoutPresets(0)).toEqual([]);
  });

  it("every preset for every count from 1 to 12 tiles the grid exactly", () => {
    for (let count = 1; count <= GRID; count++) {
      for (const preset of getLayoutPresets(count)) {
        const layout = expandPreset(ids(count), preset);
        expect(
          isValidLayout(layout),
          `${count} sessions, preset "${preset.label}"`,
        ).toBe(true);
        expect(layout).toHaveLength(count);
      }
    }
  });
});

describe("expandPreset", () => {
  it("assigns sessions to slots in reading order", () => {
    const preset = getLayoutPresets(3).find((p) => p.label === "1 top, 2 below")!;
    const layout = expandPreset(["a", "b", "c"], preset);

    expect(readingOrder(layout).map((t) => t.sessionId)).toEqual(["a", "b", "c"]);
    expect(layout.find((t) => t.sessionId === "a")).toEqual({
      sessionId: "a",
      x: 0,
      y: 0,
      w: 12,
      h: 6,
    });
  });

  it("ignores sessions beyond the preset's slot count", () => {
    const preset = getLayoutPresets(2)[0];
    expect(expandPreset(["a", "b", "c"], preset)).toHaveLength(2);
  });
});
