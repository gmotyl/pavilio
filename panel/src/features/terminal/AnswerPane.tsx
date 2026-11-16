import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import MarkdownRenderer from "../markdown/MarkdownRenderer";
import { CopyIconButton } from "../shell/CopyIconButton";
import PaneResizer from "../shell/PaneResizer";
import { useResizableRow, type RowBounds } from "../shell/useResizableRow";
import { ANSWER_PANE_FULL_HEIGHT, preferences } from "../../preferences/declarations";
import { usePreference, useScopedPreference } from "../../preferences/usePreference";
import { ANSWER_COMPOSER_BOUNDS, AnswerComposer, composerFieldHasFocus } from "./AnswerComposer";
import { AnswerWaiting, AnswerWaitingNext } from "./AnswerWaitingView";
import { noteRetrySentOn } from "./answerRetry";
import { beginWaiting, releaseAnswer, useAnswerHeld, useAnswerWaiting } from "./answerWaiting";
import { usePlayPressCount } from "../speech/playPresses";
import { PlayFromHere } from "../speech/PlayFromHere";
import { projectOfSession } from "./sessionProject";
import { useActivityState } from "./useTerminalActivityChannel";
import type { GridSpeech, SpeechUnit } from "../speech/types";
import { unplayedSinceLastPlayed } from "../speech/unreadAnswers";
import { newestUtteranceId, utteranceUnderCursor } from "../speech/utteranceQueue";

export interface AnswerPaneProps {
  sessionId: string;
  speech: GridSpeech;
  /**
   * The cell's own PTY write, handed straight to the composer. `TerminalView`
   * reads it off the live instance at call time — the same one the bar's
   * launcher pills send with, so a reply typed here and a pill clicked up there
   * reach the shell by one transport.
   *
   * It reports whether the frame reached an OPEN socket; the composer is what
   * acts on that, by keeping a reply the socket refused.
   */
  send: (data: string) => boolean;
  /**
   * Puts DOM focus back on the cell's xterm. Used when an Escape pressed in the
   * pane is handed to the terminal: the key goes to the PTY and the keyboard
   * goes back with it, so the next key lands where the TUI is listening.
   */
  focusTerminal?: () => void;
}

/**
 * The rendered block that holds `unit`: the Play-from-here layer marks each
 * speakable block with the first unit it starts the voice at
 * (`data-speak-unit`), so the block of a later sentence is the marked one of
 * the same prepared block. Null when no rendered block holds the unit (a fence
 * placeholder, a sentinel-only paragraph).
 */
function blockOfUnit(
  root: HTMLElement,
  units: readonly SpeechUnit[],
  unit: number,
): HTMLElement | null {
  const block = units[unit]?.block;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-speak-unit]"))) {
    const first = Number(el.dataset.speakUnit);
    if (first === unit) return el;
    if (block !== undefined && units[first]?.block === block) return el;
  }
  return null;
}

/** `el`'s top inside `container`, summed up the offset-parent chain. */
function offsetTopWithin(el: HTMLElement, container: HTMLElement): number {
  let top = 0;
  for (let at: Element | null = el; at && at !== container; at = (at as HTMLElement).offsetParent) {
    top += (at as HTMLElement).offsetTop;
  }
  return top;
}

/**
 * How short the pane may be dragged, and how far one arrow key moves it.
 *
 * The floor leaves the meta row and a line or two of the answer above it: a
 * pane shorter than that has stopped being a pane and is merely in the way of
 * the terminal it was dragged out of. There is no matching CEILING constant —
 * see {@link AnswerPane} on why the ceiling is measured rather than declared.
 *
 * This is the floor with the composer OFF. With it on, see
 * {@link minPaneHeight}: the composer's rows are chrome the answer cannot
 * shrink into, and a fixed 120 left the pane's own drag row pushed ~59px
 * below the pane at the default field height.
 */
export const MIN_PANE_HEIGHT = 120;
const PANE_HEIGHT_STEP = 24;

