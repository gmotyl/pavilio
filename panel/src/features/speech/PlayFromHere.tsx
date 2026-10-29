import { Play } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";
import { blockMatchStrength, normalizeForMatch } from "./matchUnitsToBlocks";
import { preparePage } from "./pageText";
import type { SpeechUnit } from "./types";

/*
 * Play from here: a round ▶ over the left edge of every speakable block of a
 * page (headings, paragraphs, list items), shown on hover, focus or a tap,
 * that starts the page's run at that block's first unit.
 *
 * The rendered markdown is not restructured. The blocks are found in the DOM
 * after react-markdown has rendered them, marked with data attributes (which
 * React leaves alone, as the answer pane's marks), and the buttons live in an
 * absolutely positioned layer over the page — never inside a block, so no
 * block's padding, margin or text moves (the agreed deviation from the
 * mockup's gutter: the ▶ covers the start of the text instead).
 *
 * The bar is not here: the toolbar (`ViewerActions`) owns it, in the
 * breadcrumb slot — another subtree. So a press and a hover cross over through
 * the small per-key store below: a press asks the toolbar to unfold its bar and
 * start the run there; a hover names the unit whose scrubber segment the bar
 * outlines.
 */

// ── the store between the page and its toolbar ───────────────────────────────

const hints = new Map<string, number>();
const hintListeners = new Set<() => void>();
const playHandlers = new Map<string, Set<(unit: number) => void>>();

function setHint(key: string, unit: number | null): void {
  if ((hints.get(key) ?? null) === unit) return;
  if (unit === null) hints.delete(key);
  else hints.set(key, unit);
  for (const listener of hintListeners) listener();
}

function subscribeHints(listener: () => void): () => void {
  hintListeners.add(listener);
  return () => hintListeners.delete(listener);
}

/** The unit a hovered or focused block of `key`'s page would start at; null when none. */
export function usePlayHint(key: string): number | null {
  return useSyncExternalStore(subscribeHints, () => hints.get(key) ?? null);
}

/**
 * Handles a ▶ press on `key`'s page: `handler` gets the unit to start at. The
 * toolbar registers here, so the press unfolds its bar and runs through it.
 */
export function usePlayFromHereHandler(key: string, handler: (unit: number) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const call = (unit: number) => ref.current(unit);
    let set = playHandlers.get(key);
    if (!set) playHandlers.set(key, (set = new Set()));
    set.add(call);
    return () => {
      set.delete(call);
      if (set.size === 0) playHandlers.delete(key);
    };
  }, [key]);
}

function requestPlay(key: string, unit: number): void {
  for (const handler of playHandlers.get(key) ?? []) handler(unit);
}

// ── rendered blocks → units ──────────────────────────────────────────────────

/** Blocks that are never spoken as text: a ▶ inside them would start nothing. */
const UNSPOKEN = "pre, table, .mermaid-block, [data-play-from-here-layer]";

/**
 * The page's speakable blocks in page order: headings, paragraphs and list
 * items. A list item that holds paragraphs (a loose item) is its paragraphs —
 * one granularity, never the item AND its paragraphs.
 */
function speakableBlocks(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6, p, li")).filter((el) => {
    if (el.closest(UNSPOKEN)) return false;
    if (el.tagName === "LI" && Array.from(el.children).some((child) => child.tagName === "P")) return false;
    return true;
  });
}

/** A block's own text: a list item's nested lists are their own blocks. */
function ownText(el: HTMLElement): string {
  if (el.tagName !== "LI") return el.textContent ?? "";
  return Array.from(el.childNodes)
    .filter((node) => !(node instanceof HTMLElement && (node.tagName === "UL" || node.tagName === "OL")))
    .map((node) => node.textContent ?? "")
    .join("");
}

/**
 * How many units past the cursor a block's partial match is looked for. A
 * partial match (`blockMatchStrength` above 0) needs a substring test per unit,
 * so scanning to the page's end for every block would make a page of thousands
 * of blocks quadratic. The units between two matched blocks are those of
 * rendered blocks that matched nothing, so the window only has to outlast a run
 * of those. An exact match is found however far it is: it is looked up.
 */
export const SCAN_WINDOW = 128;

/**
 * For each rendered block, the first unit of the prepared block it is, or null.
 *
 * Matched in page order with a moving cursor: each block is looked for among
 * the units after the last matched block's, so a repeated `## Example` lands on
 * its own unit rather than the first one with that text. From the cursor on, a
 * unit that IS the block wins (the earliest one, looked up by text); otherwise
 * the strongest match within {@link SCAN_WINDOW} units (`blockMatchStrength`),
 * the earliest on a tie. A match snaps to the first unit of its prepared block
 * — a block cut into several units starts at the first. An unmatched rendered
 * block (a code block, raw HTML, a paragraph that opens and closes with an
 * inline transform) leaves the cursor where it was.
 */
