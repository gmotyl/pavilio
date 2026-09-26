/**
 * The boot legend: the two controls nothing else in the panel teaches.
 *
 * ## What it is for
 *
 * A cell that has just been asked to start an agent has a pane full of wave and
 * a row of controls the user has never met. Two of them are untaught anywhere
 * else: the EYE, which shows and hides the answer pane, and the TRANSPORT,
 * which replays previous answers. The composer carries its own hint line —
 * `ENTER SENDS · SHIFT+ENTER NEWLINE · ESC CLOSES THE ANSWER`, forty pixels
 * under the field — so a third callout naming the composer, Enter or Esc would
 * name what is already named, and one of the tests below is there to keep it
 * that way.
 *
 * ## The legend is now a DERIVATION, not a flag
 *
 * `TerminalView` no longer arms or disarms anything: the legend is rendered
 * whenever `answerOpen && !waiting && answer === null && speechBarVisible` —
 * see the long note on `legendShown` there. That has one consequence this file
 * has to get right that the old, flag-driven version did not: A LAUNCHER PRESS
 * DOES NOT, BY ITSELF, SHOW THE LEGEND.
 *
 * `noteAgentStarting` (called from `LauncherPills`' `onDelivered`, in the same
 * synchronous callback that opens the pane) hands the body to the wave AT
 * ONCE — `answerWaiting.ts`'s own words — so `waiting` is already `true` by
 * the time the pane's `open` flips `true` too; there is no commit in between
 * where the pane is open, empty, and not waiting. The legend for a
 * launcher-pressed cell therefore appears only later, once that wait ends with
 * nothing having arrived (a silent boot) — a genuinely different moment from
 * the press itself, and its own test below.
 *
 * The ACTIVITY trigger is different: a busy transition opens a debounce window
 * before it earns a claim on the body (`answerWaveDebounceMs`), and reading
 * `waiting` — never `activity` — is what lets the legend stand during that
 * window on a cell whose pane is already open and empty by some other means
 * (the eye). That is a real, observable gap, and it is what
 * "the waiting state replaces the legend" drives.
 *
 * ## Why it is driven through the whole cell
 *
 * The legend is a claim about the CELL's layering, not about a component: it
 * has to render as a sibling of the speech row so that its leader lines can
 * reach controls in that row, and the answer pane — which is absolutely
 * positioned inside the terminal-area wrapper — cannot draw outside its own
 * box. A test of the component alone would assert that two divs exist; what
 * has to hold is that the legend is mounted where its leaders can arrive, on a
 * cell driven by a real launcher press or a real eye press through a real
 * socket.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cssRule } from "../../shell/__tests__/hamburgerGeometry";
import { prepare } from "../../speech/prepare";
import { ALL_PREFERENCES, preferences } from "../../../preferences/declarations";
import type { GridSpeech, SpeechUnit, Utterance } from "../../speech/types";
import { emptyUtteranceQueue, type UtteranceQueue } from "../../speech/utteranceQueue";

/**
 * The terminal instance stand-in. `send` reports delivery the way the real one
 * does — `true` only when the frame reached an OPEN socket — because the
 * legend's own launcher-press test follows a DELIVERED press and nothing else.
 */
const term = vi.hoisted(() => ({ writes: [] as string[], accept: true }));

vi.mock("../terminalInstances", () => {
  const holders = new Map<string, HTMLDivElement>();

  return {
    acquireTerminal: (sessionId: string) => {
      let holder = holders.get(sessionId);
      if (!holder) {
        holder = document.createElement("div");
        holder.setAttribute("data-holder", sessionId);
        holders.set(sessionId, holder);
      }
      return {
        sessionId,
        terminal: { cols: 80, rows: 24, refresh: () => {}, focus: () => {} },
        fitAddon: {},
        holder,
        ws: { readyState: 1, send: () => {} },
        send: (data: string) => {
          if (!term.accept) return false;
          term.writes.push(data);
          return true;
        },
        fit: () => {},
        focus: () => {},
        addExitListener: () => () => {},
        reopen: () => {},
        onWsChange: () => () => {},
      };
    },
    releaseTerminal: () => {},
    // Present even where nothing here lights an LED or reconnects: a factory
    // missing an export fails as an UNHANDLED error beside a green result,
    // which is the worst shape a failure can take.
    sendDismiss: () => {},
    THEME: new Proxy({}, { get: () => "#000000" }),
    followBottomAcrossResize: (_terminal: unknown, fit: () => void) => fit(),
    hasExited: () => false,
    getConnectionState: () => "unattached",
    onConnectionChange: () => () => {},
    reconnectSession: () => {},
    reconnectOnActivate: () => {},
    reportAutoBlankReopen: () => {},
  };
});

