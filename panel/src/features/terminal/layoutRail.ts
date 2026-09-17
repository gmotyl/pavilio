/**
 * The answer pane's rail geometry — where each unit's segment sits beside the
 * text. Pure arithmetic plus one imperative DOM pass, kept out of
 * `AnswerPane.tsx` so the geometry is testable without React; see the note
 * "Why the rail is laid out from the blocks, imperatively" on the component.
 */

/** The height of a segment whose unit has no block on screen. */
export const MIN_SEGMENT_HEIGHT = 8;
/** The gap a segment leaves after the one before it when the two would touch or overlap. */
export const SEGMENT_GAP = 2;

/** unit index → the blocks it was spoken from; see `matchUnitsToBlocks`. */
export type UnitToBlocks = readonly (readonly number[])[];

/**
 * The blocks a unit can be matched to: the direct children of `.prose`, with
 * each `ul` / `ol` replaced by its direct `li` children.
 *
 * Why: a list is ONE element to react-markdown but one paragraph per item to
 * the voice — `stripToSpeakableText` emits every item on its own, so a unit
 * packed from items 3 to 5 has no whole-list block to match. While the list
 * was the block, every unit cut from it was handed that same block, and the
 * rail stacked all but the first below it as stubs. One level only: a nested
 * list stays inside its parent `li`, whose text already contains it.
 */
export function matchableBlocks(prose: HTMLElement): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  for (const child of Array.from(prose.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.tagName === "UL" || child.tagName === "OL") {
      for (const item of Array.from(child.children)) {
        if (item instanceof HTMLElement) blocks.push(item);
      }
      continue;
    }
    blocks.push(child);
  }
  return blocks;
}

/** A unit's vertical extent in rail coordinates. */
export interface Span {
  top: number;
  bottom: number;
}

/**
 * Consecutive units whose spans are identical form a group; the group's
 * rectangle is cut into slices proportional to `weights`, in unit order.
 * Distinct spans and nulls pass through untouched, and a null breaks a group.
 *
 * Why: a list cut into several units used to hand every unit the same block —
 * the whole `<ul>` — so the spans came out identical, and the monotonic rule
 * downstream (a segment never starts above the previous one's end) stacked
 * units 2..n below the list as 8px stubs (smoke test, 2026-09-17). The same
 * happens to one long paragraph cut in two at the ceiling. Dividing the shared
 * rectangle by how much of it each unit speaks puts every segment beside the
 * text it is spoken from. A group whose weights are all zero is split evenly
 * rather than collapsing every slice to nothing.
 */
export function splitSharedSpans(
  spans: readonly (Span | null)[],
  weights: readonly number[],
): (Span | null)[] {
  const result: (Span | null)[] = [];
  let index = 0;
  while (index < spans.length) {
    const span = spans[index];
    if (!span) {
      result.push(null);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < spans.length) {
      const next = spans[end];
      if (!next || next.top !== span.top || next.bottom !== span.bottom) break;
      end += 1;
    }
    if (end - index === 1) {
      result.push(span);
      index = end;
      continue;
    }

    const groupWeights = weights.slice(index, end).map((w) => Math.max(0, w ?? 0));
    const total = groupWeights.reduce((sum, w) => sum + w, 0);
    const shares = total > 0 ? groupWeights.map((w) => w / total) : groupWeights.map(() => 1 / groupWeights.length);
    const height = span.bottom - span.top;
    let cursor = span.top;
    shares.forEach((share, offset) => {
      // The last slice closes on the group's bottom exactly, so rounding never
      // leaves a sliver uncovered or overshoots the block.
      const bottom = offset === shares.length - 1 ? span.bottom : cursor + height * share;
      result.push({ top: cursor, bottom });
      cursor = bottom;
    });
    index = end;
  }
  return result;
}

/**
 * Places the rail's segments over their units' blocks — see the note on the
 * component. Reads the offsets of the rendered blocks ({@link matchableBlocks}
 * of the body's `.prose`) and writes `top` / `height` onto the rail's children,
 * one per unit, in rail coordinates (the body is the `offsetParent` of both,
 * so the rail's own `offsetTop` is the only correction).
 *
 * A unit's span runs from the top of its first block to the bottom of its
 * last — over EVERY block it owns, not only the ones credited to it by
 * `data-unit`, because a block can belong to several units: a fast-start
 * "Hi." unit whose source is the whole first paragraph, and the next unit
 * that packs the rest of that paragraph. Spans that come out identical are
 * first divided among their units by `unit.chars` ({@link splitSharedSpans});
 * the rest overlap, and the rail resolves that monotonically: a segment never
 * starts above the previous one's end, `top = max(span.top, previousEnd + gap)`,
 * so the second unit's segment sits beside the remainder of the shared
 * paragraph rather than on top of the first unit's (smoke test, 2026-09-16).
 * A unit with no block gets {@link MIN_SEGMENT_HEIGHT} right after the
 * previous segment's end.
 */
export function layoutRail(
  body: HTMLElement | null,
  rail: HTMLElement | null,
  unitToBlocks: UnitToBlocks,
  units: readonly { chars: number }[],
): void {
  if (!body || !rail) return;
  const segments = Array.from(rail.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  if (segments.length === 0) return;

  // The same index space the pane marked from — {@link matchableBlocks}, not
  // the raw children — or a unit's block numbers would point at other elements.
  const prose = body.querySelector<HTMLElement>(".prose");
  const blocks = prose ? matchableBlocks(prose) : [];

  const origin = rail.offsetTop;
  const rawSpans = segments.map((_segment, index) => {
    let span: Span | null = null;
    for (const blockIndex of unitToBlocks[index] ?? []) {
      const block = blocks[blockIndex];
      if (!block) continue;
      const top = block.offsetTop - origin;
      const bottom = top + block.offsetHeight;
      if (!span) span = { top, bottom };
      else {
        span.top = Math.min(span.top, top);
        span.bottom = Math.max(span.bottom, bottom);
      }
    }
    return span;
  });
  const spans = splitSharedSpans(
    rawSpans,
    segments.map((_segment, index) => units[index]?.chars ?? 0),
  );

  // The first segment pays no gap.
  let previousEnd = -SEGMENT_GAP;
  segments.forEach((segment, index) => {
    const span = spans[index];
    const floor = previousEnd + SEGMENT_GAP;
    const top = span ? Math.max(span.top, floor) : floor;
    const height = span ? Math.max(span.bottom - top, MIN_SEGMENT_HEIGHT) : MIN_SEGMENT_HEIGHT;
    segment.style.top = `${top}px`;
    segment.style.height = `${height}px`;
    previousEnd = top + height;
  });
}
