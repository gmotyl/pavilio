import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Pause, Play } from "lucide-react";
import MarkdownRenderer from "../markdown/MarkdownRenderer";
import { CopyIconButton } from "../shell/CopyIconButton";
import PaneResizer from "../shell/PaneResizer";
import { useResizableRow, type RowBounds } from "../shell/useResizableRow";
import { ANSWER_PANE_FULL_HEIGHT, preferences } from "../../preferences/declarations";
import { usePreference, useScopedPreference } from "../../preferences/usePreference";
import { ANSWER_COMPOSER_BOUNDS, AnswerComposer } from "./AnswerComposer";
import { AnswerWaiting, AnswerWaitingNext } from "./AnswerWaitingView";
import { noteRetrySentOn } from "./answerRetry";
import { beginWaiting, releaseAnswer, useAnswerHeld, useAnswerWaiting } from "./answerWaiting";
import { projectOfSession } from "./sessionProject";
import { useActivityState } from "./useTerminalActivityChannel";
import { speechCacheState, subscribeSpeechCache } from "../speech/synth";
import type { GridSpeech, SpeechUnit } from "../speech/types";
import { unplayedSinceLastPlayed } from "../speech/unreadAnswers";
import { newestUtteranceId, utteranceUnderCursor } from "../speech/utteranceQueue";
import { getStoredVoice } from "../speech/voices";
import { type UnitToBlocks, alignToSegments, layoutRail, matchableBlocks } from "./layoutRail";
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
   * The cell's own PTY write, handed straight to the composer. `TerminalView`
   * reads it off the live instance at call time — the same one the bar's
   * launcher pills send with, so a reply typed here and a pill clicked up there
   * reach the shell by one transport.
   *
   * It reports whether the frame reached an OPEN socket; the composer is what
   * acts on that, by keeping a reply the socket refused.
   */
  send: (data: string) => boolean;
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

/** The attribute a matched block carries, and the one the spoken block adds. */
const BLOCK_ATTRIBUTES = ["data-unit", "data-speaking"] as const;

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
 * under the speech row, with the spoken block marked and a rail of unit
 * segments — the scrubber turned vertical — beside the text.
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
 * matchable blocks of the renderer's `.prose` root, matches their
 * `textContent` against the units' `source`, and sets `data-unit` and
 * `data-speaking` on the elements themselves. It first strips
 * those attributes from every marked element, because react-markdown reuses
 * elements across a content change and React never touches attributes it did
 * not set. Those blocks are not simply the `.prose` children: a list is one
 * element to react-markdown but one paragraph per item to the voice, so
 * `matchableBlocks` flattens each list to its items and the marks land on the
 * `li`, never on the `ul` that only holds them.
 *
 * ## Why reading starts from a Play button, and the text is just text
 *
 * The blocks used to be the jump: a matched block was `role="button"` with a
 * tab stop, and a delegated click anywhere inside it — a link included —
 * started the voice there. So a link in an answer could not be followed
 * without also being read to, and selecting a sentence restarted the unit.
 * Now the blocks are plain elements and each unit has a real button element in
 * the rail column — Enter and Space are the browser's, no handler of ours —
 * labelled "Read from here", or "Pause" on the unit the voice is reading.
 *
 * On a pointer device a unit's Play shows only while its block (or the button
 * itself) is hovered or holds focus: one `hoveredUnit`, fed by delegated
 * `pointerover` / `focusin` on the body, because the blocks are react-markdown's
 * and cannot carry handlers of their own. The button carries `data-shown`; the
 * stylesheet does the rest, including `hover: none`, where every Play is shown
 * dimmed because there is no hover to reveal it. A unit's Play is laid out from
 * its rail segment's geometry (`alignToSegments`), so it exists exactly where
 * a segment does: code, tables, diagrams — anything speech turned into a
 * sentinel — are no unit's and have no Play beside them. A fence that opens or
 * closes the answer is the one exception to "no unit's": it is a unit of its
 * own that matches no block, so it keeps its (minimum) segment but gets no
 * Play (`blocklessUnits`) — there is no block to sit beside.
 *
 * The rail beside the text mirrors the scrubber exactly: a pointer affordance,
 * no role, `aria-hidden`, with the same segment states from the same
 * `segmentStateFor`. The Play buttons are what the keyboard and assistive tech
 * get instead of fifteen phantom segment buttons.
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
 * The rail spans the same blocks the marks went on — list items included,
 * because a list is one element to react-markdown but several paragraphs to
 * the voice — so a unit that speaks items 3 to 5 spans exactly those items
 * instead of being stacked under the whole list as a stub.
 *
 * ## Why the body, and only the body, hands over while a reply is pending
 *
 * Sending leaves the previous answer on screen, where it reads as the reply to
 * the question just asked. So the composer's `send` is wrapped here — the
 * composer raises the keystroke and knows nothing about the pane above it,
 * while the pane knows which utterance the body was showing when the draft went
 * out — and the body renders {@link AnswerWaiting} in place of the rail and the
 * text until that wait ends.
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
 * scrolls the body once so that unit's first block sits a third of the way
 * down — in the layout pass, after the marks, so the first frame is already
 * there and the reader never sees the top of the answer and then a jump.
 * After that the scroll position is the reader's: a unit boundary moves the
 * block mark and the rail's playhead, never the text, and neither does the
 * body being rebuilt on the way out of a wait. Pulling the text along under
 * someone who is reading, or who has scrolled elsewhere on purpose, costs
 * more than the mark and the playhead already say about where the voice is.
 */
