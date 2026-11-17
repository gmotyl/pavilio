import { Pause, Play } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { blockMatchStrength, normalizeForMatch } from "./matchUnitsToBlocks";
import type { SpeechUnit } from "./types";

/*
 * Play from here: a round ▶ beside the left edge of every speakable block of a
 * rendered markdown body (headings, paragraphs, list items), shown on hover,
 * focus or a tap, that starts the body's run at that block's first unit.
 *
 * Surface-agnostic: the caller hands in the units it prepared, the unit the
 * host is playing and what a press does. A page reaches it through
 * `PagePlayFromHere` (which crosses over to the page's toolbar); the answer
 * pane calls the host directly.
 *
 * The rendered markdown is not restructured. The blocks are found in the DOM
 * after react-markdown has rendered them, marked with data attributes (which
 * React leaves alone), and the buttons live in an absolutely positioned layer
 * over the body — never inside a block, so no block's padding, margin or text
 * moves. No room is reserved for them (a narrow phone keeps its width): a ▶
 * sits left of its block's text, over the body's padding or a list marker, as
 * far as the nearest clipping box allows, and covers the start of the text
 * only when there is no room at all.
 *
 * While a unit plays, one more ▶ is pinned — always shown, labelled Pause (Play
 * while paused) — beside the line where the playing sentence starts inside its
 * block, so the reader sees where the voice is.
 */

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

// ── the playing sentence → its line ──────────────────────────────────────────

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Letters and digits only, lowercased: what a sentence and its rendering share. */
function squash(text: string): string {
  let out = "";
  for (const ch of text) if (WORD_CHAR.test(ch)) out += ch.toLowerCase();
  return out;
}

/** Whether a text node is part of `el`'s own text: a list item's nested lists are their own blocks. */
function isOwnText(el: HTMLElement, node: Node): boolean {
  if (el.tagName !== "LI") return true;
  for (let up = node.parentElement; up && up !== el; up = up.parentElement) {
    if (up.tagName === "UL" || up.tagName === "OL") return false;
  }
  return true;
}

/** Where a squashed UTF-16 unit came from: its text node and its letter's start and end there. */
interface SquashedAt {
  node: Text;
  offset: number;
  end: number;
}

/**
 * `el`'s own text squashed (see {@link squash}), with the text node and
 * offsets each of its UTF-16 units came from, so a match in the squashed text
 * (which `findSentence` gives in UTF-16 units) maps back to a DOM `Range`.
 */
function squashedText(el: HTMLElement): { text: string; at: SquashedAt[] } {
  let text = "";
  const at: SquashedAt[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!isOwnText(el, node)) continue;
    const data = (node as Text).data;
    let offset = 0;
    for (const ch of data) {
      if (WORD_CHAR.test(ch)) {
        // One entry per UTF-16 unit of the lowercased letter: a letter outside
        // the basic plane, or one whose lowercase is longer ("İ"), adds more
        // than one.
        const lower = ch.toLowerCase();
        text += lower;
        const end = offset + ch.length;
        for (let k = 0; k < lower.length; k++) at.push({ node: node as Text, offset, end });
      }
      offset += ch.length;
    }
  }
  return { text, at };
}

/**
 * Where `sentence` starts in `hay` at or after `from`: its first words (six,
 * then three, then one), squashed. The spoken text can differ from the
 * rendered one further on (a link said as its label, a respelled word), so
 * only the head is looked for; a shorter head is tried when a longer one is
 * not found. Returns `[start, end]` in squashed characters, or null.
 */
function findSentence(hay: string, sentence: string, from: number): [number, number] | null {
  const words = sentence.split(/\s+/).map(squash).filter((word) => word.length > 0);
  for (const count of [6, 3, 1]) {
    if (count > words.length && count !== 1) continue;
    const needle = words.slice(0, count).join("");
    if (needle.length === 0) continue;
    const start = hay.indexOf(needle, from);
    if (start >= 0) return [start, start + needle.length];
  }
  return null;
}

