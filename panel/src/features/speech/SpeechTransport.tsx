import { Pause, Play } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { segmentStateFor, subscribeUnitCache, unitCacheState, type SegmentState } from "./segmentState";
import type { CellSpeechState, SpeechUnit } from "./types";
import type { SpeechProgress } from "./useSpeechPlayer";

export interface SpeechTransportProps {
  /**
   * The suffix of every `data-testid` the transport renders — the session id
   * on a cell, the doc key on a page. Not a label: besides tests, only the
   * segment states read it, to ask a page's units of its audio cache.
   */
  id: string;
  /** The run's state for this key, from the host's `stateFor`. */
  state: CellSpeechState;
  /** The units of the utterance under the cursor — one scrubber segment each. */
  units: readonly SpeechUnit[];
  /** Measured unit lengths in seconds, from the host's `unitDurationsFor`. */
  durations: ReadonlyMap<number, number>;
  /** The playhead, from the host's `progressFor`; `null` when nothing plays. */
  progress: SpeechProgress | null;
  /**
   * The voice the units were synthesized in. The cache keys on voice + text,
   * so a segment read under any other voice would always look cold.
   */
  voice: string;
  /** A press of play/pause while the run is not playing and not paused. */
  onPlay: () => void;
  onPause: () => void;
  onResume: () => void;
  /** A click on a segment other than the playing one. */
  onJumpToUnit: (index: number) => void;
  /**
   * A press or drag inside the playing segment, in seconds into that unit.
   * Omitted, the playing segment is inert to the pointer.
   */
  onSeekWithinUnit?: (seconds: number) => void;
  /**
   * Every press of play/pause, BEFORE the intent is resolved — including a
   * press that resolves to nothing. The cell bar hangs its send-wait and
   * attention bookkeeping here; a surface without either omits it.
   */
  onPress?: () => void;
  /** Whether the play button pulses (`data-pulse`). Defaults to off. */
  pulse?: boolean;
  /** Whether a reply is on its way (`data-pending`). Defaults to off. */
  pending?: boolean;
  /**
   * Rendered between the play/pause button and the scrubber. The cell bar puts
   * its `next` control and a separator here, so the row's DOM order — and the
   * stylesheet and tests keyed on it — is unchanged by the extraction.
   */
  between?: ReactNode;
}

/**
 * Characters per second to assume before anything has been measured. Only the
 * RATIOS between segments matter, so this is not a claim about the voice — it
 * is the scale that lets a measured unit (seconds) and an unmeasured one
 * (characters) share one axis. Once any unit has reported a real duration the
 * measured rate replaces it, so the bar sharpens rather than jumping.
 */
const FALLBACK_CHARS_PER_SECOND = 15;

/**
 * A monotonic counter, and the whole of the transport's cache snapshot.
 *
 * Not a count of cache mutations: it is bumped inside the per-subscriber
 * callback, so N mounted transports advance it N times per mutation, and one
 * mounting or unmounting changes the step. Monotonic is the only property
 * `useSyncExternalStore` needs — it compares the snapshot with `Object.is` and
 * re-renders when it differs — so the number is deliberately left meaningless
 * beyond "this changed". Do not read it as a statistic.
 *
 * `useSyncExternalStore` compares snapshots by identity and throws "The result
 * of getSnapshot should be cached" — then loops to "Maximum update depth
 * exceeded" — for any snapshot built per call. A collection of segment states
 * is exactly that trap: a fresh array or Map every render. So the store's value
 * is this number, which is referentially stable by construction, and the states
 * themselves are read during render by `unitCacheState` — a Map lookup
 * and a property read, once per unit, cheap enough to pay on every pass.
 *
 * Module-level rather than per-transport because the two functions below are
 * handed to `useSyncExternalStore` directly: a hook argument that changed
 * identity on every render would re-subscribe on every render.
 */
let cacheVersion = 0;

function subscribeCacheVersion(onStoreChange: () => void): () => void {
  // Both caches: a page's units are read from the page audio cache first.
  return subscribeUnitCache(() => {
    cacheVersion += 1;
    onStoreChange();
  });
}

function readCacheVersion(): number {
  return cacheVersion;
}

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
 * The transport proper: the play/pause button and the segmented scrubber,
 * shared by the cell's {@link SpeechControlBar} and the document speech bar.
 * It knows nothing of arming, the queue, the answer pane or launchers — those
 * are the cell bar's, which passes what it needs in through the props and the
 * `between` slot.
 *
 * Returns a fragment, not a wrapper: the two controls sit directly in the
 * host's flex row, which is what the `.speech-bar-*` stylesheet expects.
 *
 * Why the scrubber is segmented, and why it is pointer-only and hidden from
 * assistive tech, is told on `SpeechControlBar` in
 * `features/terminal/SpeechControlBar.tsx`.
 */