/** The pane's own ground — the speech row's, not `--bg-surface`. */
const ANSWER_GROUND = "#17171d";

/**
 * The answer body's paint at a bottom-edge opacity of `opacity` (0–100): solid
 * at the top, fading linearly to `opacity` percent of the ground at the bottom.
 */
function answerBodyGradient(opacity: number): string {
  return `linear-gradient(to bottom, ${ANSWER_GROUND} 0%, color-mix(in srgb, ${ANSWER_GROUND} ${opacity}%, transparent) 100%)`;
}

/**
 * The pane's rows that are neither the body nor the composer's field row
 * (whose stored height already includes its own 13px of padding), with the
 * composer on: the grip (7), the chip row (~35: 8px padding, 1px seam, the
 * chip and its 4px margin — always drawn, since the `/ skills` chip and the
 * shortcut chips sit in it with nothing attached), the meta row, the key hint
 * and the pane's drag row (7). Measured in a browser at 97px — 159px of fixed chrome at the default
 * 62px field, 145px at the 48px floor.
 * Pinned against the stylesheet by `AnswerPane.resize.test.tsx`.
 */
export const ANSWER_PANE_COMPOSER_CHROME = 97;

/** What the body keeps at the floor: its 20px of padding and one line of the answer. */
export const ANSWER_PANE_BODY_FLOOR = 44;

/**
 * The pane's floor for a composer that is `composerOn` with a field row
 * `composerHeight` tall: every fixed row plus the body's floor, never below
 * {@link MIN_PANE_HEIGHT}. It follows the field, so a taller reply box raises
 * the floor rather than pushing the drag row out of the pane. A chip row that
 * wraps (many attachments) or the send-failed line is not counted: both are
 * transient, and a floor sized for them would waste the terminal all day.
 */
export function minPaneHeight(composerOn: boolean, composerHeight: number): number {
  if (!composerOn) return MIN_PANE_HEIGHT;
  const { min, max } = ANSWER_COMPOSER_BOUNDS;
  const field = Math.min(max, Math.max(min, composerHeight));
  return Math.max(MIN_PANE_HEIGHT, ANSWER_PANE_COMPOSER_CHROME + field + ANSWER_PANE_BODY_FLOOR);
}

