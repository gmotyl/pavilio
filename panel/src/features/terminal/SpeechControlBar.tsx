import { Eye, Pause, Play, Radio, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { speechCacheState, subscribeSpeechCache } from "../speech/synth";
import { LauncherPills } from "./LauncherPills";
import {
  holdAnswer,
  noteNewestAnswer,
  noteSpeaking,
  noteTransport,
  noteUtterance,
  releaseAnswer,
  useAnswerWaiting,
} from "./answerWaiting";
import { segmentStateFor, type SegmentState } from "./segmentState";
import { dismissAttentionOnArrival } from "./attentionArrival";
import { speechPulse } from "./CellSpeakButton";
import { useReadyPulseWindow } from "../speech/useReadyPulseWindow";
import { utteranceUnderCursor } from "../speech/utteranceQueue";
import type { CellSpeechState, GridSpeech, SpeechUnit } from "../speech/types";
import { getStoredVoice } from "../speech/voices";

export interface SpeechControlBarProps {
  sessionId: string;
  /** The panel's one speech host. See {@link GridSpeech}. */
  speech: GridSpeech;
  /** Whether the cell's answer pane is open — the eye's pressed state. Owned by `TerminalView`. */
  answerOpen: boolean;
  /** The eye was pressed: open the pane if it is closed, close it if it is open. */
  onToggleAnswer: () => void;
  /**
   * The cell's PTY write, for the launcher pills the row carries before the
   * cell has spoken.
   *
   * REQUIRED, like `speech` on the surfaces: the pills are the whole of the
   * row's contents on a silent cell, and a host that forgot to pass this would
   * render pills that look live and do nothing when clicked — a failure no
   * test of the bar alone can see. A no-op default would buy exactly that.
   *
   * It reports whether the frame reached an OPEN socket, which is how a pill
   * on a dead cell says so instead of flashing and doing nothing.
   */
  send: (data: string) => boolean;
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
 * A monotonic counter, and the whole of the bar's cache snapshot.
 *
 * Not a count of cache mutations: it is bumped inside the per-subscriber
 * callback, so N mounted bars advance it N times per mutation, and a bar
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
 * themselves are read during render by {@link speechCacheState} — a Map lookup
 * and a property read, once per unit, cheap enough to pay on every pass.
 *
 * Module-level rather than per-bar because the two functions below are handed
 * to `useSyncExternalStore` directly: a hook argument that changed identity on
 * every render would re-subscribe on every render.
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
 * ## Why it is a row in flow, reserved from mount
 *
 * `TerminalView` runs `new ResizeObserver(() => inst.fit())` with no
 * coalescing, and `inst.fit()` unconditionally calls `terminal.refresh()` AND
 * sends a PTY resize even when the dimensions did not change — the parked
 * `terminal-resize-discipline` change exists because codex already misbehaves
 * across layout changes. A control that APPEARED mid-stream would put speech on
 * top of that unfixed bug and SIGWINCH a TUI while it was still writing. The
 * bar was `position: absolute` over the xterm to avoid exactly that.
 *
 * It is now a row in the cell's column instead, rendered from the moment the
 * cell mounts whether or not it has ever spoken. That spends the height before
 * any utterance can arrive, so the same trigger never fires: the observed
 * container is settled at mount. The row remains a SIBLING of that container,
 * never a child, and the only thing that still changes its size is the user's
 * own hide toggle — a deliberate act, where `TerminalView` answers with a
 * single fit that follows the bottom. `SpeechControlBar.test.tsx` and
 * `TerminalView.speechRow.test.tsx` assert that against the real `fit`.
 *
 * What changes on a first utterance is therefore the row's CONTENTS, not its
 * existence — and since the strip stopped being conditional (see the note on
 * the transport below) the only content that comes and goes is the launcher
 * pills the row carries while the cell's state is `empty`. They share the line
 * with the strip rather than replacing it, and the scrubber yields them the
 * rail while it has nothing to draw. See the JSX, `LauncherPills.test.tsx` and
 * `SpeechControlBar.alwaysTransport.test.tsx`, which measures the row's height
 * and the floor of its flex line in both states against the real stylesheet.
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
 * buttons. The position is still announced, because "unit 2 of 3" is the
 * information and the segments were only ever the affordance — but it is
 * announced from the eye, the button beside the strip that opens the answer
 * pane: its accessible name is "Answer, unit 2 of 3". That name is the ONLY
 * place the position is spoken now; the `n/N` readout it replaced is gone, so
 * the wording is not decoration and a change to it is a change to what a
 * screen reader is told. The name is STABLE across open and closed: the state
 * rides in `aria-pressed`, per the WAI-ARIA toggle-button pattern. A name that
 * flipped between "Show" and "Hide" on top of `aria-pressed` would announce
 * the state twice, and could drift from it.
 *
 * Before the first answer there is no position to carry, and the derivation
 * would read "Answer, unit 1 of 0" — a sentence that is not false so much as
 * meaningless. So the name falls back to "Answer, nothing spoken yet", which
 * is the same fact the transport beside it states by being disabled. It is
 * pinned, like the position, because the name is the only place either is
 * spoken.
 */
export function SpeechControlBar({
  sessionId,
  speech,
  answerOpen,
  onToggleAnswer,
  send,
}: SpeechControlBarProps) {
  const state = speech.stateFor(sessionId);
  // Only the mark: whether the pane's BODY has handed over is the pane's
  // business, and the bar draws the same fact one control smaller.
  const { pending } = useAnswerWaiting(sessionId);
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
  // Told, not asked. The bar reads the cache during render, and progress was
  // its only other re-render trigger — which bounds staleness to ~250ms while
  // playing and to nothing at all while paused or stalled, because neither
  // publishes. `cascadeWarm` checks `run.active`, which a pause does not clear,
  // so warming continues while the bar is frozen: a user who pauses to read the
  // screen would watch a bar that has stopped telling the truth, and a stall is
  // when they are watching it hardest. The value is discarded — subscribing IS
  // the point, and the states are read below.
  useSyncExternalStore(subscribeCacheVersion, readCacheVersion);

  // Ten seconds from the moment this answer became ready — see the play
  // button's `data-pulse` below for why the bar is capped and the header is
  // not. Keyed on the utterance under the cursor, so a newer answer is a new
  // arrival and gets its own window.
  //
  // The `&&` below leans on an invariant of `stateFor` in
  // `features/speech/useUtteranceChannel.ts`: a session with nothing under the
  // cursor is reported `empty`, never `ready`. So on the only path where this
  // window decides anything — `state === "ready"` — there IS a cursor utterance
  // and the key is never null; a null key means the window is inactive anyway.
  const answerId = utteranceUnderCursor(queue)?.id ?? null;
  const withinReadyPulse = useReadyPulseWindow(state === "ready", answerId);

  // The reply landing, noticed HERE rather than in the pane. The queue is not a
  // store anything subscribes to — the host's identity changes when an
  // utterance arrives and the whole cell re-renders — so the arrival has to be
  // read off a render, and it has to be a render that still happens once the
  // user has closed the pane. This row is that render: Task 3 made it present
  // from mount and independent of speech state, and `TerminalView` mounts the
  // pane only INSIDE the row's own condition, so the bar outlives the pane by
  // construction and never misses an arrival the pane would have seen.
  //
  // A remount with the same answer is the same id, and ends nothing; a wait
  // belonging to another cell is untouched, because the id read here is the one
  // under THIS session's cursor.
  useEffect(() => {
    noteUtterance(sessionId, answerId);
  }, [sessionId, answerId]);

  /**
   * The newest answer the cell HOLDS — not the one under the cursor.
   *
   * `queue.current?.id` alone would be wrong, and wrong in exactly the case
   * the hold exists for: an answer arriving while the voice is reading takes
   * the reducer's `speaking: true` arm, which appends to `pending` and leaves
   * `current` where it was. A listener who stepped back to re-read while the
   * agent was still talking would never be told the answer landed.
   *
   * `pending` is oldest-first, so its LAST entry is the newest thing the cell
   * has been given.
   */
  const newestAnswerId = queue.pending.at(-1)?.id ?? queue.current?.id ?? null;

  // The arrival, pushed on every queue change. `answerWaiting` absorbs the
  // first push per session as SEEDING — an entry that has never been told
  // where the cell stands cannot tell an arrival from a starting point — so
  // there is nothing to seed by hand here; there is only the duty to push
  // every time.
  //
  // `true` back means that arrival released a hold, and the cursor is then
  // ours to move: the store owns the hold, this row owns the cursor, and
  // neither reaches into the other. Declared BEFORE the speaking effect below
  // so the session's entry exists by the time that one pushes into it.
  useEffect(() => {
    if (noteNewestAnswer(sessionId, newestAnswerId)) speech.onNewestAnswer(sessionId);
  }, [sessionId, newestAnswerId, speech]);

  /**
   * Whether this cell's voice is reading — the one fact `answerWaiting` needs
   * and may not go and get (see its header: every arrow into that module
   * points the same way).
   *
   * `speaking` and `stalled` both count. A stalled run is a run the listener
   * is inside: more of the same answer is coming, the pause is still theirs to
   * press, and an agent going busy behind it must not pull the text out from
   * under the sentence. `paused` does NOT count — a held run is not
   * mid-sentence, so there is nothing for the handover to be patient about.
   */
  const voiceIsReading = state === "speaking" || state === "stalled";

  // The DEPENDENCY is the predicate, not the state: `speaking → stalled` is
  // the same answer to this question, and re-running the effect across it
  // would push a `false` through the cleanup and drop a deferral that is still
  // waiting on a sentence that has not finished.
  useEffect(() => {
    noteSpeaking(sessionId, voiceIsReading);
    // A cell torn out of the grid mid-sentence — a layout change, a preset, a
    // maximize — must not leave a `true` standing behind it: nothing would
    // ever push the matching `false`, and every later handover for that
    // session would defer against a playback no surface is watching.
    return () => noteSpeaking(sessionId, false);
  }, [sessionId, voiceIsReading]);

  const armed = speech.armedSessionId === sessionId;
  const intent = transportIntent(state);
  const weights = segmentWeights(units, durations);
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  // The transport's two ends, asked of the CURSOR rather than of the lists.
  // While history was a single slot the question was "is the slot full, and
  // has the cursor not already been spent on it"; now that it is a list there
  // is only one question — does the cursor still have a step left to take —
  // and it has to be the same question the reducer's own no-op guards ask. A
  // rail that asks it any other way either offers a press that does nothing or
  // refuses one that would have worked, and neither is visible to the type
  // checker: `previous` is an array, so the old `!== null` half is true
  // forever and would leave `hasPrevious` permanently reading `cursor === 0`.
  const hasPrevious = queue.cursor < queue.previous.length;
  const hasNext = queue.cursor > 0 || queue.pending.length > 0;

  /**
   * Whether the cell has ever spoken — the one question the row's contents
   * turn on, asked of the STATE rather than of `units`.
   *
   * `stateFor` reports `empty` exactly when nothing is under the cursor, and
   * it never returns to `empty` afterwards, so this is one-directional by
   * construction: the pills go and the transport comes alive on the first
   * answer, and neither comes back.
   */
  const silent = state === "empty";

  // The position, where there is one. With no units the derivation would read
  // "Answer, unit 1 of 0" — see the note on the component for why the fallback
  // is a sentence rather than a shorter number.
  const eyeLabel =
    units.length > 0
      ? `Answer, unit ${(progress?.unitIndex ?? 0) + 1} of ${units.length}`
      : "Answer, nothing spoken yet";

  /** The segment a drag is in, while a drag is in progress. */
  const [dragging, setDragging] = useState<{ index: number; element: HTMLElement } | null>(null);
  // Latest-ref so the document listeners below never close over a stale seek.
  const seekRef = useRef<(clientX: number, index: number, element: HTMLElement) => void>(() => {});

  const voice = getStoredVoice();

  const segmentStateAt = (index: number): SegmentState => {
    // Read from the cache rather than tracked, because the warming cascade
    // fills it from two places (the host's arrival warm and the player's
    // ladder) and neither reports to the bar. The playhead-vs-cache rule itself
    // is shared with the answer pane's rail — see `segmentStateFor`.
    const state = segmentStateFor({
      index,
      playingIndex: progress?.unitIndex ?? null,
      cache: speechCacheState(units[index]?.text ?? "", { voice }),
    });
    // A measured unit is one whose audio has been in the element: played, this
    // run, whether or not a run is still going. Only the bar has `durations`,
    // so this stays here; it never overrides the unit that is playing now.
    if (state !== "playing" && durations.has(index)) return "played";
    return state;
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
      // The pane's state, on the row, because the SEAM between them is the
      // row's to draw. `.speech-bar` carries a hairline against the terminal;
      // with the pane open there is no terminal under that edge — the pane's
      // own ground is — and the line reads as a break across one surface. The
      // stylesheet takes it out on this attribute. Told here rather than
      // derived there: the pane is a sibling mounted by `TerminalView`, so no
      // selector can reach from the row to it.
      data-answer-open={answerOpen ? "1" : "0"}
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

        {/*
          THE STRIP IS ALWAYS HERE. It used to be the other arm of a branch:
          `empty` rendered the launcher pills INSTEAD, on three stated
          reasons — every transport control would be disabled, the scrubber
          would have no segments, and the eye would have no pane to open.

          The third one lapsed on this branch. A launcher press now hands the
          answer pane over to a "waiting for agent" wave, so before the first
          answer there IS a pane to open — and hiding the eye left it with no
          way back: the press opened the pane, Escape closed it, and nothing on
          the row could reopen it until the cell finally spoke. A reload is
          worse rather than better, because the pane's open state is in memory
          and a refresh always starts closed, which locked the user out of the
          answer panel on any cell that had not spoken.

          So the eye is LIVE from mount, and the first two reasons are spent as
          what they actually are: the transport is DISABLED until the first
          answer. Disabled says *not yet* where hiding said *never*, and the
          `empty` row of `PLAY_PAUSE_LABEL` already spells that out —
          "Nothing to speak yet", intent `none` — so nothing parallel had to be
          invented for it. `previous` and `next` need no new rule at all: they
          ask the cursor, and an empty queue answers no.

          The pills are ADDED to the line rather than swapped for it. They sit
          where the scrubber does and share the rail with it, which costs
          nothing while the cell is silent because the scrubber has no segments
          to draw and yields its flex share (`data-empty` below).

          One direction only. `stateFor` never returns to `empty` once an
          utterance is under the cursor, so the pills go when the first answer
          lands and do not come back — see the change's design.md on why an
          exited agent cannot honestly bring them back.
        */}
        <span className="speech-bar-sep" />

        <button
          type="button"
          title="Previous answer"
          aria-label="Previous answer"
          data-testid={`speech-bar-previous-${sessionId}`}
          className="speech-bar-btn"
          disabled={!hasPrevious}
          onClick={() => {
            noteTransport(sessionId);
            // Stepping back is the user saying *I want the text*. Without
            // the hold the pane would give it back for exactly as long as
            // it took the agent's next activity broadcast to arrive.
            holdAnswer(sessionId);
            speech.onPrevious(sessionId);
          }}
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
          // The header speak control's own switch, from the header speak
          // control's own function — not a second rule computed here. The row
          // sits between the header and the terminal, so without this a user
          // watching the transport has to look back at the header to learn that
          // something is waiting. `index.css` styles both selectors in one rule,
          // which is what keeps the two the same pulse — for ten seconds.
          //
          // Then this one stops. The bar is a 56px rail sitting directly above
          // the terminal, and a pulse that size that never ends reads as a nag
          // over the work rather than a notice about it. The header control is
          // small, at rest, and off to the side, so it keeps pulsing for as
          // long as the answer goes unheard: it stays the place that says
          // something is still waiting. The cap narrows where the shared
          // derivation is read, never what it means.
          data-pulse={speechPulse(state) === "1" && withinReadyPulse ? "1" : "0"}
          // A reply the cell is still waiting for. The mark is on from the
          // moment the draft goes out until the reply lands, so it outlives
          // both of the things that can take the pane's body away: a
          // transport press, which hands the wait back to this button, and
          // the eye, which closes the pane outright. The second is the case
          // the row exists to cover — the arrival is noticed HERE (see the
          // effect above), so a reply the user walked away from is visibly
          // on its way for exactly as long as it is on its way.
          data-pending={pending ? "1" : "0"}
          className="speech-bar-btn speech-bar-primary"
          // Genuinely `disabled` on a cell that has never spoken, and only
          // there. `empty` is not "on its way" — there is nothing under the
          // cursor and no press can put anything there — so the control is
          // taken out of the tab order too, rather than being offered to a
          // keyboard user as something to land on and fail to work.
          //
          // `preparing` keeps `aria-disabled` alone, as it always did: the
          // audio IS on its way, so the button is announced as not-yet-live
          // without being made unreachable while it lands. That is the whole
          // difference between the two, and it is why this is a `state`
          // test and not an `intent` one — both raise intent `none`.
          disabled={silent}
          aria-disabled={intent === "none" || undefined}
          onClick={() => {
            // The press is a transport press whatever it resolves to, and
            // even when it resolves to nothing: the pane's body goes back
            // to the text either way, because the user asked for the
            // transport rather than for the wait.
            noteTransport(sessionId);
            // Reaching for the transport is reaching for THIS cell, so an
            // attention LED lit for it has been answered. On the CLICK, and
            // on every other gesture that works a transport — see
            // `attentionArrival`, which is the one rule all of them share.
            // What it is deliberately not on is a change of `state`: an
            // autoplayed answer arrives that way and never as a press, and
            // a reply that starts reading itself is the agent talking
            // rather than the user arriving, so it must leave the notice
            // standing.
            //
            // Above the intent branch, so a press of PAUSE dismisses too.
            // This is one button whose meaning is decided by where the run
            // is; the rule is keyed on the press.
            dismissAttentionOnArrival(sessionId);
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
          onClick={() => {
            noteTransport(sessionId);
            // Forward is the user done with what they stepped back for.
            releaseAnswer(sessionId);
            speech.onNext(sessionId);
          }}
        >
          <SkipForward size={16} />
        </button>

        <span className="speech-bar-sep" />

        <div
          className="speech-bar-scrub"
          data-testid={`speech-bar-scrubber-${sessionId}`}
          // Nothing to draw, so nothing to keep the rail for. The strip is
          // `flex: 1` and carries a `min-width` wide enough to be a
          // scrubber; on a silent cell it has no segments, and holding that
          // width would be a blank gap taking the space the launcher pills
          // beside it are for. The stylesheet collapses it on this
          // attribute — see `.speech-bar-scrub[data-empty="1"]`, and
          // `SpeechControlBar.alwaysTransport.test.tsx`, which measures
          // what the line can be squeezed to in both states.
          data-empty={silent ? "1" : undefined}
          // A pointer affordance, hidden from assistive tech — see the note on
          // the component. Announcing it would mean announcing one item per
          // unit, and an answer runs to fifteen of them. The eye beside it
          // carries the position in its name instead, and that is what a
          // screen reader is given.
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

        {/*
          The launchers, in the rail the collapsed scrubber just handed
          over. Placed HERE rather than back beside the arm switch so the
          row reads the same way in both states — fixed controls at the two
          ends, the one thing that stretches in the middle — and so the
          eye stays the last control on the line whether the cell has
          spoken or not. A control that moved along the row on the first
          answer would be a control the user has to find again.
        */}
        {silent ? <LauncherPills sessionId={sessionId} send={send} /> : null}

        <button
          type="button"
          // The position rides in the name — `(unitIndex ?? 0) + 1`, exactly
          // the readout's computation — so a screen reader loses nothing to
          // the eye replacing it. Before the first answer there is no
          // position and the name says so instead. See the note on the
          // component.
          title={eyeLabel}
          aria-label={eyeLabel}
          aria-pressed={answerOpen}
          data-testid={`speech-bar-eye-${sessionId}`}
          // Open borrows the armed toggle's fill — `index.css` styles the
          // two attributes in one rule.
          data-open={answerOpen ? "1" : "0"}
          className="speech-bar-btn"
          onClick={onToggleAnswer}
        >
          <Eye size={17} />
        </button>

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