export function AnswerPane({
  sessionId,
  speech,
  onClose,
  send,
}: AnswerPaneProps) {
  // Global, and read here rather than passed in: whether a pane carries a
  // composer at all is one answer for the whole panel, so the pane reads and
  // writes it directly.
  const [composerOn, setComposerOn] = usePreference(preferences.answerComposerEnabled);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const playsRef = useRef<HTMLDivElement>(null);
  /** The unit whose block (or Play) the pointer or focus is on — see the note on the component. */
  const [hoveredUnit, setHoveredUnit] = useState<number | null>(null);
  /**
   * One character per unit, `x` where the unit matched no block: a fence that
   * opens or closes the answer is a unit of its own (`⟦code⟧`) with nothing
   * beside it to read from, so it gets no Play. A string, so the marking pass
   * can set it on every run and React bails out when nothing changed.
   */
  const [blocklessUnits, setBlocklessUnits] = useState("");
  /** The last mapping the marks were drawn from, for a re-layout the observer asks for. */
  const unitToBlocksRef = useRef<UnitToBlocks>([]);
  // The observer callback outlives its closure and needs the current units
  // for the weight of a shared block; mirrored next to the block map.
  const unitsRef = useRef<readonly SpeechUnit[]>([]);

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
  // Told, not asked: the rail reads the cache during render, and the cascade
  // fills it from places the pane cannot see. The value is discarded —
  // subscribing IS the point.
  useSyncExternalStore(subscribeCacheVersion, readCacheVersion);

  const voice = getStoredVoice();
  const text = answer?.text ?? "";
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
  // so Escape works at once and the read → Escape → type loop needs no mouse.
  useEffect(() => {
    rootRef.current?.focus();
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

  // Escape closes the pane from wherever focus is while it is open —
  // switching browser tabs and coming back leaves it on `document.body`, a
  // click leaves it on the bar or in the cell's own terminal — and a pane
  // that then ignores Escape reads as stuck. Greg's rule (2026-09-16): if the
  // terminal has focus and the pane is open, Escape closes the pane.
  //
  // Capture phase on `window`, not a bubble listener on `document`: xterm
  // reads keys from its own textarea's `keydown` handler, at the target, and
  // a key that reached it is already in the PTY by the time it bubbles.
  // Capture on the window runs before the target phase, and `stopPropagation`
  // here ends the dispatch for every node still ahead in the path — the
  // textarea's own target-phase listener included (only another listener on
  // `window` itself would need `stopImmediatePropagation`) — so with
  // `preventDefault` the shell never sees the key. The accepted
  // cost for a TUI that uses Escape (Claude Code interrupts on it): the first
  // Escape closes the pane, the second interrupts — one deliberate keystroke
  // more, in exchange for a pane that always answers the key it advertises.
  //
  // Only THIS cell's terminal, though. The pane is mounted by `TerminalView`
  // as a sibling of the xterm container inside the terminal area — the
  // positioned box that holds the two — so an xterm under the root's parent is
  // the cell's own; an xterm anywhere else is another cell's TUI, and its
  // Escape is left alone.
  //
  // An Escape inside the pane never gets here: this listener bails out when
  // the target is inside the root, so `onClose` runs once per keypress — from
  // the root's own `onKeyDown` below, whose `stopPropagation` is what keeps
  // the key from the cell, not what prevents a double close.
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
  //
  // ...and when the body hands back from waiting, which is a change none of
  // those three can stand for. The reply's text lands on the commit that is
  // STILL showing the wave — the arrival is noticed by the bar's effect, so
  // the wait ends one render later — and on that commit there is no `.prose`
  // to mark, so the pass bails out having spent the `text` change. The column
  // that comes back next carries identical deps and would never be marked
  // again: no rail, no Play beside its block, no highlight, until the pane
  // was remounted.
  // (Regression: "the block marks are lost after the first reply".)
  useLayoutEffect(() => {
    const prose = bodyRef.current?.querySelector<HTMLElement>(".prose");
    if (!prose) return;
    const children = matchableBlocks(prose);
    // Strip first: react-markdown reuses elements across a content change,
    // and React leaves attributes it did not set exactly where they were. The
    // whole subtree, not just this answer's blocks: the marks sit on list items
    // too, and the last answer's items are nowhere near this one's children.
    // Do NOT narrow this to `.prose`'s direct children — an `li` is not one, so
    // a narrow strip never clears `data-speaking` from an item, and by the end
    // of a list every item the voice has already read is still marked as
    // speaking (regression: "the previous unit's items stop speaking").
    for (const marked of Array.from(prose.querySelectorAll("[data-unit]"))) {
      for (const attribute of BLOCK_ATTRIBUTES) marked.removeAttribute(attribute);
    }

    const { blockToUnit, unitToBlocks } = matchUnitsToBlocks(
      units,
      children.map((child) => child.textContent ?? ""),
    );
    unitToBlocksRef.current = unitToBlocks;
    unitsRef.current = units;
    setBlocklessUnits(unitToBlocks.map((blocks) => (blocks.length === 0 ? "x" : "-")).join(""));
    children.forEach((child, blockIndex) => {
      const unit = blockToUnit[blockIndex];
      if (unit === null) return;
      child.setAttribute("data-unit", String(unit));
      if (unit === unitIndex) child.setAttribute("data-speaking", "");
    });
    // The marks moved or the text changed: the rail follows in the same commit.
    layoutRail(bodyRef.current, railRef.current, unitToBlocks, units);
    alignToSegments(railRef.current, playsRef.current);
  }, [text, units, unitIndex, waiting]);

  // A blockless unit's Play turns into a placeholder one render after the
  // marking pass found it, so the buttons that layer holds are new elements
  // with no `top` yet: line them up again, still before paint.
  useLayoutEffect(() => {
    alignToSegments(railRef.current, playsRef.current);
  }, [blocklessUnits]);

  // Re-lay the rail when the body or the text column changes size — see the
  // note on the component. The pane's own boxes, never the xterm container.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    // Read the refs when the observer fires, not when it is created: the
    // callback outlives this closure's snapshot of the boxes.
    const observer = new ResizeObserver(() => {
      const b = bodyRef.current;
      const r = railRef.current;
      if (!b || !r) return;
      layoutRail(b, r, unitToBlocksRef.current, unitsRef.current);
      alignToSegments(r, playsRef.current);
    });
    observer.observe(body);
    if (textRef.current) observer.observe(textRef.current);
    return () => observer.disconnect();
    // `waiting` is in here because the text column is UNMOUNTED while the body
    // is waiting: an observer kept across the handover would be holding the
    // dead element and would never see the new one, so the rail would stop
    // re-laying itself after the first reply.
  }, [waiting]);

  // Land on the voice once, when the pane mounts mid-run, and only when there
  // is somewhere to scroll to. Never again while it stays open — not on a unit
  // boundary, not on a tick, not when the body comes back from a wait: the
  // mark and the playhead follow the voice, the scroll position is the
  // reader's. A layout effect, declared after the marking one: the
  // `data-unit` it looks up is set in the same pass, and the scroll lands
  // before the first paint.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (unitIndex === null || !body) return;
    if (body.scrollHeight <= body.clientHeight) return;
    const block = body.querySelector<HTMLElement>(`[data-unit="${unitIndex}"]`);
    if (!block) return;
    body.scrollTo({ top: Math.max(0, block.offsetTop - body.clientHeight / 3) });
    // Mount only, deliberately: `unitIndex` is read as it stands when the pane
    // opens, and a later change must not bring this back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jumpTo = useCallback(
    (unit: number): void => {
      speech.onJumpToUnit(sessionId, unit);
    },
    [speech, sessionId],
  );

  /**
   * The unit an event happened over: the matched block it is inside, or the
   * Play button it is on — so moving from a block onto its own button keeps
   * that button shown instead of flickering it off.
   */
  const unitAt = (target: EventTarget | null): number | null => {
    if (!(target instanceof Element)) return null;
    const marked = target.closest<HTMLElement>("[data-unit], [data-play-unit]");
    if (!marked || !bodyRef.current?.contains(marked)) return null;
    return Number(marked.dataset.unit ?? marked.dataset.playUnit);
  };

  // Whether the voice is reading this cell right now — the bar's own test for
  // offering Pause, so the two controls never disagree.
  const cellState = speech.stateFor(sessionId);
  const voiceIsReading = cellState === "speaking" || cellState === "stalled";

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
      style={
        appliedHeight === null
          ? undefined
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
            }
      }
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
        // Delegated: the blocks are react-markdown's elements, so what the
        // pointer and focus are over is read here, on the ancestor that
        // outlives them. This only reveals a Play; nothing here plays.
        onPointerOver={(e) => setHoveredUnit(unitAt(e.target))}
        onPointerLeave={() => setHoveredUnit(null)}
        onFocus={(e) => setHoveredUnit(unitAt(e.target))}
        onBlur={(e) => {
          if (!bodyRef.current?.contains(e.relatedTarget as Node | null)) setHoveredUnit(null);
        }}
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
          {/* The rail column: the segments, and the Play buttons over them.
              Not positioned itself, so the body stays the `offsetParent` the
              rail's geometry is measured against. */}
          <div className="answer-pane-gutter">
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
                      <span
                        className="answer-pane-head"
                        data-testid={`answer-pane-head-${sessionId}`}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
            {/* One Play per unit, each level with the top of its segment — see
                `alignToSegments`. The k-th button is unit k's. */}
            <div ref={playsRef} className="answer-pane-plays">
              {units.map((_unit, index) => {
                // No block, no Play: nothing sits beside it to read from (the
                // segment still jumps there, the bar still pauses it). A bare
                // placeholder keeps the k-th child unit k's for
                // `alignToSegments`.
                if (blocklessUnits[index] === "x") {
                  return <span key={index} hidden />;
                }
                const playing = voiceIsReading && index === unitIndex;
                return (
                  <button
                    key={index}
                    type="button"
                    className="answer-pane-play"
                    data-testid={`answer-pane-play-${sessionId}-${index}`}
                    data-play-unit={index}
                    data-shown={playing || index === hoveredUnit ? "" : undefined}
                    data-playing={playing ? "" : undefined}
                    aria-label={playing ? "Pause" : "Read from here"}
                    title={playing ? "Pause" : "Read from here"}
                    onClick={() => (playing ? speech.onPause(sessionId) : jumpTo(index))}
                  >
                    {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
                  </button>
                );
              })}
            </div>
          </div>
          <div ref={textRef} className="answer-pane-text">
            {answer ? <MarkdownRenderer content={answer.text} /> : null}
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