/**
 * The cell's answer pane: the utterance under the cursor rendered as markdown
 * under the speech row, with Play from here beside its blocks and a pinned ▶
 * beside the line the voice is reading.
 *
 * ## Why it is an overlay, and over what
 *
 * The same rule the bar lives by, for the same reason. `TerminalView` runs
 * `new ResizeObserver(() => inst.fit())` with no coalescing, and `inst.fit()`
 * unconditionally refreshes the terminal AND sends a PTY resize — see the note
 * on `SpeechControlBar`. A pane in the cell's flexbox would hand that unfixed
 * bug a new trigger every time it opened or closed. So this is
 * `position: absolute` over the xterm, a SIBLING of the observed container:
 * nothing reflows, nothing refits, no resize frame is sent when it appears.
 *
 * What it is absolute WITHIN is the terminal area — the positioned box
 * `TerminalView` wraps the observed container in — not the cell. That is what
 * makes `top: 0` mean "where the speech row ends" without any arithmetic, and
 * what keeps the row and the cell header out from under it: they are not in
 * the box. It is also no longer a card. The border, radius, shadow and blur
 * went the way the bar's did, and it takes the row's own ground, so the row
 * and the pane read as one speech surface over the terminal.
 *
 * ## Why the progress snapshot is the unit index only
 *
 * The host publishes progress on every `timeupdate`, ~4 Hz, for the whole
 * panel. The pane has one thing to do with that stream: move the pinned ▶ when
 * the unit changes. So the store snapshot taken here is
 * `progressFor(sessionId)?.unitIndex ?? null` — a primitive, equal to itself
 * across every tick inside a unit — and `useSyncExternalStore` bails out of
 * the re-render entirely. A reader's eyes are on the text; nothing in the
 * body is rebuilt four times a second under them. The bar takes the whole
 * progress object because it draws the fill; the pane does not.
 *
 * ## Why reading starts from a Play button, and the text is just text
 *
 * The blocks used to be the jump: a matched block was `role="button"` with a
 * tab stop, and a delegated click anywhere inside it — a link included —
 * started the voice there. So a link in an answer could not be followed
 * without also being read to, and selecting a sentence restarted the unit.
 * The blocks are plain elements, and reading starts from a real button.
 *
 * Those buttons are `PlayFromHere`, the same layer pages use: a ▶ beside the
 * first line of every speakable block (heading, paragraph, list item), shown
 * on hover, focus or a tap, starting the cell's run at that block's first unit
 * through `speech.onJumpToUnit`. Code, tables and diagrams get none. While a
 * unit of this cell plays, one more ▶ is pinned — always shown — beside the
 * line where the playing sentence starts: Pause while the voice reads, Play
 * while it is paused, which jumps back to that unit. The pinned ▶ is where
 * the voice is; the segment states live in the speech row's scrubber.
 *
 * It replaced a unit rail — a vertical copy of the scrubber in a gutter, with
 * a Play per unit and a playhead — which needed its own text match and its own
 * layout pass to place segments beside blocks. With sentence units an answer
 * has many more of them than blocks, and the scrubber above already says it.
 *
 * ## Why the body, and only the body, hands over while a reply is pending
 *
 * Sending leaves the previous answer on screen, where it reads as the reply to
 * the question just asked. So the composer's `send` is wrapped here — the
 * composer raises the keystroke and knows nothing about the pane above it,
 * while the pane knows which utterance the body was showing when the draft went
 * out — and the body renders {@link AnswerWaiting} in place of the text until
 * that wait ends.
 *
 * Nothing on `speech` is touched on the way in. The voice goes on reading
 * whatever it was reading and the bar's scrubber goes on advancing, because the
 * wait is a fact about this BODY, not about the one run the panel has. The
 * state, its three exits and the reason none of them is a timer live in
 * `answerWaiting.ts`; what the pane owes it is two things it alone knows — the
 * send, and the id under the cursor when it happened.
 *
 * ## Why the pane's ceiling is measured and its default is not a height
 *
 * The pane has a handle on its BOTTOM edge, dragged up to uncover the terminal
 * without closing the pane. That makes its height a number, and a number needs
 * a ceiling — but the honest ceiling is the terminal area itself: a pane
 * taller than the box it is absolute within hangs past the bottom of the cell,
 * over the next one. So the area is measured (its `clientHeight`, re-read by a
 * `ResizeObserver` because a cell is resized by the grid, by a seam drag and by
 * the window) and handed to `useResizableRow` as `max`, where it clamps both
 * the drag and what the drag persists.
 *
 * The stored default is `ANSWER_PANE_FULL_HEIGHT`, which is not a height so
 * much as the word "full": it exceeds any area the panel is opened in today,
 * so it clamps to exactly the area and an unresized pane covers the terminal —
 * the behaviour #115 settled. And until the area HAS been measured, no height
 * is applied at all: the stylesheet's four insets already say "cover the
 * terminal area", which is the right answer for the frame before the layout
 * effect runs and the only possible answer where there is no layout to read
 * (jsdom). Applying a height means giving up the bottom inset, so the two are
 * written together.
 *
 * ## Why the height is remembered per project
 *
 * How much of a cell you are willing to hand to the answer is a fact about the
 * work, not a habit the whole panel shares: a repository read mostly through
 * its answers earns a taller pane than one driven from the terminal. So the
 * declaration is `project`-scoped, and the scope argument is looked up from the
 * tab's session list rather than threaded down — see `projectOfSession`, and
 * `LauncherPills`, which reached the same conclusion first. Two cells of one
 * project therefore share the number; that is accepted, because the
 * alternative scope is a session id, which names nothing once the agent has
 * been restarted. And a pane whose project the list cannot name — a cell of the
 * quick modal, or any cell at all before the store's first load lands — opens
 * at the declared height and persists nothing until it can: see
 * `projectOfSession`, which answers `null` there precisely so that nothing is
 * written under a name no one will read back.
 *
 * ## Why the pane scrolls once, on mount, and never while it reads
 *
 * Following is a `useLayoutEffect` that runs when the pane mounts and at no
 * other time. A pane opened while a unit is playing, whose body overflows,
 * scrolls the body once so that the block holding that unit sits a third of
 * the way down — in the layout pass, after Play from here has marked the
 * blocks, so the first frame is already there and the reader never sees the
 * top of the answer and then a jump. After that the scroll position is the
 * reader's: a unit boundary moves the pinned ▶, never the text, and neither
 * does the body being rebuilt on the way out of a wait. Pulling the text along
 * under someone who is reading, or who has scrolled elsewhere on purpose,
 * costs more than the pinned ▶ already says about where the voice is.
 */