vi.mock("../useMobileReconnect", () => ({ useMobileReconnect: () => {} }));

// mermaid pulls in a browser-only rendering stack the pane never needs here.
vi.mock("../../markdown/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

// The synthesis cache the bar peeks into: everything is cold.
vi.mock("../../speech/synth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../speech/synth")>()),
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

// Imported after the mocks so they pick them up.
const { TerminalView } = await import("../TerminalView");
const { forgetAnswerPane } = await import("../answerPaneState");
const { __resetAnswerWaitingForTests, getAnswerWaiting } = await import("../answerWaiting");
const { __resetPtySubmitForTests } = await import("../ptySubmit");
const { _applyEventForTests, _resetForTests } = await import("../useTerminalActivityChannel");

const SESSION = "cell-a";
const OTHER = "cell-b";

const ANSWER = "The migration finished, so the deploy is unblocked.";

/** Shared, because a `useSyncExternalStore` snapshot must be referentially
 *  stable between notifications — a fresh value per call is a render loop. */
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);

/**
 * A cell that has never spoken — `empty`, so the row carries launcher pills
 * beside the (disabled) transport — with one answer it can be made to receive.
 */
type Host = GridSpeech & { arrive: () => void };

function makeSpeech(sessionId: string): Host {
  let queue: UtteranceQueue = emptyUtteranceQueue;
  let spoken = false;
  const units = prepare(ANSWER).units;
  const utterance: Utterance = { id: "u-1", sessionId, text: ANSWER, at: 1 };

  return {
    arrive: () => {
      queue = { ...emptyUtteranceQueue, current: utterance };
      spoken = true;
    },
    stateFor: () => (spoken ? "ready" : "empty"),
    queueFor: () => queue,
    heardFor: () => NOTHING_HEARD,
    unitsFor: () => (spoken ? units : NO_UNITS),
    subscribeProgress: () => () => {},
    progressFor: () => null,
    unitDurationsFor: () => NO_DURATIONS,
    armedSessionId: null,
    onSpeak: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onNewestAnswer: vi.fn(),
    onArm: vi.fn(),
    onJumpToUnit: vi.fn(),
    onSeekWithinUnit: vi.fn(),
  };
}

/** MarkdownRenderer calls useNavigate, so the cell needs a router. */
const cell = (speech: GridSpeech, sessionId = SESSION, speechBarVisible = true) => (
  <MemoryRouter>
    <TerminalView sessionId={sessionId} speech={speech} speechBarVisible={speechBarVisible} />
  </MemoryRouter>
);

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const legend = (sessionId = SESSION): HTMLElement | null =>
  screen.queryByTestId(`boot-legend-${sessionId}`);
const callouts = (sessionId = SESSION): HTMLElement[] =>
  Array.from(legend(sessionId)?.querySelectorAll(".boot-legend-callout") ?? []);
const pane = (sessionId = SESSION): HTMLElement | null =>
  screen.queryByTestId(`answer-pane-${sessionId}`);
const eye = (sessionId = SESSION): HTMLElement =>
  screen.getByTestId(`speech-bar-eye-${sessionId}`);
const row = (sessionId = SESSION): HTMLElement => screen.getByTestId(`speech-bar-${sessionId}`);
const launcher = (sessionId = SESSION): HTMLElement =>
  screen.getByTestId(`speech-bar-launch-${sessionId}-0`);
const composer = (sessionId = SESSION): HTMLTextAreaElement =>
  screen.getByTestId(`answer-pane-composer-${sessionId}`) as HTMLTextAreaElement;