export function SpeechTransport({
  id,
  state,
  units,
  durations,
  progress,
  voice,
  onPlay,
  onPause,
  onResume,
  onJumpToUnit,
  onSeekWithinUnit,
  onPress,
  pulse = false,
  pending = false,
  between,
}: SpeechTransportProps) {
  // Told, not asked. The transport reads the cache during render, and progress
  // was its only other re-render trigger — which bounds staleness to ~250ms
  // while playing and to nothing at all while paused or stalled, because
  // neither publishes. `cascadeWarm` checks `run.active`, which a pause does
  // not clear, so warming continues while the bar is frozen: a user who pauses
  // to read the screen would watch a bar that has stopped telling the truth,
  // and a stall is when they are watching it hardest. The value is discarded —
  // subscribing IS the point, and the states are read below.
  useSyncExternalStore(subscribeCacheVersion, readCacheVersion);

  const intent = transportIntent(state);
  const weights = segmentWeights(units, durations);
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  /** Nothing under the cursor yet — see the play button's `disabled`. */
  const silent = state === "empty";

  /** The segment a drag is in, while a drag is in progress. */
  const [dragging, setDragging] = useState<{ index: number; element: HTMLElement } | null>(null);
  // Latest-ref so the document listeners below never close over a stale seek.
  const seekRef = useRef<(clientX: number, index: number, element: HTMLElement) => void>(() => {});

  const segmentStateAt = (index: number): SegmentState => {
    // Read from the cache rather than tracked, because the warming cascade
    // fills it from two places (the host's arrival warm and the player's
    // ladder) and neither reports to the bar. The playhead-vs-cache rule itself
    // is shared with the answer pane's rail — see `segmentStateFor`.
    const state = segmentStateFor({
      index,
      playingIndex: progress?.unitIndex ?? null,
      // Keyed by `id`: a page's units ask its audio cache first.
      cache: unitCacheState(id, units[index], voice),
    });
    // A measured unit is one whose audio has been in the element: played, this
    // run, whether or not a run is still going. Only the bar has `durations`,
    // so this stays here; it never overrides the unit that is playing now.
    if (state !== "playing" && durations.has(index)) return "played";
    return state;
  };

  const seekAt = useCallback(
    (clientX: number, index: number, element: HTMLElement): void => {
      if (!onSeekWithinUnit) return;
      const rect = element.getBoundingClientRect();
      // jsdom — and a bar that has not been laid out yet — reports 0×0. A
      // fraction of nothing is not a position.
      if (!rect.width) return;

      const duration = progress?.unitDuration ?? durations.get(index) ?? null;
      // Nothing has said how long this unit is, so there is no second to seek
      // to. The click still had an effect: it is a jump, handled by `onClick`.
      if (duration === null) return;

      const fraction = clamp((clientX - rect.left) / rect.width, 0, 1);
      onSeekWithinUnit(fraction * duration);
    },
    [durations, progress, onSeekWithinUnit],
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
    <>
      <button
        type="button"
        title={PLAY_PAUSE_LABEL[state]}
        aria-label={PLAY_PAUSE_LABEL[state]}
        data-testid={`speech-bar-playpause-${id}`}
        data-speech={state}
        data-icon={intent}
        // Told by the host — see `data-pulse` on the cell bar for why the bar
        // caps what the header does not.
        data-pulse={pulse ? "1" : "0"}
        data-pending={pending ? "1" : "0"}
        className="speech-bar-btn speech-bar-primary"
        // Genuinely `disabled` when nothing has ever been under the cursor, and
        // only then. `empty` is not "on its way" — no press can put anything
        // there — so the control is taken out of the tab order too, rather than
        // being offered to a keyboard user as something to land on and fail to
        // work.
        //
        // `preparing` keeps `aria-disabled` alone: the audio IS on its way, so
        // the button is announced as not-yet-live without being made
        // unreachable while it lands. That is the whole difference between the
        // two, and it is why this is a `state` test and not an `intent` one —
        // both raise intent `none`.
        disabled={silent}
        aria-disabled={intent === "none" || undefined}
        onClick={() => {
          // Above the intent branch, so the host hears a press whatever it
          // resolves to — pause and nothing included.
          onPress?.();
          if (intent === "pause") onPause();
          else if (intent === "resume") onResume();
          else if (intent === "speak") onPlay();
        }}
      >
        {intent === "pause" ? <Pause size={16} /> : <Play size={16} />}
      </button>

      {between}

      <div
        className="speech-bar-scrub"
        data-testid={`speech-bar-scrubber-${id}`}
        // Nothing to draw, so nothing to keep the rail for. The strip is
        // `flex: 1` and carries a `min-width` wide enough to be a scrubber; on
        // a silent key it has no segments, and holding that width would be a
        // blank gap taking the space anything beside it is for. The stylesheet
        // collapses it on this attribute — see
        // `.speech-bar-scrub[data-empty="1"]`, and
        // `SpeechControlBar.alwaysTransport.test.tsx`, which measures what the
        // line can be squeezed to in both states.
        data-empty={silent ? "1" : undefined}
        // A pointer affordance, hidden from assistive tech — see the note on
        // `SpeechControlBar`. Announcing it would mean announcing one item per
        // unit, and an answer runs to fifteen of them.
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
              // No `role`, no `tabIndex`, no `aria-label`: this is a graphic a
              // mouse can act on, not a control. `title` stays — it is a hover
              // tooltip for the pointer user, and an `aria-hidden` subtree
              // never announces it.
              title={`Unit ${index + 1} of ${units.length}`}
              data-testid={`speech-bar-segment-${id}-${index}`}
              data-segment={segment}
              className="speech-bar-seg"
              style={{ width: `${width}%` }}
              onMouseDown={(e) => {
                // A drag belongs to the unit already in the element: it moves
                // `currentTime` and re-synthesizes nothing. Every other segment
                // is a jump, which `onClick` raises.
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
                onJumpToUnit(index);
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
    </>
  );
}

export default SpeechTransport;
