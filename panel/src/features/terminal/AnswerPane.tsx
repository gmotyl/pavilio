import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import MarkdownRenderer from "../markdown/MarkdownRenderer";
import { speechCacheState, subscribeSpeechCache } from "../speech/synth";
import type { GridSpeech } from "../speech/types";
import { utteranceUnderCursor } from "../speech/utteranceQueue";
import { getStoredVoice } from "../speech/voices";
import { matchUnitsToBlocks } from "./matchUnitsToBlocks";
import { segmentStateFor } from "./segmentState";

export interface AnswerPaneProps {
  sessionId: string;
  speech: GridSpeech;
  /**
   * Escape was pressed — inside the pane, anywhere outside a terminal, or in
   * this cell's own terminal (another cell's terminal keeps its Escape).
   * `TerminalView` closes the pane and refocuses the terminal.
   */
  onClose: () => void;
  /**
   * The cell's own "Open on new answer" switch, shown in the footer. Owned by
   * `TerminalView` — seeded from the browser-wide default at mount and never
   * written back to it — so the pane only reflects it and reports a flip.
   */
  autoOpen: boolean;
  onAutoOpenChange: (on: boolean) => void;
}

/**
 * A monotonic counter, and the whole of the pane's cache snapshot — the same
 * device `SpeechControlBar` uses, for the same reason: `useSyncExternalStore`
 * compares snapshots with `Object.is`, and a collection of segment states is a
 * fresh array every render, which it rejects as an uncached snapshot and loops
 * on. So the store's value is this number and the states themselves are read
 * during render, one cheap cache lookup per unit. Module-level because the two
 * functions are handed to the hook directly; per-pane closures would
 * re-subscribe on every render.
 */
let cacheVersion = 0;

function subscribeCacheVersion(onStoreChange: () => void): () => void {
  return subscribeSpeechCache(() => {
    cacheVersion += 1;
    onStoreChange();
  });
}

function readCacheVersion(): number {
  return cacheVersion;
}

/** The three attributes a matched block carries, and the one the spoken block adds. */
const BLOCK_ATTRIBUTES = ["data-unit", "role", "tabindex", "data-speaking"] as const;

/** The height of a segment whose unit has no block on screen. */
const MIN_SEGMENT_HEIGHT = 8;
/** The gap a segment leaves after the one before it when the two would touch or overlap. */
const SEGMENT_GAP = 2;

/** unit index → the blocks it was spoken from; see `matchUnitsToBlocks`. */
type UnitToBlocks = readonly (readonly number[])[];

/**
 * Places the rail's segments over their units' blocks — see the note on the
 * component. Reads the offsets of the rendered blocks (the direct children of
 * the body's `.prose`) and writes `top` / `height` onto the rail's children,
 * one per unit, in rail coordinates (the body is the `offsetParent` of both,
 * so the rail's own `offsetTop` is the only correction).
 *
 * A unit's span runs from the top of its first block to the bottom of its
 * last — over EVERY block it owns, not only the ones credited to it by
 * `data-unit`, because a block can belong to several units: a fast-start
 * "Hi." unit whose source is the whole first paragraph, and the next unit
 * that packs the rest of that paragraph. Spans therefore overlap, and the rail
 * resolves that monotonically: a segment never starts above the previous
 * one's end, `top = max(span.top, previousEnd + gap)`, so the second unit's
 * segment sits beside the remainder of the shared paragraph rather than on
 * top of the first unit's (smoke test, 2026-09-16). A unit with no block gets
 * {@link MIN_SEGMENT_HEIGHT} right after the previous segment's end.
 */