/**
 * Lets a launcher submit finish. The body is written inside the click, but the
 * return that runs it is a write of its own a gap later (`ptySubmit`), and a
 * timer left pending would fire into the next test's socket.
 */
async function settleSubmit(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
}

/** An activity broadcast for the cell, as the server sends it. */
let at = 0;
function activity(state: "idle" | "busy" | "attention", sessionId = SESSION): void {
  at += 1;
  act(() => {
    _applyEventForTests({ sessionId, state, at });
  });
}

/** The injected tuning document — the busy debounce, shortened so a test can
 *  actually outlive it without fake timers under a React tree. */
type TuningGlobals = { __PAVILIO_TUNING__?: { answerWaveDebounceMs?: number } };
const globals = globalThis as unknown as TuningGlobals;

const CSS = readFileSync(resolve("src/index.css"), "utf8");

// ---------------------------------------------------------------------------
// THE CASCADE RIG — the real stylesheet, in the document, over real elements.
//
// A regex over `index.css` cannot fail the way this feature failed. The
// reduced-motion rule for the legend WAS in the file, in the one query, saying
// `animation: none` — and the callouts animated anyway, because a rule 350
// lines further down said `animation: boot-legend-in 180ms` at the very same
// specificity and source order broke the tie. Every assertion that matters
// below therefore goes through `getComputedStyle` on a rendered node with the
// shipped sheet loaded, which is the only form that reads the cascade rather
// than the text.
// ---------------------------------------------------------------------------

/** The shipped stylesheet in the document, and a handle to take it out again. */
function injectStylesheet(css: string = CSS): () => void {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  return () => style.remove();
}

/**
 * The same stylesheet with the reduced-motion query asking something jsdom
 * answers YES to.
 *
 * jsdom evaluates no media CONDITION except `screen` — a rule inside
 * `@media (prefers-reduced-motion: reduce)` is dropped entirely, whatever the
 * preference, and there is no `matchMedia` to set. So the condition is
 * rewritten and NOTHING else is: the block keeps its contents, its selectors
 * and — the whole point — its POSITION in the file, which is the axis the bug
 * lived on. jsdom's cascade is source-order, so a block that has been moved
 * below the rules it must beat wins here exactly as it does in a browser.
 *
 * The rewrite is asserted to have found its one query rather than assumed: a
 * silent miss would leave the block inert and the test green for the wrong
 * reason... except that inert is also what the BUG looks like, so a miss fails
 * loudly here. The count is pinned anyway, because one query is what keeps the
 * two arms of it in step by construction.
 */
function stylesheetWithReducedMotionOn(): string {
  const query = "@media (prefers-reduced-motion: reduce)";
  const occurrences = CSS.split(query).length - 1;
  expect(occurrences, "index.css must hold exactly one reduced-motion query").toBe(1);
  return CSS.replace(query, "@media screen");
}

/**
 * A cell laid out, for a component that measures.
 *
 * jsdom lays nothing out and every rect is zero, so the legend's own
 * measurement — which is how it finds its controls AND how wide its cell is —
 * has nothing to read. This hands it a plausible cell: the overlay is the
 * cell, `inset: 0`, and the two named controls sit in the row at its top.
 *
 * `top: 6` and `height: 44` are the row's own numbers: `.speech-bar-row` is
 * 56px tall with `padding: 6px 8px` and `align-items: center`, and
 * `.speech-bar-btn` is a 44px square — 6 + 44 + 6 = 56. A control's centre is
 * therefore 28px down, which one of the tests below re-derives from the
 * stylesheet rather than trusting this comment.
 */
const CONTROL_TOP = 6;
const CONTROL_SIZE = 44;
const CONTROL_CENTRE_Y = CONTROL_TOP + CONTROL_SIZE / 2;

