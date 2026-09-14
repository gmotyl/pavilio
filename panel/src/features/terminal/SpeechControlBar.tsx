import { Pause, Play, Radio, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isSpeechSynthesized } from "../speech/synth";
import type { CellSpeechState, GridSpeech, SpeechUnit } from "../speech/types";
import { getStoredVoice } from "../speech/voices";

export interface SpeechControlBarProps {
  sessionId: string;
  /** The panel's one speech host. See {@link GridSpeech}. */
  speech: GridSpeech;
}

/**
 * A scrubber segment's state. Four, and not one more: clicking a cold segment
 * is allowed and reports the existing `stalled` red — "blocked on synthesis,
 * more is coming" — rather than inventing a fifth colour for a wait the panel
 * already has a word for.
 */
type SegmentState = "played" | "playing" | "ready" | "cold";

/**
 * Characters per second to assume before anything has been measured. Only the
 * RATIOS between segments matter, so this is not a claim about the voice — it
 * is the scale that lets a measured unit (seconds) and an unmeasured one
 * (characters) share one axis. Once any unit has reported a real duration the
 * measured rate replaces it, so the bar sharpens rather than jumping.
 */
const FALLBACK_CHARS_PER_SECOND = 15;

/** How long a unit is, in seconds — measured where it can be, estimated where not. */
function segmentWeights(
  units: readonly SpeechUnit[],
  durations: ReadonlyMap<number, number>,
): number[] {
  let measuredChars = 0;
  let measuredSeconds = 0;
  units.forEach((unit, index) => {
    const duration = durations.get(index);
    if (duration !== undefined && duration > 0) {
      measuredChars += unit.chars;
      measuredSeconds += duration;
    }
  });

  const rate = measuredSeconds > 0 ? measuredChars / measuredSeconds : FALLBACK_CHARS_PER_SECOND;

  return units.map((unit, index) => {
    const duration = durations.get(index);
    if (duration !== undefined) return duration;
    return Math.max(unit.chars, 1) / rate;
  });
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Per state, because two states raising the same intent still differ in why. */
const PLAY_PAUSE_LABEL: Record<CellSpeechState, string> = {
  empty: "Nothing to speak yet",
  preparing: "Preparing the audio…",
  ready: "Speak the last response",
  speaking: "Pause speaking",
  stalled: "Pause — waiting for the voice",
  paused: "Resume speaking",
  heard: "Replay the last response",
};

/** What a click on the play/pause control does, independently of the colour. */
function transportIntent(state: CellSpeechState): "speak" | "pause" | "resume" | "none" {
  if (state === "speaking" || state === "stalled") return "pause";
  if (state === "paused") return "resume";
  if (state === "empty" || state === "preparing") return "none";
  return "speak";
}

/**
 * The cell's speech transport: layout **A** of
 * `projects/pavilio/mockups/2026-09-14-speech-control-bar-options.html` — one
 * 56px rail with 44px tap targets carrying, in this order, autoplay, previous,
 * play/pause, next, the segmented scrubber, and the position inside the
 * utterance.
 *
 * ## Why it is an overlay
 *
 * `TerminalView` runs `new ResizeObserver(() => inst.fit())` with no
 * coalescing, and `inst.fit()` unconditionally calls `terminal.refresh()` AND
 * sends a PTY resize even when the dimensions did not change — the parked
 * `terminal-resize-discipline` change exists because codex already misbehaves
 * across layout changes. A bar in the cell's flexbox would put speech controls
 * on top of that unfixed bug and hand it a new trigger on every toggle. So this
 * is `position: absolute` over the xterm, a SIBLING of the observed container
 * rather than a child of it: nothing reflows, nothing refits, no resize frame
 * is sent. `SpeechControlBar.test.tsx` asserts that against the real `fit`.
 *
 * Being on by default is survivable because it sits at the **top**: it covers
 * the oldest rows, while a TUI's live prompt is at the bottom.
 *
 * ## Why the scrubber is segmented
 *
 * A response is many synthesized units swapped through one `<audio>` element,
 * not one file, so there is no single timeline and no total duration until
 * everything has been synthesized — which is exactly the up-front cost the fast
 * start exists to avoid. The axis is therefore **units**, one segment each,
 * present from the moment the utterance arrives.
 *
 * ## Why the scrubber is pointer-only, and hidden from assistive tech
 *
 * The segments carried `role="button"` with `tabIndex={-1}` and no key
 * handler. WAI-ARIA defines that role as focusable and Enter/Space operable, so
 * the markup announced an action to a screen reader and then did not expose
 * it — the announcement is the promise, and this one was not kept.
 *
 * The honest alternative was to make them real: `tabIndex={0}` plus a keydown
 * mapping Enter/Space to the jump. Rejected on the grid. An answer of fifteen
 * units is fifteen tab stops inside ONE cell's bar, and the panel tiles many
 * cells — crossing the grid by keyboard would mean tabbing through every unit
 * of every answer on screen, to reach a function the keyboard already has.
 *
 * Because it does have it. `previous` and `next` are real buttons with
 * accessible names, and `Ctrl+Shift+←/→` walks the queue from anywhere
 * (`features/speech/useSpeechKeys`, which `terminalInstances` withholds from
 * the PTY so a focused terminal cannot swallow it). What the segments add over
 * that is per-unit jumping and a drag-seek — a refinement of a reachable
 * function, and a drag has no keyboard spelling anyway.
 *
 * So the scrubber claims no role, takes no tab stop, and the whole strip is
 * `aria-hidden`: a decorative rendering of a position, not fifteen phantom
 * buttons. The position readout next to it stays announced, because "2/3" is
 * the information; the segments were only ever the affordance.
 */
export function SpeechControlBar({ sessionId, speech }: SpeechControlBarProps) {
  const state = speech.stateFor(sessionId);
  const queue = speech.queueFor(sessionId);
  const units = speech.unitsFor(sessionId);

  // The playhead moves ~4 times a second, and one host serves the whole panel.
  // Read as a field it would re-render every cell in the grid at that rate for
  // the one cell that is speaking, so it is an external store instead: each bar
  // takes its own snapshot, and a snapshot that did not change re-renders
  // nothing. Every cell but the speaking one holds the shared `null` and the
  // shared empty map, which is exactly what makes that bail-out work.
  const progress = useSyncExternalStore(speech.subscribeProgress, () =>
    speech.progressFor(sessionId),
  );
  // Sourced here rather than from `progress`: a finished run has no playhead
  // and still has a timeline, and a scrubber that fell back to character
  // estimates the moment the audio stopped would throw away what it learned.
  const durations = useSyncExternalStore(speech.subscribeProgress, () =>
    speech.unitDurationsFor(sessionId),
  );

  const armed = speech.armedSessionId === sessionId;
  const intent = transportIntent(state);
  const weights = segmentWeights(units, durations);
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  const hasPrevious = queue.previous !== null && queue.cursor === "current";
  const hasNext = queue.cursor === "previous" || queue.pending.length > 0;

  /** The segment a drag is in, while a drag is in progress. */
  const [dragging, setDragging] = useState<{ index: number; element: HTMLElement } | null>(null);
  // Latest-ref so the document listeners below never close over a stale seek.
  const seekRef = useRef<(clientX: number, index: number, element: HTMLElement) => void>(() => {});

  const voice = getStoredVoice();

  const segmentStateAt = (index: number): SegmentState => {
    if (progress && index === progress.unitIndex) return "playing";
    if (progress && index < progress.unitIndex) return "played";
    // A measured unit is one whose audio has been in the element: played, this
    // run, whether or not a run is still going.
    if (durations.has(index)) return "played";
    // Warm: in the synthesis cache, so a click starts with no wait. Read from
    // the cache rather than tracked, because the warming cascade fills it from
    // two places (the host's arrival warm and the player's ladder) and neither
    // reports to the bar.
    if (isSpeechSynthesized(units[index]?.text ?? "", { voice })) return "ready";
    return "cold";
  };

  const seekAt = useCallback(
    (clientX: number, index: number, element: HTMLElement): void => {
      const rect = element.getBoundingClientRect();
      // jsdom — and a bar that has not been laid out yet — reports 0×0. A
      // fraction of nothing is not a position.
      if (!rect.width) return;

      const duration = progress?.unitDuration ?? durations.get(index) ?? null;
      // Nothing has said how long this unit is, so there is no second to seek
      // to. The click still had an effect: it is a jump, handled by `onClick`.
      if (duration === null) return;

      const fraction = clamp((clientX - rect.left) / rect.width, 0, 1);
      speech.onSeekWithinUnit(sessionId, fraction * duration);
    },
    [durations, progress, sessionId, speech],
  );
  seekRef.current = seekAt;

  useEffect(() => {
    if (!dragging) return;

    const move = (event: MouseEvent): void => {
      seekRef.current(event.clientX, dragging.index, dragging.element);
    };
    const up = (event: MouseEvent): void => {
      seekRef.current(event.clientX, dragging.index, dragging.element);
      setDragging(null);
    };

    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
  }, [dragging]);

  return (
    <div
      className="speech-bar"
      data-testid={`speech-bar-${sessionId}`}
      // The cell header is `draggable` and the cell root focuses on click, so
      // every gesture that could reach either has to stop here.
      draggable={false}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="speech-bar-row">
        <button
          type="button"
          role="switch"
          aria-checked={armed}
          title={armed ? "Autoplay armed — speak responses here" : "Autoplay off — arm this cell"}
          aria-label={armed ? "Autoplay armed — speak responses here" : "Autoplay off — arm this cell"}
          data-testid={`speech-bar-autoplay-${sessionId}`}
          data-armed={armed ? "1" : "0"}
          className="speech-bar-btn"
          onClick={() => speech.onArm(armed ? null : sessionId)}
        >
          <Radio size={17} />
        </button>

        <span className="speech-bar-sep" />

        <button
          type="button"
          title="Previous answer"
          aria-label="Previous answer"
          data-testid={`speech-bar-previous-${sessionId}`}
          className="speech-bar-btn"
          disabled={!hasPrevious}
          onClick={() => speech.onPrevious(sessionId)}
        >
          <SkipBack size={16} />
        </button>

        <button
          type="button"
          title={PLAY_PAUSE_LABEL[state]}
          aria-label={PLAY_PAUSE_LABEL[state]}
          data-testid={`speech-bar-playpause-${sessionId}`}
          data-speech={state}
          data-icon={intent}
          className="speech-bar-btn speech-bar-primary"
          disabled={state === "empty"}
          aria-disabled={intent === "none" || undefined}
          onClick={() => {
            if (intent === "pause") speech.onPause(sessionId);
            else if (intent === "resume") speech.onResume(sessionId);
            else if (intent === "speak") speech.onSpeak(sessionId);
          }}
        >
          {intent === "pause" ? <Pause size={16} /> : <Play size={16} />}
        </button>

        <button
          type="button"
          title="Next answer"
          aria-label="Next answer"
          data-testid={`speech-bar-next-${sessionId}`}
          className="speech-bar-btn"
          disabled={!hasNext}
          onClick={() => speech.onNext(sessionId)}
        >
          <SkipForward size={16} />
        </button>

        <span className="speech-bar-sep" />

        <div
          className="speech-bar-scrub"
          data-testid={`speech-bar-scrubber-${sessionId}`}
          // A pointer affordance, hidden from assistive tech — see the note on
          // the component. Announcing it would mean announcing one item per
          // unit, and an answer runs to fifteen of them. The position readout
          // beside it is what a screen reader is given instead, and it stays.
          aria-hidden="true"
        >
          {units.map((_unit, index) => {
            const segment = segmentStateAt(index);
            const width = total > 0 ? (weights[index] / total) * 100 : 100 / units.length;
            const fill =
              segment === "playing" && progress?.unitDuration
                ? clamp(progress.unitTime / progress.unitDuration, 0, 1) * 100
                : 0;

            return (
              <div
                // Index is the identity here: the segment IS unit n of this
                // utterance, and a re-prepare rebuilds the array in place.
                key={index}
                // No `role`, no `tabIndex`, no `aria-label`: this is a
                // graphic a mouse can act on, not a control. `title` stays —
                // it is a hover tooltip for the pointer user, and an
                // `aria-hidden` subtree never announces it.
                title={`Unit ${index + 1} of ${units.length}`}
                data-testid={`speech-bar-segment-${sessionId}-${index}`}
                data-segment={segment}
                className="speech-bar-seg"
                style={{ width: `${width}%` }}
                onMouseDown={(e) => {
                  // A drag belongs to the unit already in the element: it moves
                  // `currentTime` and re-synthesizes nothing. Every other
                  // segment is a jump, which `onClick` raises.
                  if (segment !== "playing") return;
                  e.preventDefault();
                  const element = e.currentTarget;
                  setDragging({ index, element });
                  seekAt(e.clientX, index, element);
                }}
                onClick={() => {
                  if (segment === "playing") return;
                  // Cold included, deliberately: the run reports the existing
                  // `stalled` red until the unit lands, and then plays it.
                  speech.onJumpToUnit(sessionId, index);
                }}
              >
                {segment === "playing" ? (
                  <>
                    <span className="speech-bar-fill" style={{ width: `${fill}%` }} />
                    <span className="speech-bar-head" style={{ left: `${fill}%` }} />
                  </>
                ) : null}
              </div>
            );
          })}
        </div>

        {units.length > 0 ? (
          <span className="speech-bar-meta" data-testid={`speech-bar-position-${sessionId}`}>
            {(progress?.unitIndex ?? 0) + 1}/{units.length}
          </span>
        ) : null}

        {queue.pending.length > 0 ? (
          <span className="speech-bar-pill" data-testid={`speech-bar-queue-${sessionId}`}>
            +{queue.pending.length}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default SpeechControlBar;
export type { SegmentState };
