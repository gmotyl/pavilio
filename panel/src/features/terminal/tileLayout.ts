// The terminal grid's layout model: a tiling of rectangles over a fixed square
// matrix of zones. Replaces the weighted column model — see
// projects/pavilio/plans/openspec/changes/terminal-grid-rect-layout/design.md.
//
// A zone is a coordinate, not a DOM element: nothing renders per zone except the
// drag overlay's hit regions. 48 = 2^4 * 3, so halves, thirds, quarters, sixths,
// eighths, twelfths and sixteenths are all exact on both axes and the curated
// presets need no rounding. It is four times the 12 the model started on, which is
// what lets a dragged seam move in 2.08% steps rather than 8.3% ones — see
// projects/pavilio/adr/0008-terminal-grid-seam-resize-on-a-finer-matrix.md.
export const GRID = 48;

/** Smallest span a terminal may be reduced to on either axis, in zones (8.3%). */
export const MIN_SPAN = 4;

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

/** A preset shape: rectangles without sessions, filled from the session order. */
export interface LayoutPreset {
  /** Accessible name and tooltip — describes the shape, e.g. "3 rows". */
  label: string;
  /** Slots in reading order. */
  slots: Rect[];
}

// Splits `total` zones into `parts` spans, remainder going to the earliest ones —
// so 48 into 5 is 10,10,10,9,9 and every span stays >= 1 as long as parts <= total.
function evenSpans(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

// Lays `parts` slots side by side across `rect`, either as columns or as rows.
function strips(rect: Rect, parts: number, axis: "x" | "y"): Rect[] {
  const spans = evenSpans(axis === "x" ? rect.w : rect.h, parts);
  const out: Rect[] = [];
  let offset = axis === "x" ? rect.x : rect.y;
  for (const span of spans) {
    out.push(
      axis === "x"
        ? { x: offset, y: rect.y, w: span, h: rect.h }
        : { x: rect.x, y: offset, w: rect.w, h: span },
    );
    offset += span;
  }
  return out;
}

const whole: Rect = { x: 0, y: 0, w: GRID, h: GRID };
const leftHalf: Rect = { x: 0, y: 0, w: GRID / 2, h: GRID };
const rightHalf: Rect = { x: GRID / 2, y: 0, w: GRID / 2, h: GRID };
const topHalf: Rect = { x: 0, y: 0, w: GRID, h: GRID / 2 };
const bottomHalf: Rect = { x: 0, y: GRID / 2, w: GRID, h: GRID / 2 };

function preset(label: string, slots: Rect[]): LayoutPreset {
  return { label, slots: slots.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y)) };
}

// A grid of `cols` columns; the sessions are spread column-major, remainder to the
// earliest columns — the shape the 7+ default has always had.
function evenGrid(count: number): Rect[] {
  const cols = Math.min(Math.ceil(Math.sqrt(count)), GRID);
  const perColumn = evenSpans(count, cols);
  const widths = strips(whole, cols, "x");
  return widths.flatMap((column, i) => strips(column, perColumn[i], "y"));
}

// One full-height slot on the left, the rest split down two narrower columns.
function oneLargeLeft(count: number): Rect[] {
  const rest = count - 1;
  const [left, ...columns] = [leftHalf, ...strips(rightHalf, 2, "x")];
  const perColumn = evenSpans(rest, 2);
  return [left, ...columns.flatMap((column, i) => strips(column, perColumn[i], "y"))];
}

/**
 * The curated shapes for 1-6 sessions and the generated pair for 7+. The FIRST entry
 * of each row is that count's default: for 1-4 and 6 it reproduces the shape the
 * column model defaulted to, so the familiar arrangement survives the model change.
 */
