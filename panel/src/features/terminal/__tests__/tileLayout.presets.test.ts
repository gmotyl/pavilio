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

// The 12 -> 48 widening is a x4 rescale, so this is deliberately a literal: derive it
// from GRID and the assertions below stay true at any matrix size, pinning nothing.
const SCALE = 4;

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

// The curated 1-6 lists LEAD the result; generated shapes are appended after them,
// so these are prefix assertions rather than whole-list equality.
const leadingLabels = (count: number, take: number) =>
  getLayoutPresets(count)
    .slice(0, take)
    .map((p) => p.label);

// Dedup key: the preset's slots, which `preset()` already sorts into reading order.
const signature = (slots: { x: number; y: number; w: number; h: number }[]) =>
  slots.map((s) => `${s.x},${s.y},${s.w},${s.h}`).join(" ");

// How many curated (hand-written) entries lead each count's list.
const CURATED_COUNT: Record<number, number> = { 1: 1, 2: 2, 3: 6, 4: 4, 5: 4, 6: 4 };
const curatedLength = (count: number) => CURATED_COUNT[count] ?? 0;

describe("getLayoutPresets", () => {
  it("returns the curated shapes for counts 1 through 6", () => {
    expect(leadingLabels(1, 1)).toEqual(["1 terminal"]);
    expect(leadingLabels(2, 2)).toEqual(["2 columns", "2 rows"]);
    expect(leadingLabels(3, 6)).toEqual([
      "1 left, 2 stacked right",
      "3 columns",
      "3 rows",
      "2 stacked left, 1 right",
      "1 top, 2 below",
      "2 top, 1 bottom",
    ]);
    expect(leadingLabels(4, 4)).toEqual([
      "2 by 2",
      "4 columns",
      "1 left, 3 stacked right",
      "1 top, 3 below",
    ]);
    expect(leadingLabels(5, 4)).toEqual([
      "1 left, 4 right",
      "1 top, 4 below",
      "2 top, 3 bottom",
      "3 top, 2 bottom",
    ]);
    expect(leadingLabels(6, 4)).toEqual([
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
        getLayoutPresets(count)
          .slice(0, expected.length)
          .map((p) => ({ label: p.label, slots: p.slots })),
        `${count} sessions`,
      ).toEqual(expected);
    }
  });

  it("seven sessions are offered more than ten distinct shapes", () => {
    const seven = getLayoutPresets(7);

    expect(seven.length).toBeGreaterThan(10);
    expect(new Set(seven.map((p) => signature(p.slots))).size).toBe(seven.length);

    // Both even grids: one column-major, one row-major, and they differ at 7.
    const evenGrid = seven[0];
    const evenGridRows = seven.find((p) => p.label === "Even grid, rows first")!;
    expect(evenGrid.label).toBe("Even grid");
    expect(evenGridRows).toBeDefined();
    expect(signature(evenGridRows.slots)).not.toBe(signature(evenGrid.slots));

    // Plain strips.
    const isColumn = (p: (typeof seven)[number]) => p.slots.every((s) => s.h === GRID);
    const isRow = (p: (typeof seven)[number]) => p.slots.every((s) => s.w === GRID);
    expect(seven.some(isColumn)).toBe(true);
    expect(seven.some(isRow)).toBe(true);

    // A half-grid main in each of the four orientations.
    const hasMain = (rect: { x: number; y: number; w: number; h: number }) =>
      seven.some((p) => p.slots.some((s) => signature([s]) === signature([rect])));
    expect(hasMain({ x: 0, y: 0, w: GRID / 2, h: GRID })).toBe(true);
    expect(hasMain({ x: GRID / 2, y: 0, w: GRID / 2, h: GRID })).toBe(true);
    expect(hasMain({ x: 0, y: 0, w: GRID, h: GRID / 2 })).toBe(true);
    expect(hasMain({ x: 0, y: GRID / 2, w: GRID, h: GRID / 2 })).toBe(true);

    // A master with the rest in ONE strip: six equal rows down the right half.
    expect(
      seven.some(
        (p) =>
          p.slots.filter((s) => s.x === GRID / 2 && s.w === GRID / 2 && s.h === GRID / 6)
            .length === 6,
      ),
    ).toBe(true);

    // Both uneven two-row splits.
    expect(seven.map((p) => p.label)).toContain("4 top, 3 bottom");
    expect(seven.map((p) => p.label)).toContain("3 top, 4 bottom");
  });

  it("every generated preset tiles the grid at counts 2 through 16", () => {
    for (let count = 2; count <= 16; count++) {
      const generated = getLayoutPresets(count).slice(curatedLength(count));
      expect(generated.length, `${count} sessions offer no generated shape`).toBeGreaterThan(0);

      for (const preset of generated) {
        const layout = expandPreset(ids(count), preset);
        expect(
          isValidLayout(layout),
          `${count} sessions, generated preset "${preset.label}"`,
        ).toBe(true);
        expect(layout, `${count} sessions, generated preset "${preset.label}"`).toHaveLength(
          count,
        );
      }
    }
  });

  it("no generated preset slot falls below MIN_SPAN", () => {
    for (let count = 1; count <= 16; count++) {
      for (const preset of getLayoutPresets(count).slice(curatedLength(count))) {
        for (const slot of preset.slots) {
          expect(
            Math.min(slot.w, slot.h),
            `${count} sessions, generated preset "${preset.label}"`,
          ).toBeGreaterThanOrEqual(MIN_SPAN);
        }
      }
    }
  });

  it("coinciding generators collapse to one entry", () => {
    // At 4, both even grids AND both two-row splits all produce the same 2x2.
    const four = getLayoutPresets(4);
    expect(four.length).toBeGreaterThan(curatedLength(4));

    const twoByTwo = signature([
      { x: 0, y: 0, w: GRID / 2, h: GRID / 2 },
      { x: GRID / 2, y: 0, w: GRID / 2, h: GRID / 2 },
      { x: 0, y: GRID / 2, w: GRID / 2, h: GRID / 2 },
      { x: GRID / 2, y: GRID / 2, w: GRID / 2, h: GRID / 2 },
    ]);
    expect(four.filter((p) => signature(p.slots) === twoByTwo)).toHaveLength(1);

    for (let count = 1; count <= 16; count++) {
      const presets = getLayoutPresets(count);
      const shapes = presets.map((p) => signature(p.slots));
      expect(new Set(shapes).size, `${count} sessions repeat a shape`).toBe(shapes.length);

      // Labels are the menu's React keys, so they must be unique too.
      const labels = presets.map((p) => p.label);
      expect(new Set(labels).size, `${count} sessions repeat a label`).toBe(labels.length);
    }
  });

  it("counts one to six keep their existing default as the first option", () => {
    for (let count = 1; count <= 6; count++) {
      const [first] = getLayoutPresets(count);
      const expected = SHAPES_AT_12[count][0];

      expect(first.label, `${count} sessions`).toBe(expected.label);
      expect(signature(first.slots), `${count} sessions`).toBe(
        signature(
          expected.slots.map(([x, y, w, h]) => ({
            x: x * SCALE,
            y: y * SCALE,
            w: w * SCALE,
            h: h * SCALE,
          })),
        ),
      );
    }
  });

  it("the even grid leads the list from seven sessions up", () => {
    for (let count = 7; count <= 16; count++) {
      const [first] = getLayoutPresets(count);
      expect(first.label, `${count} sessions`).toBe("Even grid");

      // ...and it is genuinely the column-major sqrt grid, not just so labelled.
      const cols = Math.ceil(Math.sqrt(count));
      expect(new Set(first.slots.map((s) => s.x)).size, `${count} sessions`).toBe(cols);
    }
  });

  it("a generator that cannot honour MIN_SPAN contributes nothing", () => {
    const fullHeightStrips = (count: number) =>
      getLayoutPresets(count).filter(
        (p) => p.slots.length === count && p.slots.every((s) => s.h === GRID),
      );

    // 12 columns of 4 zones each is exactly MIN_SPAN, so it is still offered.
    expect(fullHeightStrips(12)).toHaveLength(1);
    // 13 would need 3-zone slivers, so the `columns` generator drops out entirely.
    expect(fullHeightStrips(13)).toHaveLength(0);

    // And the rest of the family at 13 is still usable, not merely absent.
    const thirteen = getLayoutPresets(13);
    expect(thirteen.length).toBeGreaterThan(0);
    for (const preset of thirteen) {
      for (const slot of preset.slots) {
        expect(Math.min(slot.w, slot.h), `preset "${preset.label}"`).toBeGreaterThanOrEqual(
          MIN_SPAN,
        );
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
      w: GRID,
      h: GRID / 2,
    });
  });

  it("ignores sessions beyond the preset's slot count", () => {
    const preset = getLayoutPresets(2)[0];
    expect(expandPreset(["a", "b", "c"], preset)).toHaveLength(2);
  });
});
