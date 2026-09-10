// Seam enumeration and the seam move: the whole correctness argument for the
// resize gesture, in a module with no React and no DOM. See
// projects/pavilio/adr/0008-terminal-grid-seam-resize-on-a-finer-matrix.md and
// the design's §3.
//
// A seam is a SEGMENT of a boundary, not a whole grid line: the vertical line at
// x = 24 may carry one seam over the top rows and none at all over the bottom
// ones, because a tile straddles the coordinate down there.

import { GRID, MIN_SPAN, isValidLayout, type Tile, type TileLayout } from "./tileLayout";

export interface Seam {
  /** "x" = a vertical boundary, moved horizontally. */
  axis: "x" | "y";
  /** The zone coordinate the boundary sits on, 1..GRID-1. */
  at: number;
  /** Start of the segment on the other axis. */
  from: number;
  /** End of the segment on the other axis, exclusive. */
  to: number;
  /** Sessions whose tile ENDS at `at`. */
  before: string[];
  /** Sessions whose tile STARTS at `at`. */
  after: string[];
}

// Owner of every zone, by index into `layout`. -1 where nothing covers it, which a
// valid layout never leaves behind but an unvalidated one might.
function ownerGrid(layout: TileLayout): Int32Array {
  const owner = new Int32Array(GRID * GRID).fill(-1);
  layout.forEach((tile, index) => {
    for (let y = tile.y; y < tile.y + tile.h; y++) {
      for (let x = tile.x; x < tile.x + tile.w; x++) {
        if (y >= 0 && y < GRID && x >= 0 && x < GRID) owner[y * GRID + x] = index;
      }
    }
  });
  return owner;
}

// Distinct session ids in the order they first appear along the run.
function idsAlong(layout: TileLayout, owners: number[]): string[] {
  const out: string[] = [];
  const seen = new Set<number>();
  for (const index of owners) {
    if (index < 0 || seen.has(index)) continue;
    seen.add(index);
    out.push(layout[index].sessionId);
  }
  return out;
}

/**
 * Every seam segment in the layout, both axes.
 *
 * A cross-line position is seam-able when the zones either side of `at` belong to
 * DIFFERENT tiles; one seam is emitted per maximal run of seam-able positions. That
 * needs no further validity check: a tile ending at `at` cannot cover `at`, and the
 * tile that does cover `at` cannot cover `at-1` either, so every position of a tile
 * that touches the boundary is marked — a maximal run is therefore always a union of
 * whole tiles on both sides, and no tile can straddle a run's edge.
 *
 * Vertical seams come first, each axis ordered by `at` and then by segment start.
 */
export function seamsOf(layout: TileLayout): Seam[] {
  const owner = ownerGrid(layout);
  const seams: Seam[] = [];

  // `axis` names the axis the boundary MOVES on: "x" walks columns and marks rows.
  for (const axis of ["x", "y"] as const) {
    // Zone index for a position `along` the segment at cross-coordinate `cross`.
    const zone = (cross: number, along: number) =>
      axis === "x" ? along * GRID + cross : cross * GRID + along;

    for (let at = 1; at < GRID; at++) {
      let runStart = -1;

      // One past the end, so a run reaching the far edge is closed by the same code.
      for (let along = 0; along <= GRID; along++) {
        const marked =
          along < GRID && owner[zone(at - 1, along)] !== owner[zone(at, along)];

        if (marked && runStart < 0) runStart = along;
        if (marked || runStart < 0) continue;

        const span = Array.from({ length: along - runStart }, (_, i) => runStart + i);
        seams.push({
          axis,
          at,
          from: runStart,
          to: along,
          before: idsAlong(layout, span.map((i) => owner[zone(at - 1, i)])),
          after: idsAlong(layout, span.map((i) => owner[zone(at, i)])),
        });
        runStart = -1;
      }
    }
  }

  return seams;
}

/**
 * Moves one seam by `delta` zones: `before` tiles grow, `after` tiles give up the
 * same amount from their leading edge. Clamped so no participating tile falls below
 * MIN_SPAN. Returns null when the clamp leaves nothing to move.
 *
 * Rectangles survive by construction and coverage survives because both sides move
 * by the same amount, so no tile outside `before` and `after` is touched at all —
 * that is what makes this a resize rather than a placement. `isValidLayout` on the
 * result is a defensive net, not the mechanism.
 *
 * What this does NOT promise is reading order. `readingOrder` sorts y-major, and a
 * horizontal seam move rewrites y — the primary key — so the `after` tiles can be
 * carried past tiles in other rows and come back renumbered. The result is still a
 * valid tiling, so `isValidLayout` neither catches it nor could. A vertical move is
 * safe (every `after` tile shares x === at, and y is untouched), but the general
 * guarantee belongs to the CALLER: a seam drag is a resize, not a reordering event,
 * so the commit path must carry the session order it already had rather than
 * re-derive it with `readingOrder` on the result. See the tests for the worked
 * counterexample.
 */
export function resizeSeam(
  layout: TileLayout,
  seam: Seam,
  delta: number,
): TileLayout | null {
  const before = new Set(seam.before);
  const after = new Set(seam.after);
  const spanOf = (tile: Tile) => (seam.axis === "x" ? tile.w : tile.h);

  const beforeTiles = layout.filter((tile) => before.has(tile.sessionId));
  const afterTiles = layout.filter((tile) => after.has(tile.sessionId));
  if (beforeTiles.length !== before.size || afterTiles.length !== after.size) return null;
  if (beforeTiles.length === 0 || afterTiles.length === 0) return null;

  // A positive delta shrinks the `after` tiles, a negative one the `before` tiles.
  const room = (tiles: Tile[]) =>
    Math.max(0, Math.min(...tiles.map((tile) => spanOf(tile) - MIN_SPAN)));
  const moved = Math.max(-room(beforeTiles), Math.min(room(afterTiles), delta));
  if (moved === 0) return null;

  const next = layout.map((tile) => {
    if (before.has(tile.sessionId)) {
      return seam.axis === "x"
        ? { ...tile, w: tile.w + moved }
        : { ...tile, h: tile.h + moved };
    }
    if (after.has(tile.sessionId)) {
      return seam.axis === "x"
        ? { ...tile, x: tile.x + moved, w: tile.w - moved }
        : { ...tile, y: tile.y + moved, h: tile.h - moved };
    }
    // Untouched tiles keep their identity: a resize re-tiles nothing.
    return tile;
  });

  return isValidLayout(next) ? next : null;
}