export function AnswerPane({
  sessionId,
  speech,
  send,
  focusTerminal,
}: AnswerPaneProps) {
  // Global, and read here rather than passed in: whether a pane carries a
  // composer at all is one answer for the whole panel, so the pane reads and
  // writes it directly.
  const [composerOn, setComposerOn] = usePreference(preferences.answerComposerEnabled);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /**
   * The height of the terminal area the pane is absolute within, or null while
   * it has not been read. See the note on the component: this is the pane's
   * ceiling, and it is a measurement rather than a constant.
   */
  const [areaHeight, setAreaHeight] = useState<number | null>(null);
  // The composer's field height, read under the scope the composer writes it
  // under, so the floor follows the reply box (see `minPaneHeight`).
  const [composerHeight] = useScopedPreference(
    preferences.answerComposerHeight,
    projectOfSession(sessionId),
  );
  const floor = minPaneHeight(composerOn, composerHeight);
  const bounds: RowBounds = useMemo(
    () => ({
      min: floor,
      // The unmeasured case keeps the declared default reachable rather than
      // collapsing it to the floor — nothing is applied while it holds, and a
      // max of the floor would make the handle report it for a pane that is
      // covering the whole area.
      max: Math.max(floor, areaHeight ?? ANSWER_PANE_FULL_HEIGHT),
      step: PANE_HEIGHT_STEP,
    }),
    [areaHeight, floor],
  );
  const {
    height: paneHeight,
    isMobile: narrowViewport,
    handleProps: dragProps,
  } = useResizableRow(
    preferences.answerPaneHeight,
    bounds,
    // The scope the height is remembered under — see the note on the
    // component. The pane is handed a `sessionId` and nothing else, so the
    // project comes from the tab's session list rather than from a prop.
    projectOfSession(sessionId),
  );

  const queue = speech.queueFor(sessionId);
  const answer = utteranceUnderCursor(queue);
  const units = speech.unitsFor(sessionId);

  // Unit index ONLY — see the note on the component. Null for every cell but
  // the one running, which is also the shared bail-out value.
  const unitIndex = useSyncExternalStore(
    speech.subscribeProgress,
    () => speech.progressFor(sessionId)?.unitIndex ?? null,
  );
  const answerId = answer?.id ?? null;

  // Whether this cell is still waiting for the reply to a draft it sent. Only
  // `waiting` is the body's business: `pending` is the bar's, and is what keeps
  // the mark on the play button after a transport press took the text back.
  const { waiting } = useAnswerWaiting(sessionId);
  // The hold, and the agent's own state — the two halves of "the user stepped
  // back and the agent is STILL working", which is the only situation the wave
  // has somewhere else to be. Read as two separate facts rather than folded
  // into the snapshot: see `isAnswerHeld` on why the body's four shared
  // snapshots stay four.
  const held = useAnswerHeld(sessionId);
  const activity = useActivityState(sessionId);
  // Either wave the body can draw: the waiting state's, or the one moved
  // above the text while the user holds an answer and the agent still works.
  const waveShown = waiting || (held && activity === "busy");

  // The body's bottom-edge opacity, remembered per project and portable — see
  // its declaration. Below 100 the pane goes transparent behind the body and
  // the body paints the fade; the meta row and the composer keep the ground.
  const [opacityBottom] = useScopedPreference(
    preferences.answerOpacityBottom,
    projectOfSession(sessionId),
  );
  /**
   * Whether the composer's field holds focus — kept on its own because it is
   * what the body falls back to when a wave clears.
   */
  const [composerFocused, setComposerFocused] = useState(false);
  /**
   * Whether the body is solid by the user's last gesture, set by events, the
   * last one winning:
   * - the composer's field takes focus → solid (typing over a see-through body
   *   would put the terminal's output under the eye that is writing);
   * - it loses focus → fade;
   * - a play press (Play, Resume, *Read from here*, any surface) → solid, so
   *   the text read along with the voice is not over the terminal. Pausing
   *   changes nothing; autoplay is not a press.
   * - a wave appears → fade, and while it is shown a press changes nothing:
   *   the wave is the pane saying "the agent is working";
   * - the wave clears → whatever the focus says.
   */
  // A pane opened over a run already under way — the bar's Play is usable
  // while the pane is closed — starts solid: the press it would have answered
  // happened before it mounted. Playing, buffering or paused alike; a shown
  // wave still wins.
  const [solidByGesture, setSolidByGesture] = useState(() => {
    const state = speech.stateFor(sessionId);
    return !waveShown && (state === "speaking" || state === "stalled" || state === "paused");
  });
  const playPresses = usePlayPressCount(sessionId);
  // The two inputs that act on their CHANGE, not their value. Adjusted during
  // render, React's pattern for state that follows a prop.
  const [seen, setSeen] = useState({ playPresses, waveShown });
  if (seen.playPresses !== playPresses || seen.waveShown !== waveShown) {
    setSeen({ playPresses, waveShown });
    if (waveShown) setSolidByGesture(false);
    else if (seen.waveShown) setSolidByGesture(composerFocused);
    else setSolidByGesture(true);
  }
  // A field removed while it holds focus fires no blur, so switching the
  // composer off would leave the body solid over a composer that is gone.
  if (!composerOn && composerFocused) {
    setComposerFocused(false);
    setSolidByGesture(false);
  }
  const isComposerField = (target: EventTarget | null): boolean =>
    target instanceof Element && target.classList.contains("answer-pane-composer-field");
  const translucent = opacityBottom < 100;
  const bodySolid = !translucent || (solidByGesture && !waveShown);

  /**
   * How many answers arrived after the last one this cell played and have not
   * themselves been played — a derivation over the `heard` set the channel
   * already keeps, never a tally of its own. Computed here rather than inside
   * the waiting state so the state stays a rendering of what it is handed, and
   * so the count is definitively absent from every other body the pane can
   * show.
   */
  const notPlayed = unplayedSinceLastPlayed(queue, speech.heardFor(sessionId));

  // The handover, raised once per submit. The composer raises the send and
  // knows nothing about the pane above it; the pane knows what the body was
  // showing when the draft went out, which is exactly what tells a later
  // arrival apart from the answer that is already there.
  //
  // It is a separate callback rather than a wrapper around `send` because a
  // submit is TWO writes now — the body, then the return (`ptySubmit`) — and a
  // wrapped `send` would hand the body over twice, re-opening the wait forty
  // milliseconds after it began.
  //
  // Nothing on `speech` is read here — see the note on `answerWaiting.ts`. The
  // voice keeps reading; only the body hands over.
  const onSubmitted = useCallback(
    (generation?: number): void => {
      beginWaiting(sessionId, answerId);
      // Where the cell STOOD when the draft went out, to the other store that
      // measures an arrival against it. The wait and the retry ticket disagree
      // about nearly everything — see `answerRetry.ts` on why they are two
      // modules with opposite exits — but not about this: both are asking "has
      // anything newer than THIS come back?".
      //
      // The NEWEST id, not the cursor's, and that is the one place the two
      // stores are handed different values. `answerWaiting` keeps the cursor
      // and the newest as two separate facts and never compares one against
      // the other; the ticket has a single slot, fed here and by the bar's
      // `noteRetryUtterance`, so both have to speak the same vocabulary or the
      // first push after the send reads as an answer landing and drops the
      // ticket on the spot. Newest is also the right value on its own terms:
      // an answer arriving while the voice is reading lands in `pending` and
      // never touches the cursor, so a cursor baseline cannot be moved by the
      // very arrival the ticket must be withdrawn by.
      //
      // Pushed from the pane rather than the composer because the pane is what
      // knows the queue, and at DELIVERY rather than at the Enter because the
      // ticket exists from the Enter onward: the composer opens it before the
      // first write, so there is a gap — a queued submit, or the reconnect
      // path's three seconds — in which the ticket is live and has no id yet.
      // `SpeechControlBar` closes that gap from its own side; this is the push
      // that gets it right.
      //
      // The generation comes down from the composer, so a report from a submit
      // the user has already moved past cannot write its stale baseline into
      // the ticket their newer send just opened — the rule `armRetryOffer` and
      // `clearRetryTicket` already follow.
      noteRetrySentOn(sessionId, newestUtteranceId(queue), generation);
    },
    [sessionId, answerId, queue],
  );

  // The reply landing is NOT noticed here — it is noticed on the bar. See the
  // note beside `noteUtterance` in `SpeechControlBar.tsx`: this pane unmounts
  // the moment the eye closes it, and a wait that could only end while the pane
  // was open would stay marked after the answer had already arrived.

  // Focus lands on the root the moment it opens — also when it opened itself —
  // so the answer can be scrolled and read from the keyboard at once.
  //
  // Except when the composer already took it: a pane rebuilt with its cell
  // while the user was typing has a composer that reclaimed focus and caret in
  // its own (layout) mount effect, which runs before this one. Moving focus to
  // the root then would send the rest of the reply to the pane's shortcuts.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || composerFieldHasFocus(root)) return;
    root.focus();
  }, []);

  // Measure the terminal area: the pane's ceiling, and the number the drag is
  // clamped against. A LAYOUT effect, so the measurement is in hand before the
  // first paint and no frame shows a pane sized by the unmeasured default; and
  // an observer, because a cell is resized by the grid, by a seam drag and by
  // the window, and a stale ceiling would let the handle persist a height
  // taller than the cell it was dragged in.
  //
  // The AREA is what is observed, never the xterm container `TerminalView`
  // watches: that observer unconditionally refits the terminal and sends a PTY
  // resize, and this pane is careful not to become a new trigger for it.
  useLayoutEffect(() => {
    const area = rootRef.current?.parentElement;
    if (!area) return;
    // Zero is jsdom's answer for every box, and a detached element's in a real
    // browser. It means "not measured", not "an area of no height" — and the
    // difference matters, because an area of no height would clamp the pane to
    // its floor and apply it.
    const measure = (): void =>
      setAreaHeight(area.clientHeight > 0 ? area.clientHeight : null);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  // Escape never closes the pane: only the eye and Alt+Shift+O do. And because
  // the pane takes focus when it opens (also when it opened itself), an Escape
  // pressed here would otherwise reach no terminal at all — a TUI that uses it
  // (Claude Code interrupts on it) would get nothing. So an Escape that nothing
  // inside the pane consumed (the command picker closing, a wiki hover card) is
  // delivered to the cell's PTY as ESC, the same transport the xterm's own
  // input uses, and the keyboard goes back to the xterm with it. The event is
  // neither cancelled nor stopped, so outer listeners still see it.
  const onEscapeKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "Escape" || e.defaultPrevented || e.nativeEvent.isComposing) return;
    send("\x1b");
    focusTerminal?.();
  };

  // Land on the voice once, when the pane mounts mid-run, and only when there
  // is somewhere to scroll to. Never again while it stays open — not on a unit
  // boundary, not on a tick, not when the body comes back from a wait: the
  // pinned ▶ follows the voice, the scroll position is the reader's. A layout
  // effect: Play from here marks the blocks in its own layout effect, which
  // runs before this one (a child's before its parent's), and the scroll lands
  // before the first paint.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (unitIndex === null || !body) return;
    if (body.scrollHeight <= body.clientHeight) return;
    const block = blockOfUnit(body, units, unitIndex);
    if (!block) return;
    body.scrollTo({ top: Math.max(0, offsetTopWithin(block, body) - body.clientHeight / 3) });
    // Mount only, deliberately: `unitIndex` is read as it stands when the pane
    // opens, and a later change must not bring this back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A ▶ press jumps the cell's run there — also the pinned ▶ while paused,
  // which jumps to the paused unit and so restarts the paused sentence.
  const onPlay = useCallback(
    (unit: number): void => {
      speech.onJumpToUnit(sessionId, unit);
    },
    [speech, sessionId],
  );
  const onPause = useCallback((): void => {
    speech.onPause(sessionId);
  }, [speech, sessionId]);
  // Read as the bar reads it, so the pinned ▶ and the bar's control agree.
  const paused = speech.stateFor(sessionId) === "paused";

  /**
   * The height to apply, or null to leave the stylesheet's four insets alone —
   * which is the same thing as "cover the terminal area".
   *
   * Null on a touch viewport, where the pane is laid out by the viewport and a
   * stored height is not applied at all (the composer's row makes the same
   * call, for the same reason), and null until the area has been measured.
   */
  const appliedHeight = narrowViewport || areaHeight === null ? null : paneHeight;

  return (
    <div
      ref={rootRef}
      className="answer-pane"
      data-testid={`answer-pane-${sessionId}`}
      role="region"
      aria-label="Answer"
      tabIndex={-1}
      style={{
        // Solid at 100 — exactly today's surface — and transparent (the
        // stylesheet's) below it, so the body's fade shows the terminal.
        ...(translucent ? null : { background: ANSWER_GROUND }),
        ...(appliedHeight === null
          ? null
          : {
              height: `${appliedHeight}px`,
              // The bottom inset is given up in the same breath as the height
              // is taken: `.answer-pane` pins all four edges, and a box pinned
              // to both ends of its container with a height as well is
              // over-constrained — the browser resolves that by ignoring one
              // of the two, and which one it ignores is not a thing to leave
              // to a rule about writing direction. Dropped explicitly, the
              // pane is pinned to the top and as tall as it was dragged, and
              // the strip below it is terminal again.
              bottom: "auto",
              // For the frame between a cell shrinking and the observer above
              // re-clamping: the pane never paints past the area it covers.
              maxHeight: "100%",
            }),
      }}
      // Delegated from the root: the composer's field is the composer's, and
      // whether it holds focus matters only to the paint up here.
      onFocus={(e) => {
        if (!isComposerField(e.target)) return;
        setComposerFocused(true);
        setSolidByGesture(true);
      }}
      onBlur={(e) => {
        if (!isComposerField(e.target)) return;
        setComposerFocused(false);
        setSolidByGesture(false);
      }}
      onKeyDown={onEscapeKey}
      // The cell header is `draggable` and the cell root focuses on click, so
      // every gesture that could reach either has to stop here — as on the bar.
      draggable={false}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div
        ref={bodyRef}
        className="answer-pane-body"
        data-testid={`answer-pane-body-${sessionId}`}
        style={{ background: bodySolid ? ANSWER_GROUND : answerBodyGradient(opacityBottom) }}
      >
        {waiting ? (
          <AnswerWaiting sessionId={sessionId} notPlayed={notPlayed} />
        ) : (
          <>
          {/* The wave, moved: the user asked for the text and got it, and the
              agent is still working, so the one thing the pane must not do is
              go quiet about that. Pressing it releases the hold and the body
              goes back to the agent. */}
          {held && activity === "busy" ? (
            <AnswerWaitingNext
              sessionId={sessionId}
              onActivate={() => releaseAnswer(sessionId)}
            />
          ) : null}
          <div className="answer-pane-text">
            {answer ? (
              <PlayFromHere
                speechKey={sessionId}
                units={units}
                playingUnit={unitIndex}
                paused={paused}
                onPlay={onPlay}
                onPause={onPause}
              >
                <MarkdownRenderer content={answer.text} />
              </PlayFromHere>
            ) : null}
          </div>
          </>
        )}
      </div>
      {/* Copy as Markdown: the answer's SOURCE, with its `#`, links and fences
          intact. Pinned to the pane's corner OUTSIDE the scroll box, so it
          stays put while the text scrolls and is always visible (touch
          included). Absent while the body waits: what it would copy is the
          answer the wait has already handed away. The button stops its own
          click, so a copy never reaches anything that plays. After the body
          in the DOM: absolutely positioned, it is no row of the column, and
          the body stays the column's first row. */}
      {answer && !waiting ? (
        <span className="answer-pane-copy-all">
          <CopyIconButton value={answer.text} label="Copy answer as Markdown" />
        </span>
      ) : null}
      {/* The pane's switch, directly under the text and ABOVE the composer.
          design.md's order, and the reason for it: the composer is the reply,
          so the switch that decides what the pane does belongs with the pane
          rather than under the box you type into. Whether a new answer opens
          the pane is not here: that is one Settings preference, read by
          `TerminalView` when an answer arrives. Outside the scroll container,
          so the row stays put while the text scrolls. */}
      <div className="answer-pane-meta">
        <label className="answer-pane-meta-label" htmlFor={`answer-pane-composer-on-${sessionId}`}>
          <input
            id={`answer-pane-composer-on-${sessionId}`}
            data-testid={`answer-pane-composer-on-${sessionId}`}
            type="checkbox"
            checked={composerOn}
            onChange={() => setComposerOn(!composerOn)}
          />
          {/* Named for what it does, not for the component it mounts: the
              switch decides whether a reply typed here goes to the terminal. */}
          Send to terminal
        </label>
      </div>
      {/* The reply itself — the grip, the field and its key hint. Absent
          entirely when the switch above is off, not hidden, so the height it
          held goes back to the body, which is what "returns its height to the
          text" means. */}
      {composerOn ? (
        <AnswerComposer sessionId={sessionId} send={send} onSubmitted={onSubmitted} />
      ) : null}
      {/* The pane's own bottom edge — dragged up to uncover the terminal
          without closing the pane. Its own row at the foot of the column,
          rather than a rail floating on the pane's bottom edge, for the reason
          the composer's grip is a row: an absolutely positioned rail there
          would sit on the last 8px of whatever row happened to end up beneath
          it — the key hint, or the field itself when the composer is off.

          Gated here as well as inside the primitive, exactly as the grip is:
          the row has a height of its own, so a mobile pane that rendered it
          would keep the 7px the hidden rail no longer fills. */}
      {narrowViewport ? null : (
        <div className="answer-pane-drag">
          <span className="answer-pane-grip-bar" aria-hidden />
          <PaneResizer
            // Named for the cell, unlike the composer's grip: two cells can
            // have their panes open at once, and two rails answering to one
            // test id is a trap for whoever writes that test.
            name={`answer-pane-${sessionId}`}
            edge="bottom"
            label="Resize the answer pane"
            {...dragProps}
          />
        </div>
      )}
    </div>
  );
}