/**
 * The first line box of the playing unit's sentence inside its block, in
 * viewport px — or null when the sentence is not found in the block's text or
 * the browser gives the range no box. The units of the block before it are
 * located first, in order, so a sentence repeated in one block lands on its
 * own occurrence.
 */
function sentenceLine(
  el: HTMLElement,
  units: readonly SpeechUnit[],
  firstUnit: number,
  playing: number,
): DOMRect | null {
  const { text, at } = squashedText(el);
  let cursor = 0;
  let found: [number, number] | null = null;
  for (let i = firstUnit; i <= playing; i++) {
    found = findSentence(text, units[i]?.text ?? "", cursor);
    if (found) cursor = found[1];
  }
  if (!found) return null;
  const start = at[found[0]];
  const last = at[found[1] - 1];
  // Not expected while `at` follows `text` unit for unit; null keeps the ▶ on
  // the block's first line rather than throwing mid-layout.
  if (!start || !last) return null;
  const range = el.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(last.node, last.end);
  if (typeof range.getClientRects !== "function") return null;
  const rects = range.getClientRects();
  return rects.length > 0 ? rects[0] : null;
}

// ── the component ────────────────────────────────────────────────────────────

/** The ▶'s diameter, px — the answer pane's Play. */
const BUTTON_SIZE = 22;

/** Space between a ▶ and the text it sits left of, px. */
const GAP = 4;

/**
 * How long a ▶ stays after the pointer leaves its block, ms: long enough to
 * cross the gap to a ▶ that sits outside the block (and the body's box).
 */
const LEAVE_GRACE = 300;

/**
 * Where a ▶ goes, px from the body's left: left of its block's text (`text`)
 * when there is room, no further left than the clipping box allows (`clip`),
 * and over the start of the text when there is no room at all.
 */
export function playButtonLeft(text: number, clip: number): number {
  return Math.max(text - BUTTON_SIZE - GAP, Math.min(clip, text));
}

/**
 * The left edge, in viewport px, a ▶ may reach before it is cut off: the
 * padding edge of the nearest ancestor that clips horizontally, or the
 * viewport's.
 */
function clipLeft(root: HTMLElement): number {
  for (let el = root.parentElement; el; el = el.parentElement) {
    if (getComputedStyle(el).overflowX !== "visible") {
      return el.getBoundingClientRect().left + el.clientLeft;
    }
  }
  return 0;
}

/** A block's line height, px: what a ▶ is centred on. */
function lineHeightOf(el: HTMLElement): number {
  const style = getComputedStyle(el);
  return parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 16) * 1.5;
}

interface Mark {
  /** Rendered block index — the ▶ and its block share it as `data-speak-index`. */
  index: number;
  unit: number;
  top: number;
  left: number;
}

/** The pinned ▶: the block holding the playing unit, placed at its sentence's line. */
interface Pin {
  index: number;
  unit: number;
  top: number;
  left: number;
}

const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);

const INDEX_ATTR = "data-speak-index";
const UNIT_ATTR = "data-speak-unit";

/** The rendered block index an event happened over: a marked block, or its ▶. */
function indexAt(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const marked = target.closest(`[${INDEX_ATTR}]`);
  if (!marked) return null;
  return Number(marked.getAttribute(INDEX_ATTR));
}

/** The mark of the block that holds `unit`, or null. */
function markOfUnit(marks: readonly Mark[], units: readonly SpeechUnit[], unit: number): Mark | null {
  const block = units[unit]?.block;
  if (block === undefined) return marks.find((m) => m.unit === unit) ?? null;
  return marks.find((m) => units[m.unit]?.block === block) ?? null;
}

export interface PlayFromHereProps {
  /** The run's speech key (`doc:<path>` or a session id); without one the body gets no ▶. */
  speechKey?: string;
  /** The units the body is spoken as, prepared by the caller exactly as the host plays them. */
  units: readonly SpeechUnit[];
  /** The unit the host is playing for this key (`progressFor(key)?.unitIndex`); null when none. */
  playingUnit: number | null;
  /** Whether the run is paused on `playingUnit`: the pinned ▶ then reads Play. */
  paused: boolean;
  /** Start — or jump — the run at `unit`. */
  onPlay: (unit: number) => void;
  /** Pause the run (the pinned ▶ while playing). */
  onPause: () => void;
  /** The unit a hovered, focused or tapped block would start at; null when none. */
  onHint?: (unit: number | null) => void;
  /** The rendered body. */
  children: ReactNode;
}

