import { Crosshair, Eye, Radio, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { SpeechTransport } from "../speech/SpeechTransport";
import { LauncherPills } from "./LauncherPills";
import { noteRetryUtterance } from "./answerRetry";
import {
  noteNewestAnswer,
  noteSpeaking,
  noteTransport,
  noteUtterance,
  useAnswerHeld,
  useAnswerWaiting,
} from "./answerWaiting";
import type { SegmentState } from "./segmentState";
import { dismissAttentionOnArrival } from "./attentionArrival";
import { speechPulse } from "./CellSpeakButton";
import { useReadyPulseWindow } from "../speech/useReadyPulseWindow";
import { newestUtteranceId, utteranceUnderCursor } from "../speech/utteranceQueue";
import { stepsOffTheWave, stepsOntoTheWave } from "../speech/waveStep";
import type { GridSpeech, SpeechMode } from "../speech/types";
import { voiceForSession } from "./sessionVoice";
import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";

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
 * The row's first control, per speech mode: the glyph, and a label that names
 * the mode the cell is in AND what the next click does — the cycle is only
 * learnable from the control itself. Three states are not a switch, so the
 * control is a plain button reporting `data-speech-mode` rather than
 * `aria-checked`; the stylesheet dims the `off` glyph and greens the other two.
 */
const SPEECH_MODE_CONTROL: Record<SpeechMode, { Icon: typeof Radio; label: string }> = {
  off: { Icon: Radio, label: "Speech off — arm this cell" },
  armed: { Icon: Crosshair, label: "Armed — preloading; click for autoplay" },
  autoplay: { Icon: Volume2, label: "Autoplay — click to turn off" },
};

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
  // `pending` is only the mark: whether the pane's BODY has handed over is the
  // pane's business, and the bar draws the same fact one control smaller.
  //
  // `waiting` and `held` are read for a different question entirely — not to
  // draw anything, but because the wave is a POSITION the transport can stand
  // on, and the two ends below cannot be derived without knowing whether the
  // body is on it. See the two ends below and `features/speech/waveStep.ts`.
  const { pending, waiting } = useAnswerWaiting(sessionId);
  const held = useAnswerHeld(sessionId);
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
  // The cache subscription the segments' states need is the transport's own —
  // see `features/speech/SpeechTransport.tsx`.

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

  /**
   * The newest answer the cell HOLDS — not the one under the cursor. Declared
   * here rather than beside its own effect below because the retry ticket is
   * measured against it too, and that push happens first.
   *
   * See {@link newestUtteranceId} for why neither `current` nor the cursor can
   * stand in for it.
   */
  const newestAnswerId = newestUtteranceId(queue);

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

  // The retry ticket is told about an arrival at the same moment and for the
  // same reason: it too has to be withdrawn by an answer that landed while the
  // pane was shut, or a user who reopens the pane finds a button offering to
  // press Enter into a conversation that has already moved on.
  //
  // It is told the NEWEST id and not the cursor's, which is the one difference
  // between this push and `noteUtterance`'s above, and the reason they are two
  // effects rather than one. The cursor is wrong for a ticket in both
  // directions. It misses the arrival the ticket exists to be withdrawn by: an
  // answer landing while the voice is reading appends to `pending` and leaves
  // `current` and the cursor untouched, so the id would be byte-identical, this
  // effect would not re-run, and a standing offer would sit through a genuine
  // reply. And it invents one that never happened: `previous`/`next` move the
  // cursor, so a user stepping back to re-read while waiting would change the
  // id and drop a ticket whose premise — a keypress that never landed — is
  // untouched by browsing history. Nothing re-arms a dropped ticket, so that
  // one is silent and permanent.
  //
  // The ticket this pushes into may still have NOTHING recorded against it: the
  // composer opens it at the Enter, and the id it is measured against is
  // recorded when the body is WRITTEN, which a queued submit or the reconnect
  // path puts up to three seconds later. A remount inside that gap is the
  // ordinary case, not the exotic one. It is safe regardless, because the store
  // adopts the first id it is handed instead of reading it as a newer answer —
  // a rule kept beside the comparison it guards rather than staged from here,
  // where it would be an ordering between two calls. See `answerRetry.ts` on
  // why the adoption cannot preserve a VISIBLE offer, and what it does risk.
  useEffect(() => {
    noteRetryUtterance(sessionId, newestAnswerId);
  }, [sessionId, newestAnswerId]);

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

  // The row's first control shows the cell's speech mode and steps it round
  // `off → armed → autoplay → off`. See {@link SPEECH_MODE_CONTROL}.
  const mode = speech.speechModeOf(sessionId);
  const modeControl = SPEECH_MODE_CONTROL[mode];

  // The transport's two ends, asked of the CURSOR rather than of the lists.
  // While history was a single slot the question was "is the slot full, and
  // has the cursor not already been spent on it"; now that it is a list there
  // is only one question — does the cursor still have a step left to take —
  // and it has to be the same question the reducer's own no-op guards ask. A
  // rail that asks it any other way either offers a press that does nothing or
  // refuses one that would have worked, and neither is visible to the type
  // checker: `previous` is an array, so the old `!== null` half is true
  // forever and would leave `hasPrevious` permanently reading `cursor === 0`.
  //
  // ...and the walk the cursor steps along has ONE MORE POSITION than the list
  // does. The wave is not an utterance, so it has no index; it is where the
  // body is when the agent owns it, one step above `current`. A rail that asks
  // only the list cannot see it, and the state that proves the point is the
  // one a reload leaves behind: the server hands back a single retained
  // utterance with no history and nothing waiting, so `cursor < previous.length`
  // and `cursor > 0 || pending.length` are both false while the play button is
  // reporting an unread answer the user has no control to reach. The hold —
  // `adr/0016`'s one carve-out from the wave owning the body — is taken by
  // exactly the press that was disabled.
  //
  // Deliberately NOT a `-1` cursor. Everything that reads the cursor
  // (`utteranceUnderCursor`, the play control, the scrubber, the host's own
  // no-op guards) would grow a null-position case, and the reducer's
  // same-reference guards — what keeps a refused press from repainting the
  // grid — would each become an edge case. `held` already names the position,
  // so the walk is expressible without touching the queue at all.
  //
  // These two ends are the row's only remaining share of the model — the STEP
  // itself is the host's, so that the chord and the media keys take it too.
  // What is left here is presentation, and it has to MIRROR the host's rule:
  // an end that disagrees either offers a press that does nothing or refuses
  // one that would have worked, and the type checker sees neither. The two
  // rules are `onPrevious`/`onNext` in `useSpeechHost.ts`.
  // Asked of `utteranceUnderCursor` rather than of `current`, for the reason
  // the ends themselves are: the cursor's meaning lives in the file that owns
  // it. A cell that has never spoken has nothing under the cursor, so the wave
  // sits on top of nothing and adds no step — which is how the row's "disabled
  // until the first answer" rule survives this change untouched.
  const atAnswer = utteranceUnderCursor(queue) !== null;
  const hasPrevious =
    stepsOffTheWave(waiting, held, atAnswer) || queue.cursor < queue.previous.length;
  const hasNext =
    stepsOntoTheWave(held, queue.cursor, queue.pending.length) ||
    queue.cursor > 0 ||
    queue.pending.length > 0;

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

  // The voice the cell's units were synthesized in — its project's — or a
  // cached unit reads as cold: the cache keys on voice + text. Both voice
  // preferences are subscribed to only so a change re-reads it here.
  usePreference(preferences.speechVoice);
  usePreference(preferences.speechVoiceByProject);
  const voice = voiceForSession(sessionId);

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
          title={modeControl.label}
          aria-label={modeControl.label}
          data-testid={`speech-bar-autoplay-${sessionId}`}
          data-speech-mode={mode}
          className="speech-bar-btn"
          onClick={() => speech.cycleSpeechMode(sessionId)}
        >
          <modeControl.Icon size={17} />
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
          `empty` row of the transport's `PLAY_PAUSE_LABEL` already spells that out —
          "Nothing to speak yet", intent `none` — so nothing parallel had to be
          invented for it. `previous` and `next` need no new rule at all: they
          ask the cursor, and an empty queue answers no.

          The pills are ADDED to the line rather than swapped for it. They sit
          where the scrubber does and share the rail with it, which costs
          nothing while the cell is silent because the scrubber has no segments
          to draw and yields its flex share (`data-empty` on the transport's
          scrubber).

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
            // ONE CALL, on purpose. The hold, the wave step and the send
            // wait's `noteTransport` all belong to `onPrevious` in the host,
            // because the chord and the OS media keys raise the same callback
            // and must behave the same way — a rule the row kept for itself
            // would be a second transport. This handler's whole job is to say
            // that the row's control was pressed.
            speech.onPrevious(sessionId);
          }}
        >
          <SkipBack size={16} />
        </button>

        <SpeechTransport
          id={sessionId}
          state={state}
          units={units}
          durations={durations}
          progress={progress}
          voice={voice}
          onPlay={() => speech.onSpeak(sessionId)}
          onPause={() => speech.onPause(sessionId)}
          onResume={() => speech.onResume(sessionId)}
          onJumpToUnit={(index) => speech.onJumpToUnit(sessionId, index)}
          onSeekWithinUnit={(seconds) => speech.onSeekWithinUnit(sessionId, seconds)}
          // `speechPulse` says whether the cell is asking (only `ready` is) —
          // not a second rule computed here. The header speak control exists
          // only while a cell speaks, so this button is where a ready answer
          // announces itself; `index.css` animates it with the header's own
          // pulse rule, for ten seconds.
          //
          // Then it stops. The bar is a 56px rail sitting directly above the
          // terminal, and a pulse that size that never ends reads as a nag
          // over the work rather than a notice about it. The cap narrows where
          // the derivation is read, never what it means.
          pulse={speechPulse(state) === "1" && withinReadyPulse}
          // A reply the cell is still waiting for. The mark is on from the
          // moment the draft goes out until the reply lands, so it outlives
          // both of the things that can take the pane's body away: a
          // transport press, which hands the wait back to this button, and
          // the eye, which closes the pane outright. The second is the case
          // the row exists to cover — the arrival is noticed HERE (see the
          // effect above), so a reply the user walked away from is visibly
          // on its way for exactly as long as it is on its way.
          pending={pending}
          onPress={() => {
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
            // The transport calls this above its intent branch, so a press
            // of PAUSE dismisses too. This is one button whose meaning is
            // decided by where the run is; the rule is keyed on the press.
            dismissAttentionOnArrival(sessionId);
          }}
          // `next` sits between play/pause and the scrubber, so it rides in
          // the transport's slot and the row's DOM order is what it was.
          between={
            <>
            <button
              type="button"
              title="Next answer"
              aria-label="Next answer"
              data-testid={`speech-bar-next-${sessionId}`}
              className="speech-bar-btn"
              disabled={!hasNext}
              onClick={() => {
                // One call, like the backward control beside it: the release onto
                // the wave is `onNext`'s, in the host.
                speech.onNext(sessionId);
              }}
            >
              <SkipForward size={16} />
            </button>

            <span className="speech-bar-sep" />
            </>
          }
        />

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