export function getLayoutPresets(count: number): LayoutPreset[] {
  if (count <= 0) return [];

  if (count === 1) return [preset("1 terminal", [whole])];

  if (count === 2) {
    return [
      preset("2 columns", [leftHalf, rightHalf]),
      preset("2 rows", [topHalf, bottomHalf]),
    ];
  }

  if (count === 3) {
    return [
      preset("1 left, 2 stacked right", [leftHalf, ...strips(rightHalf, 2, "y")]),
      preset("3 columns", strips(whole, 3, "x")),
      preset("3 rows", strips(whole, 3, "y")),
      preset("2 stacked left, 1 right", [...strips(leftHalf, 2, "y"), rightHalf]),
      preset("1 top, 2 below", [topHalf, ...strips(bottomHalf, 2, "x")]),
      preset("2 top, 1 bottom", [...strips(topHalf, 2, "x"), bottomHalf]),
    ];
  }

  if (count === 4) {
    return [
      preset("2 by 2", [
        ...strips(topHalf, 2, "x"),
        ...strips(bottomHalf, 2, "x"),
      ]),
      preset("4 columns", strips(whole, 4, "x")),
      preset("1 left, 3 stacked right", [leftHalf, ...strips(rightHalf, 3, "y")]),
      preset("1 top, 3 below", [topHalf, ...strips(bottomHalf, 3, "x")]),
    ];
  }

  if (count === 5) {
    const [rightTop, rightBottom] = strips(rightHalf, 2, "y");
    return [
      preset("1 left, 4 right", [
        leftHalf,
        ...strips(rightTop, 2, "x"),
        ...strips(rightBottom, 2, "x"),
      ]),
      preset("1 top, 4 below", [topHalf, ...strips(bottomHalf, 4, "x")]),
      preset("2 top, 3 bottom", [
        ...strips(topHalf, 2, "x"),
        ...strips(bottomHalf, 3, "x"),
      ]),
      preset("3 top, 2 bottom", [
        ...strips(topHalf, 3, "x"),
        ...strips(bottomHalf, 2, "x"),
      ]),
    ];
  }

  if (count === 6) {
    const [rightTop, rightBottom] = strips(rightHalf, 2, "y");
    return [
      preset("3 by 2", [
        ...strips(topHalf, 3, "x"),
        ...strips(bottomHalf, 3, "x"),
      ]),
      preset("2 by 3", strips(whole, 3, "y").flatMap((row) => strips(row, 2, "x"))),
      preset("6 columns", strips(whole, 6, "x")),
      preset("1 left, 5 right", [
        leftHalf,
        ...strips(rightTop, 2, "x"),
        ...strips(rightBottom, 3, "x"),
      ]),
    ];
  }

  return [
    preset("Even grid", evenGrid(count)),
    preset("1 large left, rest in two columns", oneLargeLeft(count)),
  ];
}

/** Fills a preset's slots from `order`, in reading order. */
export function expandPreset(order: string[], preset: LayoutPreset): TileLayout {
  return preset.slots
    .slice(0, order.length)
    .map((slot, i) => ({ sessionId: order[i], ...slot }));
}

/** A new session prefers to split a tile with room for two usable parts. */
const SPLIT_PREFERENCE = 16;

/**
 * The smallest the axis a tile does NOT split on may be for that split to be worth
 * making. A tile only counts as splittable when it has room for two halves that each
 * clear MIN_SPAN, and the cross axis is held to the same bar — otherwise splitting a
 * full-width, near-flat tile hands back two slivers nobody can use. Expressed in
 * MIN_SPANs rather than as a literal so it scales with the zone matrix.
 */
const SPLIT_MIN_CROSS_SPAN = 2 * MIN_SPAN;

/**
 * Adds a session by splitting the LAST tile in reading order along its longer axis
 * — Windows Terminal's behaviour, and the one that keeps the global Terminals view
 * readable when sessions appear from a project tab: the main window stays main and
 * growth happens at the end.
 *
 * A tile below `SPLIT_PREFERENCE` zones on that axis hands the split further back
 * through the order, so the first window is split last. When nothing qualifies the
 * last tile is split regardless: the preference steers the choice, it never hides a
 * new terminal.
 */
export function appendSession(layout: TileLayout, sessionId: string): TileLayout {
  if (layout.length === 0) {
    return [{ sessionId, x: 0, y: 0, w: GRID, h: GRID }];
  }

  const ordered = readingOrder(layout);
  const axisOf = (tile: Tile) => (tile.w >= tile.h ? "x" : "y") as "x" | "y";
  const spanOn = (tile: Tile, axis: "x" | "y") => (axis === "x" ? tile.w : tile.h);

  // Both halves must stay usable, so the split axis needs room for two parts AND
  // the other axis must not already be a sliver — splitting a full-width, flat tile
  // down the middle yields two slivers, which is worse than splitting something
  // further back.
  const other = (axis: "x" | "y") => (axis === "x" ? "y" : "x");
  let host = [...ordered].reverse().find((tile) => {
    const axis = axisOf(tile);
    return (
      spanOn(tile, axis) >= SPLIT_PREFERENCE &&
      spanOn(tile, other(axis)) >= SPLIT_MIN_CROSS_SPAN
    );
  });

  if (!host) {
    host = [...ordered].reverse().find((tile) => spanOn(tile, axisOf(tile)) >= 2);
  }
  if (!host) return layout;

  const [first, second] = strips(host, 2, axisOf(host));
  return readingOrder([
    ...layout.filter((t) => t.sessionId !== host.sessionId),
    { sessionId: host.sessionId, ...first },
    { sessionId, ...second },
  ]);
}