export function firstUnitsOfBlocks(
  units: readonly SpeechUnit[],
  blockTexts: readonly string[],
): (number | null)[] {
  const sources = units.map((unit) => normalizeForMatch(unit.source));
  // Each source's unit indices, ascending: the exact lookup.
  const bySource = new Map<string, number[]>();
  sources.forEach((source, i) => {
    if (source.length === 0) return;
    const list = bySource.get(source);
    if (list) list.push(i);
    else bySource.set(source, [i]);
  });
  // Each prepared block's first unit and the unit after its last.
  const blockStart = new Map<number, number>();
  const blockEnd = new Map<number, number>();
  units.forEach((unit, i) => {
    if (unit.block === undefined) return;
    if (!blockStart.has(unit.block)) blockStart.set(unit.block, i);
    blockEnd.set(unit.block, i + 1);
  });

  let cursor = 0;
  return blockTexts.map((text) => {
    const block = normalizeForMatch(text);
    let hit: number | null = firstAtOrAfter(bySource.get(block), cursor);
    if (hit === null) {
      let best = Infinity;
      const limit = Math.min(units.length, cursor + SCAN_WINDOW);
      for (let i = cursor; i < limit; i++) {
        const strength = blockMatchStrength(block, sources[i]);
        if (strength !== null && strength < best) {
          best = strength;
          hit = i;
        }
      }
    }
    if (hit === null) return null;
    const blockIndex = units[hit].block;
    if (blockIndex === undefined) {
      cursor = hit + 1;
      return hit;
    }
    cursor = Math.max(cursor, blockEnd.get(blockIndex) ?? hit + 1);
    return blockStart.get(blockIndex) ?? hit;
  });
}