function layoutRail(
  body: HTMLElement | null,
  rail: HTMLElement | null,
  unitToBlocks: UnitToBlocks,
): void {
  if (!body || !rail) return;
  const segments = Array.from(rail.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  if (segments.length === 0) return;

  const prose = body.querySelector(".prose");
  const blocks = prose
    ? Array.from(prose.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
    : [];

  const origin = rail.offsetTop;
  // The first segment pays no gap.
  let previousEnd = -SEGMENT_GAP;
  segments.forEach((segment, index) => {
    let span: { top: number; bottom: number } | null = null;
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

    const floor = previousEnd + SEGMENT_GAP;
    const top = span ? Math.max(span.top, floor) : floor;
    const height = span ? Math.max(span.bottom - top, MIN_SEGMENT_HEIGHT) : MIN_SEGMENT_HEIGHT;
    segment.style.top = `${top}px`;
    segment.style.height = `${height}px`;
    previousEnd = top + height;
  });
}

/**
 * The cell's answer pane: the utterance under the cursor rendered as markdown
 * in a card under the speech bar, with the spoken block marked and a rail of
 * unit segments — the scrubber turned vertical — beside the text.
 *
 * ## Why it is an overlay
 *
 * The same rule the bar lives by, for the same reason. `TerminalView` runs
 * `new ResizeObserver(() => inst.fit())` with no coalescing, and `inst.fit()`
 * unconditionally refreshes the terminal AND sends a PTY resize — see the note
 * on `SpeechControlBar`. A pane in the cell's flexbox would hand that unfixed
 * bug a new trigger every time it opened or closed. So this is
 * `position: absolute` over the xterm, a SIBLING of the observed container:
 * nothing reflows, nothing refits, no resize frame is sent when it appears.
 *
 * ## Why the progress snapshot is the unit index only
 *
 * The host publishes progress on every `timeupdate`, ~4 Hz, for the whole
 * panel. The pane has one thing to do with that stream: move the mark when
 * the unit changes. So the store snapshot taken here is
 * `progressFor(sessionId)?.unitIndex ?? null` — a primitive, equal to itself
 * across every tick inside a unit — and `useSyncExternalStore` bails out of
 * the re-render entirely. A reader's eyes are on the text; nothing in the
 * body is rebuilt four times a second under them. The bar takes the whole
 * progress object because it draws the fill; the pane does not.
 *
 * ## Why block attributes are applied imperatively
 *
 * The blocks are react-markdown's output, and the mapping from units to
 * blocks is by text match on what it rendered (`matchUnitsToBlocks`), so the
 * marks cannot be expressed as props before render: nothing knows which `p`
 * is unit 2 until it exists. A layout effect after each render reads the
 * direct children of the renderer's `.prose` root, matches their
 * `textContent` against the units' `source`, and sets `data-unit`, `role`,
 * `tabindex` and `data-speaking` on the elements themselves. It first strips
 * those attributes from every child, because react-markdown reuses elements
 * across a content change and React never touches attributes it did not set.
 *
 * ## Why blocks are buttons and the rail segments are not
 *
 * The scrubber's segments claim no role and take no tab stop: fifteen phantom
 * buttons on a bar that is on by default would be noise (see the note on the
 * bar). The pane is different — it is opened deliberately, and its blocks are
 * already what the eye is on — so a matched block gets `role="button"`,
 * `tabIndex={0}` and Enter/Space, and a jump is one keystroke from reading.
 * The rail beside it mirrors the scrubber exactly: a pointer affordance, no
 * role, `aria-hidden`, with the same segment states from the same
 * `segmentStateFor`. Unmatched blocks — code, tables, diagrams, anything
 * speech turned into a sentinel — stay plain elements.
 *
 * ## Why the rail is laid out from the blocks, imperatively
 *
 * A segment spans its unit's blocks — from the top of the first to the bottom
 * of the last — so that the rail IS the text's outline and a click on it lands
 * where the eye expects. Those spans are `offsetTop` / `offsetHeight` of
 * react-markdown's elements, known only after layout, so they are written
 * onto the segments as `style.top` / `style.height` in the same layout effect
 * that marks the blocks, and again whenever the body or the text column
 * changes size (a lazy mermaid diagram arriving, the cell resizing). The rail
 * column is a grid item beside the text, stretched to the text's height and
 * scrolling with it, and the body is the `offsetParent` of both — so a block's
 * `offsetTop` is at once its rail coordinate and its scroll target. A unit no
 * block was rendered from (a sentinel-only paragraph) keeps a minimum 8px
 * segment placed right after the previous one, so the rail never loses a unit.
 *
 * ## Why the pane scrolls once per unit, and never on a tick
 *
 * Following is a `useEffect` on the unit index alone. When the index changes
 * (or the pane mounts mid-run, which is the same moment for a pane that was
 * closed), and only when the body overflows, it scrolls the body so the
 * unit's first block sits a third of the way down. No `scroll` listener, no
 * follow state: a reader who scrolls ahead is left alone until the next unit
 * starts — the one moment being pulled back is what the reader wants.
 */
export function AnswerPane({
  sessionId,
  speech,
  onClose,
  autoOpen,
  onAutoOpenChange,
}: AnswerPaneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  /** The last mapping the marks were drawn from, for a re-layout the observer asks for. */
  const unitToBlocksRef = useRef<UnitToBlocks>([]);

  const answer = utteranceUnderCursor(speech.queueFor(sessionId));
  const units = speech.unitsFor(sessionId);

  // Unit index ONLY — see the note on the component. Null for every cell but
  // the one running, which is also the shared bail-out value.
  const unitIndex = useSyncExternalStore(
    speech.subscribeProgress,
    () => speech.progressFor(sessionId)?.unitIndex ?? null,
  );
  // Told, not asked: the rail reads the cache during render, and the cascade
  // fills it from places the pane cannot see. The value is discarded —
  // subscribing IS the point.
  useSyncExternalStore(subscribeCacheVersion, readCacheVersion);

  const voice = getStoredVoice();
  const text = answer?.text ?? "";

  // Focus lands on the root the moment it opens — also when it opened itself —
  // so Escape works at once and the read → Escape → type loop needs no mouse.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // Escape closes the pane from wherever focus is while it is open —
  // switching browser tabs and coming back leaves it on `document.body`, a
  // click leaves it on the bar or in the cell's own terminal — and a pane
  // that then ignores Escape reads as stuck. Greg's rule (2026-09-16): if the
  // terminal has focus and the pane is open, Escape closes the pane.
  //
  // Capture phase on `window`, not a bubble listener on `document`: xterm
  // reads keys from its own textarea's `keydown` handler, at the target, and
  // a key that reached it is already in the PTY by the time it bubbles.
  // Capture on the window runs before the target phase, so `preventDefault` +
  // `stopPropagation` here means the shell never sees the key. The accepted
  // cost for a TUI that uses Escape (Claude Code interrupts on it): the first
  // Escape closes the pane, the second interrupts — one deliberate keystroke
  // more, in exchange for a pane that always answers the key it advertises.
  //
  // Only THIS cell's terminal, though. The pane is mounted by `TerminalView`
  // as a sibling of the xterm container inside the cell's `relative`
  // wrapper, so an xterm under the root's parent is the cell's own; an xterm
  // anywhere else is another cell's TUI, and its Escape is left alone.
  //
  // An Escape inside the pane never gets here: it is the root's own handler's
  // below, which stops propagation, so `onClose` runs once per keypress.
  useEffect(() => {
    const onWindowKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      const target = e.target instanceof Element ? e.target : null;
      const root = rootRef.current;
      if (root && target && root.contains(target)) return;
      const xterm = target?.closest(".xterm") ?? null;
      if (xterm && !root?.parentElement?.contains(xterm)) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onWindowKeyDown, true);
    return () => window.removeEventListener("keydown", onWindowKeyDown, true);
  }, [onClose]);

  // Mark the blocks. Re-run when the text, the units or the spoken unit
  // change; a tick inside a unit never gets here because the snapshot above
  // did not change.
  useLayoutEffect(() => {
    const prose = bodyRef.current?.querySelector(".prose");
    if (!prose) return;
    const children = Array.from(prose.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    // Strip first: react-markdown reuses elements across a content change,
    // and React leaves attributes it did not set exactly where they were.
    for (const child of children) {
      for (const attribute of BLOCK_ATTRIBUTES) child.removeAttribute(attribute);
    }

    const { blockToUnit, unitToBlocks } = matchUnitsToBlocks(
      units,
      children.map((child) => child.textContent ?? ""),
    );
    unitToBlocksRef.current = unitToBlocks;
    children.forEach((child, blockIndex) => {
      const unit = blockToUnit[blockIndex];
      if (unit === null) return;
      child.setAttribute("data-unit", String(unit));
      child.setAttribute("role", "button");
      child.setAttribute("tabindex", "0");
      if (unit === unitIndex) child.setAttribute("data-speaking", "");
    });
    // The marks moved or the text changed: the rail follows in the same commit.
    layoutRail(bodyRef.current, railRef.current, unitToBlocks);
  }, [text, units, unitIndex]);

  // Re-lay the rail when the body or the text column changes size — see the
  // note on the component. The pane's own boxes, never the xterm container.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const observer = new ResizeObserver(() =>
      layoutRail(body, railRef.current, unitToBlocksRef.current),
    );
    observer.observe(body);
    if (textRef.current) observer.observe(textRef.current);
    return () => observer.disconnect();
  }, []);

  // Follow the voice: once per unit, on the boundary or on a mid-run mount,
  // and only when there is somewhere to scroll to. Never on a tick — the
  // snapshot above does not change inside a unit, so this never runs then.
  useEffect(() => {
    const body = bodyRef.current;
    if (unitIndex === null || !body) return;
    if (body.scrollHeight <= body.clientHeight) return;
    const block = body.querySelector<HTMLElement>(`[data-unit="${unitIndex}"]`);
    if (!block) return;
    body.scrollTo({ top: Math.max(0, block.offsetTop - body.clientHeight / 3) });
  }, [unitIndex]);

  const jumpTo = useCallback(
    (unit: number): void => {
      speech.onJumpToUnit(sessionId, unit);
    },
    [speech, sessionId],
  );

  /** The matched block an event happened in, if any. */
  const blockOf = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const block = target.closest<HTMLElement>("[data-unit]");
    return block && bodyRef.current?.contains(block) ? block : null;
  };

  return (
    <div
      ref={rootRef}
      className="answer-pane"
      data-testid={`answer-pane-${sessionId}`}
      role="region"
      aria-label="Answer"
      tabIndex={-1}
      // The cell header is `draggable` and the cell root focuses on click, so
      // every gesture that could reach either has to stop here — as on the bar.
      draggable={false}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        ref={bodyRef}
        className="answer-pane-body"
        data-testid={`answer-pane-body-${sessionId}`}
        // Delegated: the blocks are react-markdown's elements, so their
        // handlers live here, on the ancestor that outlives them.
        onClick={(e) => {
          const block = blockOf(e.target);
          if (block) jumpTo(Number(block.dataset.unit));
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          const block = blockOf(e.target);
          if (!block || block !== e.target) return;
          // Space would scroll the body; the block is a button now.
          if (e.key === " ") e.preventDefault();
          jumpTo(Number(block.dataset.unit));
        }}
      >
        {/* The scrubber turned vertical: a pointer affordance, not a row of
            buttons — see the note on the component. Each segment is placed by
            `layoutRail` to span its unit's blocks. */}
        <div ref={railRef} className="answer-pane-rail" aria-hidden="true">
          {units.map((unit, index) => {
            const state = segmentStateFor({
              index,
              playingIndex: unitIndex,
              cache: speechCacheState(unit.text, { voice }),
            });
            return (
              <div
                key={index}
                className="answer-pane-seg"
                data-segment={state}
                data-testid={`answer-pane-seg-${sessionId}-${index}`}
                title={`Unit ${index + 1} of ${units.length}`}
                onClick={() => jumpTo(index)}
              >
                {state === "playing" ? (
                  <span className="answer-pane-head" data-testid={`answer-pane-head-${sessionId}`} />
                ) : null}
              </div>
            );
          })}
        </div>
        <div ref={textRef} className="answer-pane-text">
          {answer ? <MarkdownRenderer content={answer.text} /> : null}
        </div>
      </div>
      {/* One row under the body, inside the card and outside the scroll
          container, so it stays put while the text scrolls. The pane's only
          control besides the text. */}
      <div className="answer-pane-footer">
        <label className="answer-pane-footer-label" htmlFor={`answer-pane-auto-open-${sessionId}`}>
          <input
            id={`answer-pane-auto-open-${sessionId}`}
            data-testid={`answer-pane-auto-open-${sessionId}`}
            type="checkbox"
            checked={autoOpen}
            onChange={() => onAutoOpenChange(!autoOpen)}
          />
          Open on new answer
        </label>
      </div>
    </div>
  );
}