/**
 * Removes a session and hands its rectangle to the neighbour sharing the longest
 * common edge (ties: top → left), so the grid stays fully tiled without reflowing
 * everything around it.
 */
export function removeSession(layout: TileLayout, sessionId: string): TileLayout {
  const gone = layout.find((t) => t.sessionId === sessionId);
  if (!gone) return layout;

  const rest = layout.filter((t) => t.sessionId !== sessionId);
  if (rest.length === 0) return [];

  const absorbed = absorbRect(rest, gone);
  return readingOrder(absorbed && isValidLayout(absorbed) ? absorbed : rest);
}

/**
 * Brings a stored layout in line with the live session list: ids that vanished are
 * removed (their area absorbed), ids that appeared are appended. Idempotent, so a
 * replayed reducer transition cannot render one session in two cells.
 */
export function reconcileTiles(layout: TileLayout, ids: string[]): TileLayout {
  const live = new Set(ids);
  let next = layout;

  for (const tile of layout) {
    if (!live.has(tile.sessionId)) next = removeSession(next, tile.sessionId);
  }

  const present = new Set(next.map((t) => t.sessionId));
  for (const id of ids) {
    if (!present.has(id)) next = appendSession(next, id);
  }

  return next;
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/** Bounding box of the named sessions' tiles. */
export function regionOfTiles(layout: TileLayout, sessionIds: string[]): Rect {
  const tiles = layout.filter((t) => sessionIds.includes(t.sessionId));
  const x = Math.min(...tiles.map((t) => t.x));
  const y = Math.min(...tiles.map((t) => t.y));
  const right = Math.max(...tiles.map((t) => t.x + t.w));
  const bottom = Math.max(...tiles.map((t) => t.y + t.h));
  return { x, y, w: right - x, h: bottom - y };
}

// The complement of `part` inside `whole` when `part` is a band flush against one
// of `whole`'s edges — the only shape a split target can carve out. Null when the
// remainder would not be a rectangle.
function complementBand(outer: Rect, part: Rect): Rect | null {
  if (!contains(outer, part) || sameRect(outer, part)) return null;

  if (part.x === outer.x && part.w === outer.w) {
    if (part.y === outer.y) {
      return { x: outer.x, y: outer.y + part.h, w: outer.w, h: outer.h - part.h };
    }
    if (part.y + part.h === outer.y + outer.h) {
      return { x: outer.x, y: outer.y, w: outer.w, h: outer.h - part.h };
    }
  }

  if (part.y === outer.y && part.h === outer.h) {
    if (part.x === outer.x) {
      return { x: outer.x + part.w, y: outer.y, w: outer.w - part.w, h: outer.h };
    }
    if (part.x + part.w === outer.x + outer.w) {
      return { x: outer.x, y: outer.y, w: outer.w - part.w, h: outer.h };
    }
  }

  return null;
}

// Neighbours that can grow over `rect` and stay rectangular: the tile must sit
// flush against one of its sides AND match that side's span exactly. Sorted by the
// shared edge's length, ties broken top → left, matching the closed-session rule.
function absorbCandidates(layout: TileLayout, rect: Rect) {
  const out: { index: number; grown: Rect; edge: number; side: number }[] = [];

  layout.forEach((tile, index) => {
    const vAligned = tile.y === rect.y && tile.h === rect.h;
    const hAligned = tile.x === rect.x && tile.w === rect.w;

    // side ranks the tie-break: top(0) → left(1) → right(2) → bottom(3).
    if (hAligned && tile.y + tile.h === rect.y) {
      out.push({ index, grown: { ...tile, h: tile.h + rect.h }, edge: rect.w, side: 0 });
    }
    if (vAligned && tile.x + tile.w === rect.x) {
      out.push({ index, grown: { ...tile, w: tile.w + rect.w }, edge: rect.h, side: 1 });
    }
    if (vAligned && tile.x === rect.x + rect.w) {
      out.push({ index, grown: { ...tile, x: rect.x, w: tile.w + rect.w }, edge: rect.h, side: 2 });
    }
    if (hAligned && tile.y === rect.y + rect.h) {
      out.push({ index, grown: { ...tile, y: rect.y, h: tile.h + rect.h }, edge: rect.w, side: 3 });
    }
  });

  return out.sort((a, b) => (b.edge === a.edge ? a.side - b.side : b.edge - a.edge));
}

// Where `rect`'s neighbours on one side start and end, so a rect no single
// neighbour can swallow is cut into pieces that each have an exact match.
function cutOffsets(layout: TileLayout, rect: Rect, axis: "x" | "y"): number[] {
  const start = axis === "x" ? rect.x : rect.y;
  const end = start + (axis === "x" ? rect.w : rect.h);
  const edges = new Set<number>([start, end]);

  for (const tile of layout) {
    if (!overlaps(tile, rect)) {
      const near =
        axis === "x"
          ? tile.y + tile.h === rect.y || tile.y === rect.y + rect.h
          : tile.x + tile.w === rect.x || tile.x === rect.x + rect.w;
      if (!near) continue;
      const from = axis === "x" ? tile.x : tile.y;
      const to = from + (axis === "x" ? tile.w : tile.h);
      if (from > start && from < end) edges.add(from);
      if (to > start && to < end) edges.add(to);
    }
  }

  return [...edges].sort((a, b) => a - b);
}

/**
 * Hands the freed `rect` to the neighbours around it, extending them rectangularly.
 * Prefers one neighbour spanning the whole side; failing that, cuts `rect` along the
 * neighbour boundaries and recurses, which always terminates because every cut
 * yields strictly smaller rectangles. Returns null when nothing borders `rect`.
 */
function absorbRect(layout: TileLayout, rect: Rect): TileLayout | null {
  if (rect.w <= 0 || rect.h <= 0) return layout;

  const [best] = absorbCandidates(layout, rect);
  if (best) {
    const next = layout.slice();
    next[best.index] = { sessionId: next[best.index].sessionId, ...best.grown };
    return next;
  }

  for (const axis of ["x", "y"] as const) {
    const offsets = cutOffsets(layout, rect, axis);
    if (offsets.length <= 2) continue;

    let current: TileLayout | null = layout;
    for (let i = 0; i < offsets.length - 1 && current; i++) {
      const span = offsets[i + 1] - offsets[i];
      const piece: Rect =
        axis === "x"
          ? { x: offsets[i], y: rect.y, w: span, h: rect.h }
          : { x: rect.x, y: offsets[i], w: rect.w, h: span };
      current = absorbRect(current, piece);
    }
    if (current) return current;
  }

  return null;
}

// Slices `rect` into `parts` strips along its longer axis, falling back to the other
// axis when the longer one has too few zones. Null when neither axis can hold them.
function sliceInto(rect: Rect, parts: number): Rect[] | null {
  const axes: ("x" | "y")[] = rect.w >= rect.h ? ["x", "y"] : ["y", "x"];
  for (const axis of axes) {
    if ((axis === "x" ? rect.w : rect.h) >= parts) return strips(rect, parts, axis);
  }
  return null;
}

/**
 * Gives `sessionId` exactly `region` and repairs the rest, returning the whole next
 * layout — what the drag overlay paints and what the drop commits, computed once.
 *
 * Two shapes of target, mirroring the overlay's two kinds of hit region:
 *   - `region` covers whole tiles (centre target, or a sweep across several): those
 *     sessions move into the rectangle the dragged one vacated, sliced into strips;
 *   - `region` is a band of a single tile (edge target): that tile keeps the
 *     complementary band, and the vacated rectangle is absorbed by its neighbours.
 *
 * Null means "no valid layout for this target" — the overlay then paints nothing and
 * a drop commits nothing, which is the only invalid gesture in the model.
 */
export function placeRegion(
  layout: TileLayout,
  sessionId: string,
  region: Rect,
): TileLayout | null {
  const vacated = layout.find((t) => t.sessionId === sessionId);
  if (!vacated) return null;
  if (sameRect(vacated, region)) return layout;
  if (region.w < 1 || region.h < 1) return null;
  if (region.x < 0 || region.y < 0) return null;
  if (region.x + region.w > GRID || region.y + region.h > GRID) return null;

  // The dragged session's own tile inside the region leaves the displaced sessions
  // nowhere to go — every other zone is spoken for.
  if (overlaps(vacated, region)) return null;

  const touched = layout.filter((t) => t.sessionId !== sessionId && overlaps(t, region));
  const displaced = touched.filter((t) => contains(region, t));

  let next: TileLayout | null;

  if (displaced.length === touched.length && displaced.length > 0) {
    const strips = sliceInto(vacated, displaced.length);
    if (!strips) return null;

    // Rect spread FIRST, id last: a caller may hand in a region copied off a tile,
    // which still carries that tile's sessionId and would otherwise overwrite this one.
    const moved = readingOrder(displaced).map((tile, i) => ({
      ...strips[i],
      sessionId: tile.sessionId,
    }));
    const movedIds = new Set(moved.map((t) => t.sessionId));

    next = [
      ...layout.filter((t) => t.sessionId !== sessionId && !movedIds.has(t.sessionId)),
      { ...region, sessionId },
      ...moved,
    ];
  } else if (touched.length === 1) {
    const host = touched[0];
    const remainder = complementBand(host, region);
    if (!remainder) return null;

    const kept: TileLayout = layout
      .filter((t) => t.sessionId !== sessionId && t.sessionId !== host.sessionId)
      .concat(
        { ...remainder, sessionId: host.sessionId },
        { ...region, sessionId },
      );

    next = absorbRect(kept, vacated);
  } else {
    return null;
  }

  if (!next || !isValidLayout(next)) return null;
  return readingOrder(next);
}

// The four rectangles left over when `region` is carved out of the grid: the full-width
// strips above and below it, and the side strips beside it. Empty ones are dropped.
function complementOf(region: Rect): Rect[] {
  const right = region.x + region.w;
  const bottom = region.y + region.h;
  return [
    { x: 0, y: 0, w: GRID, h: region.y },
    { x: 0, y: region.y, w: region.x, h: region.h },
    { x: right, y: region.y, w: GRID - right, h: region.h },
    { x: 0, y: bottom, w: GRID, h: GRID - bottom },
  ].filter((r) => r.w > 0 && r.h > 0);
}

const area = (r: Rect) => r.w * r.h;

/**
 * Grows (or moves) `sessionId` to exactly `region` and re-tiles everyone else into what
 * is left. Unlike `placeRegion`, the region may swallow the dragged session's own tile
 * and cut through any number of others — which is the whole point: "this window takes
 * that area, the rest fit around it" is the only way to make a window BIGGER, and the
 * target model could only ever hand a window a slice of one neighbour.
 *
 * The leftover is at most four rectangles, so the remaining sessions are spread across
 * them by area (each rectangle sliced into strips along its longer axis) and any
 * rectangle that ends up with nobody is absorbed by a neighbour. Null when the leftover
 * cannot hold everyone — the overlay then paints nothing.
 */
export function growRegion(
  layout: TileLayout,
  sessionId: string,
  region: Rect,
): TileLayout | null {
  if (!layout.some((t) => t.sessionId === sessionId)) return null;
  if (region.w < 1 || region.h < 1) return null;
  if (region.x < 0 || region.y < 0) return null;
  if (region.x + region.w > GRID || region.y + region.h > GRID) return null;

  const others = readingOrder(layout.filter((t) => t.sessionId !== sessionId));
  const grown: Tile = { ...region, sessionId };
  if (others.length === 0) {
    return area(region) === GRID * GRID ? [grown] : null;
  }

  const rects = complementOf(region);
  if (rects.reduce((n, r) => n + area(r), 0) < others.length) return null;

  // Greedy proportional fill: each session goes to whichever leftover rectangle has the
  // most room per session already assigned to it, so the biggest gaps take the most
  // windows and nobody lands in a rectangle too small to hold them.
  const load = rects.map(() => 0);
  for (let i = 0; i < others.length; i++) {
    let best = -1;
    let bestRoom = -1;
    rects.forEach((r, idx) => {
      const capacity = Math.max(r.w, r.h);
      if (load[idx] >= capacity) return;
      const room = area(r) / (load[idx] + 1);
      if (room > bestRoom) {
        bestRoom = room;
        best = idx;
      }
    });
    if (best < 0) return null;
    load[best]++;
  }

  let next: TileLayout = [grown];
  const spare: Rect[] = [];
  let taken = 0;

  rects.forEach((rect, idx) => {
    if (load[idx] === 0) {
      spare.push(rect);
      return;
    }
    const strips = sliceInto(rect, load[idx]);
    if (!strips) {
      spare.push(rect);
      return;
    }
    for (const strip of strips) {
      next.push({ ...strip, sessionId: others[taken++].sessionId });
    }
  });

  if (taken < others.length) return null;

  for (const rect of spare) {
    const absorbed = absorbRect(next, rect);
    if (!absorbed) return null;
    next = absorbed;
  }

  return isValidLayout(next) ? readingOrder(next) : null;
}