/** The first of the ascending `indices` at or after `from`, or null. */
function firstAtOrAfter(indices: readonly number[] | undefined, from: number): number | null {
  if (!indices) return null;
  let lo = 0;
  let hi = indices.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (indices[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  return lo < indices.length ? indices[lo] : null;
}

// ── the component ────────────────────────────────────────────────────────────

/** The ▶'s diameter, px — the answer pane's Play. */
const BUTTON_SIZE = 22;

interface Mark {
  /** Rendered block index — the ▶ and its block share it as `data-speak-index`. */
  index: number;
  unit: number;
  top: number;
  left: number;
}

const INDEX_ATTR = "data-speak-index";
const UNIT_ATTR = "data-speak-unit";
const HOVER_ATTR = "data-speak-hover";

/** The rendered block index an event happened over: a marked block, or its ▶. */
function indexAt(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const marked = target.closest(`[${INDEX_ATTR}]`);
  if (!marked) return null;
  return Number(marked.getAttribute(INDEX_ATTR));
}

export interface PlayFromHereProps {
  /** The page's speech key; without one (not markdown, still loading) the page gets no ▶. */
  docKey?: string;
  /** The page's markdown source, as handed to the toolbar's Play. */
  text: string;
  /** The rendered page. */
  children: ReactNode;
}

export function PlayFromHere({ docKey, text, children }: PlayFromHereProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef<HTMLElement[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<number | null>(null);

  // Prepared by the one page preparation the host plays from (`preparePage`:
  // frontmatter dropped, block-bounded, in the page's own language), so a unit
  // index here is the same unit in the bar and in the run.
  const units = useMemo(() => (docKey ? preparePage(text).units : []), [docKey, text]);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    setMarks((current) =>
      current.map((mark) => {
        const el = elementsRef.current[mark.index];
        if (!el) return mark;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const lineHeight =
          parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 16) * 1.5;
        const top = rect.top - origin.top + Math.max(0, (lineHeight - BUTTON_SIZE) / 2);
        const left = rect.left - origin.left - 4;
        return top === mark.top && left === mark.left ? mark : { ...mark, top, left };
      }),
    );
  }, []);

  /**
   * Finds the rendered blocks, matches them to units and marks them. `reset`
   * (a new text) also clears the hover, focus and tap state; a re-mark of the
   * same text keeps them, its blocks sit at the same indices.
   */
  const mark = useCallback(
    (reset: boolean) => {
      const root = rootRef.current;
      if (!root) return;
      for (const el of Array.from(root.querySelectorAll(`[${INDEX_ATTR}]`))) {
        // The ▶ buttons carry the index too; they are React's, not ours.
        if (el.closest("[data-play-from-here-layer]")) continue;
        el.removeAttribute(INDEX_ATTR);
        el.removeAttribute(UNIT_ATTR);
        el.removeAttribute(HOVER_ATTR);
      }
      if (reset) {
        setHovered(null);
        setFocused(null);
        setRevealed(null);
      }
      if (units.length === 0) {
        elementsRef.current = [];
        setMarks([]);
        return;
      }
      const elements = speakableBlocks(root);
      const firstUnits = firstUnitsOfBlocks(units, elements.map(ownText));
      elementsRef.current = elements;
      const next: Mark[] = [];
      elements.forEach((el, index) => {
        const unit = firstUnits[index];
        if (unit === null) return;
        el.setAttribute(INDEX_ATTR, String(index));
        el.setAttribute(UNIT_ATTR, String(unit));
        next.push({ index, unit, top: 0, left: 0 });
      });
      setMarks(next);
      measure();
    },
    [units, measure],
  );

  // Mark the blocks when the text (and so the units) changes. A layout effect:
  // the markdown under it has committed, and the ▶ is placed before paint.
  useLayoutEffect(() => mark(true), [mark]);

  // The markdown can replace a subtree without its text changing — a component
  // identity changing under react-markdown (the wiki-link check resolving)
  // remounts a blockquote, a list — and the new nodes carry no marks while
  // `elementsRef` holds the detached old ones. So any node added or removed
  // under the page re-marks it, once per frame, and only when the speakable
  // blocks are no longer the ones marked: the ▶ layer's own renders, and the
  // marks' attributes, change nothing here.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof MutationObserver === "undefined") return;
    let frame: number | null = null;
    const check = () => {
      frame = null;
      const current = speakableBlocks(root);
      const marked = elementsRef.current;
      const same = current.length === marked.length && current.every((el, i) => el === marked[i]);
      if (!same) mark(false);
    };
    const observer = new MutationObserver((records) => {
      if (frame !== null) return;
      const outsideLayer = records.some(
        (record) => !(record.target instanceof Element && record.target.closest("[data-play-from-here-layer]")),
      );
      if (outsideLayer) frame = requestAnimationFrame(check);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [mark]);

  // Re-place the buttons when the page changes size: a mermaid diagram that
  // finished rendering, a wider pane, a font that loaded.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);

  const active = hovered ?? focused ?? revealed;
  const activeUnit = active === null ? null : (marks.find((m) => m.index === active)?.unit ?? null);

  // The highlight is an attribute on the block itself, so its background is
  // the block's own box — no wrapper, nothing that moves.
  useLayoutEffect(() => {
    const el = active === null ? undefined : elementsRef.current[active];
    if (!el) return;
    el.setAttribute(HOVER_ATTR, "");
    return () => el.removeAttribute(HOVER_ATTR);
  }, [active, marks]);

  // The bar outlines the segment the jump would land on.
  useEffect(() => {
    if (!docKey) return;
    setHint(docKey, activeUnit);
  }, [docKey, activeUnit]);
  useEffect(() => {
    if (!docKey) return;
    return () => setHint(docKey, null);
  }, [docKey]);

  const onMouseOver = (event: MouseEvent) => setHovered(indexAt(event.target));
  // Leaving the page also drops a tap's reveal: a ▶ left shown (and its
  // segment outlined) after the pointer has gone elsewhere is stale.
  const onMouseLeave = () => {
    setHovered(null);
    setRevealed(null);
  };
  // A tap has no hover to reveal the ▶ with: the tap itself reveals it, and a
  // hidden ▶ takes no pointer, so the first tap lands on the block. A mouse
  // click on a block does the same, harmlessly — the ▶ is already shown.
  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-play-from-here-layer]")) return;
    setRevealed(indexAt(target));
  };

  return (
    <div
      ref={rootRef}
      data-play-from-here=""
      style={{ position: "relative" }}
      onMouseOver={docKey ? onMouseOver : undefined}
      onMouseLeave={docKey ? onMouseLeave : undefined}
      onClick={docKey ? onClick : undefined}
    >
      {children}
      {docKey && marks.length > 0 && (
        <div data-play-from-here-layer="" className="play-from-here-layer">
          {marks.map((mark) => (
            <button
              key={mark.index}
              type="button"
              data-testid={`play-from-here-${mark.index}`}
              className="play-from-here"
              aria-label="Play from here"
              title="Play from here"
              data-speak-index={mark.index}
              data-shown={mark.index === active ? "" : undefined}
              style={{ position: "absolute", top: mark.top, left: mark.left }}
              onFocus={() => setFocused(mark.index)}
              onBlur={() => setFocused((current) => (current === mark.index ? null : current))}
              onClick={(event) => {
                event.stopPropagation();
                requestPlay(docKey, mark.unit);
              }}
            >
              <Play size={12} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default PlayFromHere;
