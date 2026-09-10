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

// Rows whose tiles do not line up: the seam at HALF is faced by two tiles on each
// side, and no two of those four have the same width. Serves two purposes — a
// vertical move here could cross reading order if crossing were possible at all,
// and the clamp has an unequal pair to pick the tightest span from.
//
//         0   12   24        48
//     0   +---+---+----------+
//         | a | b |     c    |
//    24   +---+---+-----+----+
//         |   d   |  e  | f  |
//    48   +-------+-----+----+
const staggered: TileLayout = [
  { sessionId: "a", x: 0, y: 0, w: THIRD, h: HALF },
  { sessionId: "b", x: THIRD, y: 0, w: THIRD, h: HALF },
  { sessionId: "c", x: HALF, y: 0, w: HALF, h: HALF },
  { sessionId: "d", x: 0, y: HALF, w: HALF, h: HALF },
  { sessionId: "e", x: HALF, y: HALF, w: THIRD, h: HALF },
  { sessionId: "f", x: GRID - THIRD, y: HALF, w: THIRD, h: HALF },
];

// The horizontal counterexample: `b` is the only tile below the seam at THIRD, so
// growing `a` pushes `b` past `d`'s row without touching `c` or `d`.
//
//         0        24        48
//     0   +---------+---------+
//         |    a    |         |
//    12   +---------+    c    |
//         |         |         |
//    24   |    b    +---------+
//         |         |    d    |
//    48   +---------+---------+
const crossing: TileLayout = [
  { sessionId: "a", x: 0, y: 0, w: HALF, h: THIRD },
  { sessionId: "b", x: 0, y: THIRD, w: HALF, h: GRID - THIRD },
  { sessionId: "c", x: HALF, y: 0, w: HALF, h: HALF },
  { sessionId: "d", x: HALF, y: HALF, w: HALF, h: HALF },
];

const verticalSeams = (layout: TileLayout) =>
  seamsOf(layout).filter((seam) => seam.axis === "x");

const find = (layout: TileLayout, sessionId: string) =>
  layout.find((tile) => tile.sessionId === sessionId)!;

const ids = (layout: TileLayout) =>
  readingOrder(layout).map((tile) => tile.sessionId);

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

  it("a single-tile layout has no seams, but splitting it yields one", () => {
    // The empty result has to be the layout's doing, not the function's: a stub
    // returning [] would satisfy the first assertion and fail the second.
    expect(seamsOf(single)).toEqual([]);

    const split: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: HALF, h: GRID },
      { sessionId: "b", x: HALF, y: 0, w: HALF, h: GRID },
    ];
    expect(seamsOf(split)).toEqual([
      { axis: "x", at: HALF, from: 0, to: GRID, before: ["a"], after: ["b"] },
    ]);
  });
});

describe("resizeSeam", () => {
  const topSeam = (): Seam =>
    verticalSeams(twoBoundaries).find((seam) => seam.at === HALF)!;

  it("moving a seam leaves every unrelated tile untouched", () => {
    const next = resizeSeam(twoBoundaries, topSeam(), 4)!;

    expect(next).not.toBeNull();
    // Byte-identical, not merely equal: an untouched tile is the same object, so a
    // caller diffing by reference sees no change at all.
    expect(find(next, "b")).toBe(find(twoBoundaries, "b"));
    expect(find(next, "c")).toBe(find(twoBoundaries, "c"));
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

  it("the clamp sizes to the tightest tile on the shrinking side", () => {
    // Both sides of `staggered`'s middle seam carry two tiles of different widths.
    // MIN_SPAN has to hold for EVERY participating tile, so the room to move is the
    // smallest tile's slack — and `isValidLayout` would not notice if it were not,
    // since it never checks MIN_SPAN.
    const seam = seamsOf(staggered).find(
      (candidate) => candidate.axis === "x" && candidate.at === HALF,
    )!;
    expect(seam).toMatchObject({ before: ["b", "d"], after: ["c", "e"] });

    // Shrinking `after`: `e` is THIRD wide and `c` is HALF, so THIRD - MIN_SPAN is
    // all the room there is, and `c` is left with slack to spare.
    const grown = resizeSeam(staggered, seam, GRID)!;
    expect(find(grown, "e").w).toBe(MIN_SPAN);
    expect(find(grown, "c").w).toBe(HALF - (THIRD - MIN_SPAN));
    expect(find(grown, "c").w).toBeGreaterThan(MIN_SPAN);
    expect(find(grown, "b").w).toBe(THIRD + (THIRD - MIN_SPAN));
    expect(isValidLayout(grown)).toBe(true);

    // Shrinking `before`: same story with `b` as the tightest tile.
    const shrunk = resizeSeam(staggered, seam, -GRID)!;
    expect(find(shrunk, "b").w).toBe(MIN_SPAN);
    expect(find(shrunk, "d").w).toBe(HALF - (THIRD - MIN_SPAN));
    expect(find(shrunk, "d").w).toBeGreaterThan(MIN_SPAN);
    expect(isValidLayout(shrunk)).toBe(true);
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

  it("a vertical seam move never changes reading order", () => {
    // Provable, not incidental: every `after` tile shares x === at, so a vertical
    // move rewrites x only, leaves every y alone, and cannot push a tile out of its
    // row. `staggered` gives the property something to break on — the seam at HALF
    // is shared by two rows, and each row has a neighbour the moved tile would have
    // to cross if crossing were possible.
    const seams = verticalSeams(staggered);
    let moves = 0;
    for (const seam of seams) {
      for (const delta of [-8, -1, 1, 8, GRID, -GRID]) {
        const next = resizeSeam(staggered, seam, delta);
        if (!next) continue;
        moves++;
        expect(ids(next)).toEqual(ids(staggered));
      }
    }
    expect(moves).toBe(seams.length * 6);
  });

  it("a horizontal seam move can change reading order, so callers must not re-derive it", () => {
    // Reading order is y-major, and a horizontal move rewrites y — the primary sort
    // key. Here growing `a` carries `b` below `d`, and the result is a perfectly
    // valid tiling, so `isValidLayout` does not and cannot catch it. Preserving the
    // session order across a seam drag is therefore the commit path's job: it must
    // carry the order it already had rather than call `readingOrder` on the result.
    const seam = seamsOf(crossing).find(
      (candidate) => candidate.axis === "y" && candidate.at === THIRD,
    )!;
    expect(seam).toMatchObject({ before: ["a"], after: ["b"] });

    const next = resizeSeam(crossing, seam, HALF)!;

    expect(find(next, "a")).toEqual({
      sessionId: "a",
      x: 0,
      y: 0,
      w: HALF,
      h: GRID - THIRD,
    });
    expect(find(next, "b")).toEqual({
      sessionId: "b",
      x: 0,
      y: GRID - THIRD,
      w: HALF,
      h: THIRD,
    });
    expect(isValidLayout(next)).toBe(true);

    expect(ids(crossing)).toEqual(["a", "c", "b", "d"]);
    expect(ids(next)).toEqual(["a", "c", "d", "b"]);
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
