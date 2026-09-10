import { describe, it, expect } from "vitest";
import {
  GRID,
  MIN_SPAN,
  expandPreset,
  getLayoutPresets,
  isValidLayout,
  readingOrder,
} from "../tileLayout";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);

// How much finer the matrix is than the 12 zones the curated shapes were authored on.
const SCALE = GRID / 12;

// Every slot the curated presets produced when the matrix was 12x12, as [x, y, w, h]
// in reading order. Multiplied by SCALE these must still be exactly what
// getLayoutPresets returns: widening the matrix is a change of unit, not of shape.
const SHAPES_AT_12: Record<number, { label: string; slots: number[][] }[]> = {
  1: [{ label: "1 terminal", slots: [[0, 0, 12, 12]] }],
  2: [
    { label: "2 columns", slots: [[0, 0, 6, 12], [6, 0, 6, 12]] },
    { label: "2 rows", slots: [[0, 0, 12, 6], [0, 6, 12, 6]] },
  ],
  3: [
    { label: "1 left, 2 stacked right", slots: [[0, 0, 6, 12], [6, 0, 6, 6], [6, 6, 6, 6]] },
    { label: "3 columns", slots: [[0, 0, 4, 12], [4, 0, 4, 12], [8, 0, 4, 12]] },
    { label: "3 rows", slots: [[0, 0, 12, 4], [0, 4, 12, 4], [0, 8, 12, 4]] },
    { label: "2 stacked left, 1 right", slots: [[0, 0, 6, 6], [6, 0, 6, 12], [0, 6, 6, 6]] },
    { label: "1 top, 2 below", slots: [[0, 0, 12, 6], [0, 6, 6, 6], [6, 6, 6, 6]] },
    { label: "2 top, 1 bottom", slots: [[0, 0, 6, 6], [6, 0, 6, 6], [0, 6, 12, 6]] },
  ],
  4: [
    { label: "2 by 2", slots: [[0, 0, 6, 6], [6, 0, 6, 6], [0, 6, 6, 6], [6, 6, 6, 6]] },
    { label: "4 columns", slots: [[0, 0, 3, 12], [3, 0, 3, 12], [6, 0, 3, 12], [9, 0, 3, 12]] },
    {
      label: "1 left, 3 stacked right",
      slots: [[0, 0, 6, 12], [6, 0, 6, 4], [6, 4, 6, 4], [6, 8, 6, 4]],
    },
    { label: "1 top, 3 below", slots: [[0, 0, 12, 6], [0, 6, 4, 6], [4, 6, 4, 6], [8, 6, 4, 6]] },
  ],
  5: [
    {
      label: "1 left, 4 right",
      slots: [[0, 0, 6, 12], [6, 0, 3, 6], [9, 0, 3, 6], [6, 6, 3, 6], [9, 6, 3, 6]],
    },
    {
      label: "1 top, 4 below",
      slots: [[0, 0, 12, 6], [0, 6, 3, 6], [3, 6, 3, 6], [6, 6, 3, 6], [9, 6, 3, 6]],
    },
    {
      label: "2 top, 3 bottom",
      slots: [[0, 0, 6, 6], [6, 0, 6, 6], [0, 6, 4, 6], [4, 6, 4, 6], [8, 6, 4, 6]],
    },
    {
      label: "3 top, 2 bottom",
      slots: [[0, 0, 4, 6], [4, 0, 4, 6], [8, 0, 4, 6], [0, 6, 6, 6], [6, 6, 6, 6]],
    },
  ],
  6: [
    {
      label: "3 by 2",
      slots: [[0, 0, 4, 6], [4, 0, 4, 6], [8, 0, 4, 6], [0, 6, 4, 6], [4, 6, 4, 6], [8, 6, 4, 6]],
    },
    {
      label: "2 by 3",
      slots: [[0, 0, 6, 4], [6, 0, 6, 4], [0, 4, 6, 4], [6, 4, 6, 4], [0, 8, 6, 4], [6, 8, 6, 4]],
    },
    {
      label: "6 columns",
      slots: [
        [0, 0, 2, 12],
        [2, 0, 2, 12],
        [4, 0, 2, 12],
        [6, 0, 2, 12],
        [8, 0, 2, 12],
        [10, 0, 2, 12],
      ],
    },
    {
      label: "1 left, 5 right",
      slots: [[0, 0, 6, 12], [6, 0, 3, 6], [9, 0, 3, 6], [6, 6, 2, 6], [8, 6, 2, 6], [10, 6, 2, 6]],
    },
  ],
};

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

    const third = GRID / 3;
    expect(rows.slots).toEqual([
      { x: 0, y: 0, w: GRID, h: third },
      { x: 0, y: third, w: GRID, h: third },
      { x: 0, y: third * 2, w: GRID, h: third },
    ]);
    expect(columns.slots).toEqual([
      { x: 0, y: 0, w: third, h: GRID },
      { x: third, y: 0, w: third, h: GRID },
      { x: third * 2, y: 0, w: third, h: GRID },
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

  it("every preset at counts 1 through 16 tiles the 48-zone matrix", () => {
    expect(GRID).toBe(48);

    for (let count = 1; count <= 16; count++) {
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

  it("no preset slot is narrower or shorter than MIN_SPAN", () => {
    for (let count = 1; count <= 16; count++) {
      for (const preset of getLayoutPresets(count)) {
        for (const slot of preset.slots) {
          expect(
            Math.min(slot.w, slot.h),
            `${count} sessions, preset "${preset.label}"`,
          ).toBeGreaterThanOrEqual(MIN_SPAN);
        }
      }
    }
  });

  it("presets for 1 to 6 sessions keep the exact shapes they had at 12 zones", () => {
    for (let count = 1; count <= 6; count++) {
      const expected = SHAPES_AT_12[count].map((shape) => ({
        label: shape.label,
        slots: shape.slots.map(([x, y, w, h]) => ({
          x: x * SCALE,
          y: y * SCALE,
          w: w * SCALE,
          h: h * SCALE,
        })),
      }));

      expect(
        getLayoutPresets(count).map((p) => ({ label: p.label, slots: p.slots })),
        `${count} sessions`,
      ).toEqual(expected);
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
      w: GRID,
      h: GRID / 2,
    });
  });

  it("ignores sessions beyond the preset's slot count", () => {
    const preset = getLayoutPresets(2)[0];
    expect(expandPreset(["a", "b", "c"], preset)).toHaveLength(2);
  });
});
