import { describe, it, expect } from "vitest";
import {
  GRID,
  MIN_SPAN,
  isValidLayout,
  readingOrder,
  type TileLayout,
} from "../tileLayout";
import { seamsOf, resizeSeam, type Seam } from "../seamResize";

const HALF = GRID / 2;
const THIRD = GRID / 4; // a quarter of the grid, the "left third" of the bottom row

// The four-tile example from design §3.1: two vertical boundaries sit on the same
// line only in the sense of "both are vertical" — they are at different coordinates
// and cover different stretches.
//
//         0       24        48
//     0   +--------+---------+
//         |   A    |    D    |
//    24   +---+----+---------+
//         | B |        C     |
//    48   +---+--------------+
const twoBoundaries: TileLayout = [
  { sessionId: "a", x: 0, y: 0, w: HALF, h: HALF },
  { sessionId: "d", x: HALF, y: 0, w: HALF, h: HALF },
  { sessionId: "b", x: 0, y: HALF, w: THIRD, h: HALF },
  { sessionId: "c", x: THIRD, y: HALF, w: GRID - THIRD, h: HALF },
];

// One full-height tile on the left, two stacked on the right.
const sharedSeam: TileLayout = [
  { sessionId: "l", x: 0, y: 0, w: HALF, h: GRID },
  { sessionId: "rt", x: HALF, y: 0, w: HALF, h: HALF },
  { sessionId: "rb", x: HALF, y: HALF, w: HALF, h: HALF },
];

const single: TileLayout = [{ sessionId: "a", x: 0, y: 0, w: GRID, h: GRID }];

const verticalSeams = (layout: TileLayout) =>
  seamsOf(layout).filter((seam) => seam.axis === "x");

const find = (layout: TileLayout, sessionId: string) =>
  layout.find((tile) => tile.sessionId === sessionId)!;

describe("seamsOf", () => {
  it("two boundaries on one line are enumerated as two separate seams", () => {
    const seams = verticalSeams(twoBoundaries);

    expect(seams).toHaveLength(2);
    expect(seams).toContainEqual({
      axis: "x",
      at: HALF,
      from: 0,
      to: HALF,
      before: ["a"],
      after: ["d"],
    });
    expect(seams).toContainEqual({
      axis: "x",
      at: THIRD,
      from: HALF,
      to: GRID,
      before: ["b"],
      after: ["c"],
    });
  });

  it("a seam faced by two tiles carries both of them in after", () => {
    const seams = verticalSeams(sharedSeam);

    expect(seams).toEqual([
      {
        axis: "x",
        at: HALF,
        from: 0,
        to: GRID,
        before: ["l"],
        after: ["rt", "rb"],
      },
    ]);
  });

  it("no seam is emitted where a tile straddles the coordinate", () => {
    // `a` covers x = THIRD over the top half, so the bottom boundary at THIRD
    // yields a seam over the bottom rows only.
    const atThird = verticalSeams(twoBoundaries).filter(
      (seam) => seam.at === THIRD,
    );

    expect(atThird).toHaveLength(1);
    expect(atThird[0].from).toBe(HALF);
    expect(atThird[0].to).toBe(GRID);
  });

  it("a single-tile layout has no seams", () => {
    expect(seamsOf(single)).toEqual([]);
  });
});