function stubLayout(cellWidth: number, cellHeight = 400): void {
  const box = (left: number, top: number, width: number, height: number): DOMRect =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;

  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ): DOMRect {
    if (this.classList.contains("boot-legend")) return box(0, 0, cellWidth, cellHeight);
    const testId = this.getAttribute("data-testid") ?? "";
    if (testId === `speech-bar-playpause-${SESSION}`) {
      return box(120, CONTROL_TOP, CONTROL_SIZE, CONTROL_SIZE);
    }
    if (testId === `speech-bar-eye-${SESSION}`) {
      return box(cellWidth - 52, CONTROL_TOP, CONTROL_SIZE, CONTROL_SIZE);
    }
    return box(0, 0, 0, 0);
  });
}

/** Which controls the legend is currently carrying a callout for. */
const calloutTargets = (): string[] =>
  callouts()
    .map((c) => c.getAttribute("data-leads-to") ?? "")
    .sort();

const calloutFor = (key: "transport" | "eye"): HTMLElement | null =>
  screen.queryByTestId(`boot-legend-callout-${SESSION}-${key}`);

/** A leader path's start point, parsed out of the `d` it was drawn with. */
function leaderStart(key: "transport" | "eye"): { x: number; y: number } {
  const path = screen.getByTestId(`boot-legend-lead-${SESSION}-${key}`);
  const d = path.getAttribute("d") ?? "";
  const found = d.match(/^M\s+(-?[\d.]+)\s+(-?[\d.]+)\s+L\s+(-?[\d.]+)\s+(-?[\d.]+)$/);
  if (!found) throw new Error(`unreadable leader path: ${d}`);
  return { x: Number(found[1]), y: Number(found[2]) };
}

/** ...and its end point, the control's own centre. */
function leaderEnd(key: "transport" | "eye"): { x: number; y: number } {
  const path = screen.getByTestId(`boot-legend-lead-${SESSION}-${key}`);
  const d = path.getAttribute("d") ?? "";
  const found = d.match(/^M\s+(-?[\d.]+)\s+(-?[\d.]+)\s+L\s+(-?[\d.]+)\s+(-?[\d.]+)$/);
  if (!found) throw new Error(`unreadable leader path: ${d}`);
  return { x: Number(found[3]), y: Number(found[4]) };
}

const px = (value: string): number => Number.parseFloat(value);

/**
 * The pane opened with the eye, on a cell that has never spoken and has no
 * wait running — the plain "empty pane" case the derivation reads directly,
 * with none of the launcher-press timing this file's header explains.
 *
 * `cellWidth`, when given, stubs the layout BEFORE the mount so the legend's
 * own `useLayoutEffect` measures against it on the very first pass.
 */
function openLegend(cellWidth?: number, sessionId = SESSION): void {
  if (cellWidth !== undefined) stubLayout(cellWidth);
  render(cell(makeSpeech(sessionId), sessionId));
  fireEvent.click(eye(sessionId));
}

beforeEach(() => {
  at = 0;
  term.writes.length = 0;
  term.accept = true;
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  _resetForTests();
  __resetAnswerWaitingForTests();
  __resetPtySubmitForTests();
  forgetAnswerPane(SESSION);
  forgetAnswerPane(OTHER);
});

afterEach(() => {
  _resetForTests();
  __resetAnswerWaitingForTests();
  __resetPtySubmitForTests();
  forgetAnswerPane(SESSION);
  forgetAnswerPane(OTHER);
  delete globals.__PAVILIO_TUNING__;
  vi.unstubAllGlobals();
});