export function PlayFromHere({
  speechKey,
  units: givenUnits,
  playingUnit,
  paused,
  onPlay,
  onPause,
  onHint,
  children,
}: PlayFromHereProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef<HTMLElement[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [pin, setPin] = useState<Pin | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<number | null>(null);

  // Without a key nothing is marked: the units are as good as none.
  const units = speechKey ? givenUnits : NO_UNITS;
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const playingRef = useRef(playingUnit);
  playingRef.current = playingUnit;
  const unitsRef = useRef(units);
  unitsRef.current = units;

  /** The block's first line, relative to the body: where a block's ▶ sits. */
  const placeBlock = useCallback((el: HTMLElement, origin: DOMRect, minLeft: number) => {
    const rect = el.getBoundingClientRect();
    const top = rect.top - origin.top + Math.max(0, (lineHeightOf(el) - BUTTON_SIZE) / 2);
    const left = playButtonLeft(rect.left - origin.left, minLeft);
    return { top, left };
  }, []);

  /**
   * Places the pinned ▶ for the playing unit: at the first line box of its
   * sentence, or at its block's first line when the sentence is not found.
   */
  const measurePin = useCallback(() => {
    const root = rootRef.current;
    const playing = playingRef.current;
    const currentUnits = unitsRef.current;
    const mark = root && playing !== null ? markOfUnit(marksRef.current, currentUnits, playing) : null;
    const el = mark ? elementsRef.current[mark.index] : undefined;
    if (!root || playing === null || !mark || !el) {
      setPin(null);
      return;
    }
    const origin = root.getBoundingClientRect();
    const block = placeBlock(el, origin, clipLeft(root) - origin.left);
    const line = sentenceLine(el, currentUnits, mark.unit, playing);
    const top = line
      ? line.top - origin.top + Math.max(0, (lineHeightOf(el) - BUTTON_SIZE) / 2)
      : block.top;
    setPin((current) =>
      current &&
      current.index === mark.index &&
      current.unit === playing &&
      current.top === top &&
      current.left === block.left
        ? current
        : { index: mark.index, unit: playing, top, left: block.left },
    );
  }, [placeBlock]);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const minLeft = clipLeft(root) - origin.left;
    setMarks((current) =>
      current.map((mark) => {
        const el = elementsRef.current[mark.index];
        if (!el) return mark;
        const { top, left } = placeBlock(el, origin, minLeft);
        return top === mark.top && left === mark.left ? mark : { ...mark, top, left };
      }),
    );
  }, [placeBlock]);

  /**
   * Finds the rendered blocks, matches them to units and marks them. `reset`
   * (new units) also clears the hover, focus and tap state; a re-mark of the
   * same units keeps them, its blocks sit at the same indices.
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
      }
      if (reset) {
        setHovered(null);
        setFocused(null);
        setRevealed(null);
      }
      if (units.length === 0) {
        elementsRef.current = [];
        marksRef.current = [];
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
      marksRef.current = next;
      setMarks(next);
      measure();
    },
    [units, measure],
  );

  // Mark the blocks when the units change. A layout effect: the markdown under
  // it has committed, and the ▶ is placed before paint.
  useLayoutEffect(() => mark(true), [mark]);

  // The pinned ▶ follows the playing unit in the same commit: placed before
  // paint whenever the playing unit, or the marks it is found among, change.
  useLayoutEffect(() => measurePin(), [measurePin, playingUnit, marks]);

  // The markdown can replace a subtree without its text changing — a component
  // identity changing under react-markdown (the wiki-link check resolving)
  // remounts a blockquote, a list — and the new nodes carry no marks while
  // `elementsRef` holds the detached old ones. So any node added or removed
  // under the body re-marks it, once per frame, and only when the speakable
  // blocks are no longer the ones marked: the ▶ layer's own renders, and the
  // marks' attributes, change nothing here. A body with no units (no key,
  // nothing speakable) has nothing to keep marked, so it gets no observer.
  const hasUnits = units.length > 0;
  useEffect(() => {
    const root = rootRef.current;
    if (!hasUnits || !root || typeof MutationObserver === "undefined") return;
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
  }, [mark, hasUnits]);

  // Re-place the buttons when the body changes size: a mermaid diagram that
  // finished rendering, a wider pane, a font that loaded — which can also move
  // the playing sentence to another line.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      measure();
      measurePin();
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure, measurePin]);

  const active = hovered ?? focused ?? revealed;
  const activeUnit = active === null ? null : (marks.find((m) => m.index === active)?.unit ?? null);

  // The caller's row outlines the segment the jump would land on.
  const hintRef = useRef(onHint);
  hintRef.current = onHint;
  useEffect(() => {
    if (!speechKey) return;
    hintRef.current?.(activeUnit);
  }, [speechKey, activeUnit]);
  useEffect(() => {
    if (!speechKey) return;
    return () => hintRef.current?.(null);
  }, [speechKey]);

  // A ▶ sits left of its block's text, often outside the block and the body's
  // box. On the way to it the pointer crosses an unmarked container or leaves
  // the body, so neither drops the ▶ at once: it goes after `LEAVE_GRACE`,
  // unless the pointer reaches a block or a ▶ first (the ▶ is the body's
  // descendant, so its mouseover lands here too).
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelLeave = () => {
    if (leaveTimer.current === null) return;
    clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  };
  const leaveLater = (drop: () => void) => {
    cancelLeave();
    leaveTimer.current = setTimeout(() => {
      leaveTimer.current = null;
      drop();
    }, LEAVE_GRACE);
  };
  useEffect(() => cancelLeave, []);

  const onMouseOver = (event: MouseEvent) => {
    const index = indexAt(event.target);
    if (index === null) {
      leaveLater(() => setHovered(null));
      return;
    }
    cancelLeave();
    setHovered(index);
  };
  // Leaving the body also drops a tap's reveal: a ▶ left shown (and its
  // segment outlined) after the pointer has gone elsewhere is stale.
  const onMouseLeave = () =>
    leaveLater(() => {
      setHovered(null);
      setRevealed(null);
    });
  // A tap has no hover to reveal the ▶ with: the tap itself reveals it, and a
  // hidden ▶ takes no pointer, so the first tap lands on the block. A mouse
  // click on a block does the same, harmlessly — the ▶ is already shown.
  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-play-from-here-layer]")) return;
    setRevealed(indexAt(target));
  };

  const pinLabel = paused ? "Play from here" : "Pause";

  return (
    <div
      ref={rootRef}
      data-play-from-here=""
      style={{ position: "relative" }}
      onMouseOver={speechKey ? onMouseOver : undefined}
      onMouseLeave={speechKey ? onMouseLeave : undefined}
      onClick={speechKey ? onClick : undefined}
    >
      {children}
      {speechKey && marks.length > 0 && (
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
                onPlay(mark.unit);
              }}
            >
              <Play size={12} />
            </button>
          ))}
          {pin && playingUnit !== null && (
            // Drawn after the block ▶s, so where it overlaps its own block's ▶
            // (a sentence on the block's first line) it is the one on top. It
            // carries no block index: hovering it reveals nothing else.
            <button
              key="pinned"
              type="button"
              data-testid="play-from-here-pinned"
              className="play-from-here"
              aria-label={pinLabel}
              title={pinLabel}
              data-shown=""
              data-playing={paused ? undefined : ""}
              style={{ position: "absolute", top: pin.top, left: pin.left }}
              onClick={(event) => {
                event.stopPropagation();
                if (paused) onPlay(playingUnit);
                else onPause();
              }}
            >
              {paused ? <Play size={12} /> : <Pause size={12} />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default PlayFromHere;
