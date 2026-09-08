// The terminal grid's layout model: a tiling of rectangles over a fixed square
// matrix of zones. Replaces the weighted column model — see
// projects/pavilio/plans/openspec/changes/terminal-grid-rect-layout/design.md.
//
// A zone is a coordinate, not a DOM element: nothing renders per zone except the
// drag overlay's hit regions. 12 is chosen because it divides by 2, 3, 4 and 6,
// so halves, thirds, quarters and sixths are exact on both axes and the curated
// presets need no rounding.
export const GRID = 12;

/** Half-open rectangle on the zone matrix: covers x..x+w-1 by y..y+h-1. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile extends Rect {
  sessionId: string;
}

/** A layout tiles the whole matrix: every zone covered exactly once. */
export type TileLayout = Tile[];

/**
 * The layout invariant, asserted in tests and used as the read-repair gate: every
 * zone of the matrix is covered by exactly one tile, each session appears at most
 * once, and no tile has a non-positive side or reaches outside the matrix.
 *
 * The empty layout is NOT valid — "no custom layout stored" is expressed by the
 * absence of a stored key, and a rendered layout always covers the grid. Callers
 * that hold zero sessions never reach this predicate.
 */
export function isValidLayout(layout: TileLayout): boolean {
  if (layout.length === 0) return false;

  const seen = new Set<string>();
  const covered = new Uint8Array(GRID * GRID);

  for (const tile of layout) {
    if (tile.w < 1 || tile.h < 1) return false;
    if (tile.x < 0 || tile.y < 0) return false;
    if (tile.x + tile.w > GRID || tile.y + tile.h > GRID) return false;
    if (seen.has(tile.sessionId)) return false;
    seen.add(tile.sessionId);

    for (let y = tile.y; y < tile.y + tile.h; y++) {
      for (let x = tile.x; x < tile.x + tile.w; x++) {
        const idx = y * GRID + x;
        if (covered[idx]) return false;
        covered[idx] = 1;
      }
    }
  }

  return covered.every((zone) => zone === 1);
}

/**
 * Where a span of `span` zones divides. The FIRST part is the smaller one on an
 * odd span (3 → 1 + 2), so the caller giving the dragged session the hovered part
 * hands it the larger half by taking the second part when it drops on the far side.
 */
export function splitPoint(span: number): number {
  return Math.floor(span / 2);
}

/** Tiles sorted top to bottom, then left to right — the order sessions map onto slots. */
export function readingOrder(layout: TileLayout): TileLayout {
  return [...layout].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
}