describe("the boot legend", () => {
  // -------------------------------------------------------------------------
  // The trigger: an open, empty, not-waiting pane — however it got that way.
  // -------------------------------------------------------------------------

  it("a launcher press goes straight to the wave, not the legend", async () => {
    render(cell(makeSpeech(SESSION)));
    expect(legend()).toBeNull();

    fireEvent.click(launcher());
    await settleSubmit();

    // The press landed and opened the pane — but `noteAgentStarting` hands the
    // body to the wave in the SAME callback that opens it (see the header), so
    // there is no commit in between where the pane is open, empty and not
    // waiting. The wave already has the body, and the legend defers to it.
    expect(term.writes).toEqual(["claude", "\r"]);
    expect(pane()).not.toBeNull();
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: false });
    expect(legend()).toBeNull();
  });

  it("a silent boot leaves the pane open with the legend", async () => {
    render(cell(makeSpeech(SESSION)));
    fireEvent.click(launcher());
    await settleSubmit();
    expect(legend()).toBeNull(); // the wave has the body, per the test above

    // The launched agent boots, works, and finishes without ever speaking —
    // the exit path Task 1 stopped closing the pane on.
    activity("busy");
    activity("idle");

    await waitFor(() =>
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: false, pending: false }),
    );
    // The pane stays open (Task 1), and its now-empty body falls through to
    // exactly what the derivation reads as "nothing else to show".
    expect(pane()).not.toBeNull();
    expect(legend()).not.toBeNull();
    expect(callouts()).toHaveLength(2);
  });

  it("the eye on an unspoken cell shows the legend", () => {
    render(cell(makeSpeech(SESSION)));
    expect(legend()).toBeNull();

    // No press, no send, no wait — just the control that opens the pane.
    fireEvent.click(eye());

    expect(pane()).not.toBeNull();
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: false, pending: false });
    expect(legend()).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // The two things that replace it, and the two that close it with the pane.
  // -------------------------------------------------------------------------

  it("an arriving answer replaces the legend", async () => {
    const speech = makeSpeech(SESSION);
    const view = render(cell(speech));
    fireEvent.click(eye());
    expect(legend()).not.toBeNull();

    // The answer the cell was opened for. There is something behind the
    // (previously empty) body now, and a legend over it would be covering the
    // thing the user opened the pane to see.
    speech.arrive();
    view.rerender(cell(speech));

    await waitFor(() => expect(legend()).toBeNull());
    expect(pane()).not.toBeNull();
  });

  it("the waiting state replaces the legend", async () => {
    // The genuine window `design.md`'s "The waiting hook still matters" is
    // about: unlike a launcher press or a send, a busy ACTIVITY transition
    // opens a debounce window before it earns a claim on the body, so on a
    // cell already open and empty by the eye there is a real gap where the
    // session is busy but `waiting` has not flipped yet — and the legend
    // stands through exactly that gap.
    globals.__PAVILIO_TUNING__ = { answerWaveDebounceMs: 20 };
    render(cell(makeSpeech(SESSION)));
    fireEvent.click(eye());
    expect(legend()).not.toBeNull();

    activity("busy");
    // Still inside the window: the activity changed, `waiting` has not.
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: false, pending: false });
    expect(legend()).not.toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: false });
    expect(legend()).toBeNull();
    expect(pane()).not.toBeNull();
  });

  it("Escape closes the pane and the legend with it", async () => {
    render(cell(makeSpeech(SESSION)));
    fireEvent.click(eye());
    expect(legend()).not.toBeNull();

    // `AnswerPane` closes on Escape in the window's own capture-phase
    // listener; the legend carries none of its own any more (see `BootLegend`)
    // — a closed pane simply fails `answerOpen` and the derivation follows.
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(pane()).toBeNull());
    expect(legend()).toBeNull();
  });

  it("hiding the bar closes the pane and the legend; showing it again reopens neither", () => {
    const speech = makeSpeech(SESSION);
    const view = render(cell(speech));
    fireEvent.click(eye());
    expect(legend()).not.toBeNull();
    expect(pane()).not.toBeNull();

    // The bar goes. `TerminalView` closes the pane rather than merely
    // covering it — a pane without its bar has no eye to close it.
    view.rerender(cell(speech, SESSION, false));
    expect(pane()).toBeNull();
    expect(legend()).toBeNull();

    // ...and bringing the bar back does not reopen either. Nothing here
    // remembers that the pane was open a moment ago, and there is no
    // once-per-browser flag left to bring the legend back on its own account.
    view.rerender(cell(speech, SESSION, true));
    expect(pane()).toBeNull();
    expect(legend()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // No memory: not once-per-browser, not once-per-cell.
  // -------------------------------------------------------------------------

  it("the legend is shown again on a second cell after it has been shown once", () => {
    const first = render(cell(makeSpeech(SESSION)));
    fireEvent.click(eye());
    expect(legend()).not.toBeNull();
    first.unmount();

    // Another cell, another agent, the same browser. There is no per-browser
    // "already taught" preference left to consult — see the acceptance test
    // below — so a second cell shows the legend exactly as the first one did.
    render(cell(makeSpeech(OTHER), OTHER));
    fireEvent.click(eye(OTHER));

    expect(legend(OTHER)).not.toBeNull();

    // And a THIRD mount of the very same session — a fresh store entry, as a
    // reloaded tab would see, so this isolates "no boot-legend-seen memory"
    // from `answerPaneState`'s own (unrelated, and deliberate) persistence
    // across a remount — shows it again too. "Shown once" is not a fact any
    // module here tracks any more.
    forgetAnswerPane(SESSION);
    render(cell(makeSpeech(SESSION), SESSION));
    fireEvent.click(eye());
    expect(legend()).not.toBeNull();
  });

  it("no boot-legend-seen preference is declared", () => {
    expect(ALL_PREFERENCES.some((def) => def.key === "terminal.bootLegend.seen")).toBe(false);
    expect(Object.keys(preferences)).not.toContain("bootLegendSeen");
  });

  // -------------------------------------------------------------------------
  // The composer is not just visible under the legend — it works.
  // -------------------------------------------------------------------------

  it("the composer under the legend takes focus and text", () => {
    render(cell(makeSpeech(SESSION)));
    fireEvent.click(eye());
    expect(legend()).not.toBeNull();

    const field = composer();
    field.focus();
    expect(document.activeElement).toBe(field);

    fireEvent.change(field, { target: { value: "still there?" } });
    expect(field.value).toBe("still there?");
    // Typing into the composer is not itself a gesture the derivation reads —
    // no send has happened yet, so the legend is exactly where it was.
    expect(legend()).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Everything else about `BootLegend` — untouched, and still worth holding.
  // -------------------------------------------------------------------------

  it("the legend mounts outside the answer pane", () => {
    render(cell(makeSpeech(SESSION)));
    fireEvent.click(eye());

    const up = legend();
    expect(up).not.toBeNull();
    const opened = pane();
    expect(opened).not.toBeNull();

    // Not pane content. The pane is absolutely positioned inside the
    // terminal-area wrapper and cannot draw outside that box — and both
    // controls the legend names are in the row ABOVE it.
    expect(opened!.contains(up!)).toBe(false);
    const area = opened!.parentElement!;
    expect(area.contains(up!)).toBe(false);

    // A sibling of the speech row and of the terminal area, at the cell level
    // the row itself sits at. That is what puts the row inside the legend's
    // own positioning context, so a leader can reach a control in it.
    expect(up!.parentElement).toBe(row().parentElement);
    expect(up!.parentElement).toBe(area.parentElement);
    expect(up!.parentElement!.contains(eye())).toBe(true);
    // And the legend does not CONTAIN the controls — it points at them.
    expect(up!.contains(eye())).toBe(false);
  });

  it("each leader ends on the control it names", () => {
    render(cell(makeSpeech(SESSION)));
    fireEvent.click(eye());

    // The transport strip and the eye are both on the row from mount, so each
    // leader has a real element to terminate on.
    const named = [`speech-bar-playpause-${SESSION}`, `speech-bar-eye-${SESSION}`];

    for (const testId of named) {
      const control = screen.getByTestId(testId);
      const dot = legend()!.querySelector(`circle[data-leads-to="${testId}"]`);
      expect(dot, `no leader dot for ${testId}`).not.toBeNull();
      // The endpoint was resolved FROM that element, not from a constant: a
      // stylesheet cannot assert that a line reaches a control, so the
      // component records which element it measured.
      expect(dot!.getAttribute("data-resolved")).toBe("1");
      expect(control).toBeInTheDocument();
      // ...and the callout beside it names the same control.
      const callout = legend()!.querySelector(`.boot-legend-callout[data-leads-to="${testId}"]`);
      expect(callout, `no callout for ${testId}`).not.toBeNull();
    }

    // Every callout points somewhere, and only at those two.
    expect(callouts().map((c) => c.getAttribute("data-leads-to")).sort()).toEqual(
      [...named].sort(),
    );
  });

  it("no callout names the composer, Enter or Esc", () => {
    render(cell(makeSpeech(SESSION)));
    fireEvent.click(eye());

    const text = legend()!.textContent ?? "";
    expect(text).not.toMatch(/\bcomposer\b/i);
    expect(text).not.toMatch(/\benter\b/i);
    expect(text).not.toMatch(/\besc(ape)?\b/i);
    // Nor by reference: no leader may terminate on the composer field.
    const targets = callouts().map((c) => c.getAttribute("data-leads-to") ?? "");
    expect(targets.some((t) => t.includes("composer"))).toBe(false);
  });

  it("the transport it names cannot be pressed under it, and is named anyway", () => {
    render(cell(makeSpeech(SESSION)));
    fireEvent.click(eye());
    expect(legend()).not.toBeNull();

    // The whole strip is `disabled` until the cell's first answer, so while
    // the legend is up there is no transport press for it to catch. The
    // callout still points there, because what it teaches is what the strip
    // is FOR.
    for (const control of ["previous", "playpause", "next"]) {
      expect(screen.getByTestId(`speech-bar-${control}-${SESSION}`)).toBeDisabled();
    }
    expect(legend()).not.toBeNull();
  });

  it("a reduced-motion preference stops the legend animating", () => {
    // The CALLOUT is the only animated part of the legend, and it is the part
    // the old spelling of this test could not see: a regex found
    // `.boot-legend { animation: none }` inside the query, ticked, and missed
    // that `.boot-legend-callout { animation: boot-legend-in 180ms }` — equal
    // specificity, 350 lines later — took the tie on source order. Measured in
    // headless Chrome under `--force-prefers-reduced-motion`, the callouts
    // animated. So the assertion is on the CASCADE, over the rendered box.
    const drop = injectStylesheet(stylesheetWithReducedMotionOn());
    try {
      openLegend(720);

      for (const key of ["transport", "eye"] as const) {
        const callout = calloutFor(key);
        expect(callout, `no ${key} callout`).not.toBeNull();
        expect(
          getComputedStyle(callout!).animation,
          `the ${key} callout still animates under reduced motion`,
        ).toBe("none");
      }

      // ...and the overlay and its leaders with them. `*` in the rule is meant
      // to cover a part of the ornament added later; these are the parts there
      // are today.
      expect(getComputedStyle(legend()!).animation).toBe("none");
      for (const node of Array.from(legend()!.querySelectorAll(".boot-legend-leads *"))) {
        expect(getComputedStyle(node).animation).toBe("none");
      }
    } finally {
      drop();
    }
  });

  it("the legend animates when nothing asks it not to", () => {
    // The other half, so "nothing animates" cannot pass by the arrival having
    // been deleted: with the query's condition left as shipped — one jsdom
    // never matches — the callout carries its arrival.
    const drop = injectStylesheet();
    try {
      openLegend(720);
      expect(getComputedStyle(calloutFor("eye")!).animation).toMatch(/boot-legend-in/);
    } finally {
      drop();
    }
  });

  // -------------------------------------------------------------------------
  // The CELL is what the legend has to fit in, and it is not the window.
  // -------------------------------------------------------------------------

  it.each([320, 360, 400])(
    "a %ipx cell carries the eye callout alone",
    (cellWidth) => {
      const drop = injectStylesheet();
      try {
        openLegend(cellWidth);

        // Two 190px boxes, each 10px in from its own edge, do not fit here —
        // and the fallback used to be keyed to `@media (max-width: 520px)`, a
        // VIEWPORT query, so a 320px cell on a 2560px monitor showed both and
        // they lay on top of each other by 124px. The eye is the one kept: it
        // is the control with no other way in.
        expect(calloutTargets()).toEqual([`speech-bar-eye-${SESSION}`]);
        expect(calloutFor("transport")).toBeNull();
        // ...and the one that stays spans the cell rather than keeping the
        // width it would have shared.
        expect(calloutFor("eye")!.getAttribute("data-solo")).toBe("1");
      } finally {
        drop();
      }
    },
  );

  it.each([440, 720, 1200])("a %ipx cell carries both, clear of each other", (cellWidth) => {
    const drop = injectStylesheet();
    try {
      openLegend(cellWidth);

      expect(calloutTargets()).toEqual(
        [`speech-bar-playpause-${SESSION}`, `speech-bar-eye-${SESSION}`].sort(),
      );

      // ...and they cannot be touching. Read off the rendered boxes rather
      // than out of the file, so the numbers are the ones the cascade actually
      // gives these two elements at this width.
      const transport = getComputedStyle(calloutFor("transport")!);
      const eyeStyle = getComputedStyle(calloutFor("eye")!);
      const widest = px(transport.maxWidth);
      const transportRight = px(transport.left) + widest;
      const eyeLeft = cellWidth - px(eyeStyle.right) - widest;
      expect(
        transportRight,
        `the two callouts overlap by ${transportRight - eyeLeft}px in a ${cellWidth}px cell`,
      ).toBeLessThanOrEqual(eyeLeft);
    } finally {
      drop();
    }
  });

  it("the cell the legend measures is its own, not the window", () => {
    // The distinction the viewport query could not make: a WIDE window with a
    // NARROW cell in it, which is what every 2x2 and 3x2 grid is. The window
    // here is jsdom's default 1024 and never changes.
    expect(window.innerWidth).toBeGreaterThan(520);
    const drop = injectStylesheet();
    try {
      openLegend(320);
      expect(calloutTargets()).toEqual([`speech-bar-eye-${SESSION}`]);
    } finally {
      drop();
    }
  });

  // -------------------------------------------------------------------------
  // A leader is a LINE BETWEEN TWO THINGS, and both ends have to land.
  // -------------------------------------------------------------------------

  it("each leader runs from its callout's edge to the control's centre", () => {
    const drop = injectStylesheet();
    try {
      openLegend(720);

      for (const key of ["transport", "eye"] as const) {
        const callout = calloutFor(key)!;
        const top = px(getComputedStyle(callout).top);
        const start = leaderStart(key);
        const end = leaderEnd(key);

        // The BOX end. This is the one that was wrong: the line started 60px
        // down and the box sat at 82px, so every leader was a stub floating
        // 18px clear of the thing it was supposed to name, at every width.
        expect(
          Math.abs(top - start.y),
          `the ${key} leader stops ${Math.abs(top - start.y)}px short of its callout`,
        ).toBeLessThanOrEqual(1);

        // The CONTROL end, which was already right and stays right.
        expect(end.y).toBeCloseTo(CONTROL_CENTRE_Y, 5);
        expect(start.x).toBeCloseTo(end.x, 5);
        // ...and it runs UP from the box into the row, not down.
        expect(start.y).toBeGreaterThan(end.y);
      }
    } finally {
      drop();
    }
  });

  it("the row's own numbers are what the leader arithmetic assumes", () => {
    // The drift guard for the comment the geometry reasons from. Preflight
    // makes every box `border-box`, so `.speech-bar-row`'s 56px is the WHOLE
    // row, padding included — a control centred in it is 28px down, and the
    // bar's hairline is below the row rather than inside it.
    const drop = injectStylesheet();
    try {
      openLegend(720);
      const barRow = row().querySelector(".speech-bar-row") as HTMLElement;
      const style = getComputedStyle(barRow);
      const control = getComputedStyle(eye());

      // The proof that the padding is INSIDE the declared height, which is
      // where the old "56px of row plus its hairline" went wrong: the row's own
      // 56 is already its 6px padding, its 44px control and its 6px padding.
      expect(px(style.height)).toBe(
        px(style.paddingTop) + px(control.height) + px(style.paddingBottom),
      );
      // ...so a control centred in it sits at half of that.
      expect(px(style.height) / 2).toBe(CONTROL_CENTRE_Y);

      // And the hairline is the BAR's, below the row rather than inside it —
      // read as a declaration because jsdom computes no shorthand carrying a
      // `var()`, and there is no cascade question here to get wrong.
      expect(cssRule(".speech-bar")).toMatch(/border-bottom:\s*1px solid/);
    } finally {
      drop();
    }
  });
});