describe("resizeSeam", () => {
  const topSeam = (): Seam =>
    verticalSeams(twoBoundaries).find((seam) => seam.at === HALF)!;

  it("moving a seam leaves every unrelated tile untouched", () => {
    const next = resizeSeam(twoBoundaries, topSeam(), 4)!;

    expect(next).not.toBeNull();
    expect(find(next, "b")).toEqual(find(twoBoundaries, "b"));
    expect(find(next, "c")).toEqual(find(twoBoundaries, "c"));
    expect(find(next, "a")).toEqual({
      sessionId: "a",
      x: 0,
      y: 0,
      w: HALF + 4,
      h: HALF,
    });
    expect(find(next, "d")).toEqual({
      sessionId: "d",
      x: HALF + 4,
      y: 0,
      w: HALF - 4,
      h: HALF,
    });
  });

  it("a moved seam still tiles the grid", () => {
    for (const delta of [-8, -1, 1, 8, 60]) {
      const next = resizeSeam(twoBoundaries, topSeam(), delta);
      if (next) expect(isValidLayout(next)).toBe(true);
    }

    const shared = seamsOf(sharedSeam)[0];
    for (const delta of [-20, 20]) {
      const next = resizeSeam(sharedSeam, shared, delta);
      expect(next).not.toBeNull();
      expect(isValidLayout(next!)).toBe(true);
    }
  });

  it("a delta is clamped so no tile falls below MIN_SPAN", () => {
    const bottom = verticalSeams(twoBoundaries).find(
      (seam) => seam.at === THIRD,
    )!;

    // `b` is THIRD wide, so the largest leftward move is THIRD - MIN_SPAN.
    const shrunk = resizeSeam(twoBoundaries, bottom, -GRID)!;
    expect(find(shrunk, "b").w).toBe(MIN_SPAN);
    expect(find(shrunk, "c")).toEqual({
      sessionId: "c",
      x: MIN_SPAN,
      y: HALF,
      w: GRID - MIN_SPAN,
      h: HALF,
    });

    // `c` is GRID - THIRD wide, so the largest rightward move leaves it MIN_SPAN.
    const grown = resizeSeam(twoBoundaries, bottom, GRID)!;
    expect(find(grown, "c").w).toBe(MIN_SPAN);
    expect(find(grown, "b").w).toBe(GRID - MIN_SPAN);
    expect(isValidLayout(grown)).toBe(true);
  });

  it("a seam with no room to move returns null", () => {
    const tight: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: MIN_SPAN, h: GRID },
      { sessionId: "b", x: MIN_SPAN, y: 0, w: GRID - MIN_SPAN, h: GRID },
    ];
    const seam = seamsOf(tight)[0];
    expect(seam).toMatchObject({ axis: "x", at: MIN_SPAN });

    expect(resizeSeam(tight, seam, -1)).toBeNull();
    expect(resizeSeam(tight, seam, -GRID)).toBeNull();
    expect(resizeSeam(tight, seam, 0)).toBeNull();
  });

  it("moving a seam never changes reading order", () => {
    const ids = (layout: TileLayout) =>
      readingOrder(layout).map((tile) => tile.sessionId);

    const seams = seamsOf(twoBoundaries);
    expect(seams).toHaveLength(3);

    let moves = 0;
    for (const seam of seams) {
      for (const delta of [-6, -1, 1, 6]) {
        const next = resizeSeam(twoBoundaries, seam, delta);
        if (!next) continue;
        moves++;
        expect(ids(next)).toEqual(ids(twoBoundaries));
      }
    }
    expect(moves).toBe(seams.length * 4);
  });

  it("horizontal seams move on the other axis", () => {
    const horizontal = seamsOf(twoBoundaries).filter(
      (seam) => seam.axis === "y",
    );

    expect(horizontal).toEqual([
      {
        axis: "y",
        at: HALF,
        from: 0,
        to: GRID,
        before: ["a", "d"],
        after: ["b", "c"],
      },
    ]);

    const next = resizeSeam(twoBoundaries, horizontal[0], 4)!;
    expect(isValidLayout(next)).toBe(true);
    expect(find(next, "a").h).toBe(HALF + 4);
    expect(find(next, "d").h).toBe(HALF + 4);
    expect(find(next, "b")).toEqual({
      sessionId: "b",
      x: 0,
      y: HALF + 4,
      w: THIRD,
      h: HALF - 4,
    });
    expect(find(next, "c")).toEqual({
      sessionId: "c",
      x: THIRD,
      y: HALF + 4,
      w: GRID - THIRD,
      h: HALF - 4,
    });
  });
});
