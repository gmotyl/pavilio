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
  /** Escape was pressed inside the pane. `TerminalView` closes it and refocuses the terminal. */
  onClose: () => void;
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
 */
export function AnswerPane({ sessionId, speech, onClose }: AnswerPaneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

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

    const { blockToUnit } = matchUnitsToBlocks(
      units,
      children.map((child) => child.textContent ?? ""),
    );
    children.forEach((child, blockIndex) => {
      const unit = blockToUnit[blockIndex];
      if (unit === null) return;
      child.setAttribute("data-unit", String(unit));
      child.setAttribute("role", "button");
      child.setAttribute("tabindex", "0");
      if (unit === unitIndex) child.setAttribute("data-speaking", "");
    });
  }, [text, units, unitIndex]);

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
            buttons — see the note on the component. Equal heights for now;
            spanning each unit's blocks is the follow step. */}
        <div className="answer-pane-rail" aria-hidden="true">
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
        <div className="answer-pane-text">
          {answer ? <MarkdownRenderer content={answer.text} /> : null}
        </div>
      </div>
    </div>
  );
}
