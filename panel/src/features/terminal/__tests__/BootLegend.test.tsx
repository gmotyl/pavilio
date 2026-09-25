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
 * ## Why it is driven through the whole cell
 *
 * The legend is a claim about the CELL's layering, not about a component: it
 * has to render as a sibling of the speech row so that its leader lines can
 * reach controls in that row, and the answer pane — which is absolutely
 * positioned inside the terminal-area wrapper — cannot draw outside its own
 * box. A test of the component alone would assert that two divs exist; what
 * has to hold is that the legend is mounted where its leaders can arrive, on a
 * cell driven by a real launcher press through a real socket.
 *
 * ## Why the press is the only trigger
 *
 * The waiting state has three, and only one of them is a user asking for an
 * agent they have never seen work. A composer send comes from a pane the user
 * already opened and typed into; a busy transition is the agent's own doing and
 * arrives on cells the user has been driving for hours. Both are pinned below
 * as things that show NOTHING, because a legend on either would be teaching a
 * surface already in use.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cssRule } from "../../shell/__tests__/hamburgerGeometry";
import { prepare } from "../../speech/prepare";
import type { GridSpeech, SpeechUnit, Utterance } from "../../speech/types";
import { emptyUtteranceQueue, type UtteranceQueue } from "../../speech/utteranceQueue";

/**
 * The terminal instance stand-in. `send` reports delivery the way the real one
 * does — `true` only when the frame reached an OPEN socket — because the
 * legend follows a DELIVERED press and nothing else.
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
const { __resetAnswerWaitingForTests, getAnswerWaiting, noteAgentStarting } = await import(
  "../answerWaiting"
);
const { __resetPtySubmitForTests } = await import("../ptySubmit");
const { _applyEventForTests, _resetForTests } = await import("../useTerminalActivityChannel");
const { hasSeenBootLegend } = await import("../bootLegendSeen");
const { noteLauncherUsed } = await import("../launcherUse");

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

/**
 * Lets the submit finish. The body is written inside the click, but the return
 * that runs it is a write of its own a gap later (`ptySubmit`), and a timer
 * left pending would fire into the next test's socket.
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
 * measurement — which is how it finds its controls AND, now, how wide its cell
 * is — has nothing to read. This hands it a plausible cell: the overlay is the
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

/** Everything the legend puts on screen, so a boot can be driven in one line. */
async function boot(cellWidth?: number): Promise<void> {
  if (cellWidth !== undefined) stubLayout(cellWidth);
  render(cell(makeSpeech(SESSION)));
  fireEvent.click(launcher());
  await settleSubmit();
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
  it("a first delivered launcher press shows two callouts", async () => {
    render(cell(makeSpeech(SESSION)));
    expect(legend()).toBeNull();

    fireEvent.click(launcher());
    await settleSubmit();

    // The press landed and took the body, which is the state the legend rides.
    expect(term.writes).toEqual(["claude", "\r"]);
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: false });

    expect(legend()).not.toBeNull();
    // TWO. Design A of the mockup drew three; the composer's own hint line is
    // why the third one is not here.
    expect(callouts()).toHaveLength(2);
    // ...and the browser now carries the one fact this costs.
    expect(hasSeenBootLegend()).toBe(true);
  });

  it("the legend mounts outside the answer pane", async () => {
    render(cell(makeSpeech(SESSION)));
    fireEvent.click(launcher());
    await settleSubmit();

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

  it("each leader ends on the control it names", async () => {
    render(cell(makeSpeech(SESSION)));
    fireEvent.click(launcher());
    await settleSubmit();

    // The transport strip and the eye are both on the row from mount now, so
    // each leader has a real element to terminate on rather than a place a
    // control will later appear.
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

  it("no callout names the composer, Enter or Esc", async () => {
    render(cell(makeSpeech(SESSION)));
    fireEvent.click(launcher());
    await settleSubmit();

    const text = legend()!.textContent ?? "";
    expect(text).not.toMatch(/\bcomposer\b/i);
    expect(text).not.toMatch(/\benter\b/i);
    expect(text).not.toMatch(/\besc(ape)?\b/i);
    // Nor by reference: no leader may terminate on the composer field.
    const targets = callouts().map((c) => c.getAttribute("data-leads-to") ?? "");
    expect(targets.some((t) => t.includes("composer"))).toBe(false);
  });

  it("a second boot in the same browser shows nothing", async () => {
    const first = render(cell(makeSpeech(SESSION)));
    fireEvent.click(launcher());
    await settleSubmit();
    expect(legend()).not.toBeNull();
    first.unmount();

    // Another cell, another agent, the same browser. The fact is per-browser,
    // not per-cell: the user has been taught, and teaching them again is noise.
    render(cell(makeSpeech(OTHER), OTHER));
    fireEvent.click(launcher(OTHER));
    await settleSubmit();

    expect(getAnswerWaiting(OTHER)).toEqual({ waiting: true, pending: false });
    expect(legend(OTHER)).toBeNull();
  });

  it("a composer send shows no legend", async () => {
    render(cell(makeSpeech(SESSION)));
    // The eye is live from mount now, so the pane opens without a press.
    fireEvent.click(eye());
    const field = screen.getByTestId(`answer-pane-composer-${SESSION}`);
    fireEvent.change(field, { target: { value: "yes, both scopes" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await settleSubmit();

    // The wait is real — and it is a SEND's, which carries the pending mark.
    await waitFor(() => expect(getAnswerWaiting(SESSION)).toEqual({
      waiting: true,
      pending: true,
    }));
    // A user who typed into the pane has found the pane. Nothing to teach.
    expect(legend()).toBeNull();
    expect(hasSeenBootLegend()).toBe(false);
  });

  it("a busy transition shows no legend", async () => {
    globals.__PAVILIO_TUNING__ = { answerWaveDebounceMs: 20 };
    render(cell(makeSpeech(SESSION)));

    activity("busy");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    // The agent's own trigger, past its debounce: the body IS handed over...
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: false });
    // ...and it yields the very same snapshot a launcher press does, which is
    // exactly why the legend cannot key off the snapshot alone.
    expect(legend()).toBeNull();
    expect(hasSeenBootLegend()).toBe(false);
  });

  /**
   * DEFENDS `if (pending) return;` in the arming effect — the clause that
   * keeps a send's wait from being taught over.
   *
   * `a composer send shows no legend` above does NOT defend it. That test
   * never presses a pill, so `launcherUsed` is false and the effect leaves at
   * the FIRST guard; the `pending` clause is never reached and deleting it
   * changes nothing there. The only state that reaches it is the one below —
   * a launcher edge arriving while a draft's reply is still outstanding —
   * which the suite had no test for.
   */
  it("a launcher press made while a send is outstanding shows no legend", async () => {
    render(cell(makeSpeech(SESSION)));

    // The draft goes first: the pane is open, typed into, and its reply is
    // expected. That is the pane the legend would be teaching over.
    fireEvent.click(eye());
    const field = screen.getByTestId(`answer-pane-composer-${SESSION}`);
    fireEvent.change(field, { target: { value: "yes, both scopes" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await settleSubmit();
    await waitFor(() =>
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: true }),
    );

    // ...and NOW a pill is pressed. The cell is still `empty`, so the pills
    // are still on the row and the press lands and is delivered — a rising
    // edge, on a live wait, with the send's mark still up.
    fireEvent.click(launcher());
    await settleSubmit();

    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: true });
    // The press belongs to the send, which has a pane the user opened and
    // typed into. Nothing to teach, and the browser's one shot is not spent.
    expect(legend()).toBeNull();
    expect(hasSeenBootLegend()).toBe(false);
  });

  /**
   * DEFENDS `if (lastLauncherUsed.current) return;` — the rising-edge test the
   * long comment in `TerminalView` calls "load-bearing rather than tidy".
   *
   * `a busy transition shows no legend` above does NOT defend it: that cell
   * has never launched, so `!launcherUsed` turns the effect back one guard
   * earlier and the edge test is never reached. This is the case the comment
   * actually argues about — a cell whose flag is ALREADY up (it launched, and
   * a maximize or a preset remounted the view, which seeds the ref from the
   * current value) meeting a busy spell of the agent's own making later on.
   * A LEVEL test would arm there; only the edge test refuses.
   *
   * And the refusal must not come from `bootLegendSeen`: this browser has
   * never been shown the legend, which is exactly the first-meeting case where
   * conflating "which event teaches" with "how often" shows it on the wrong
   * trigger. So the seen flag is asserted still false, before and after.
   */
  it("a busy transition on a cell that already launched shows no legend", async () => {
    globals.__PAVILIO_TUNING__ = { answerWaveDebounceMs: 20 };
    // The earlier press, made before this view existed — the flag outlives the
    // component on purpose (`launcherUse`), so a remounted cell mounts with it
    // already true and `lastLauncherUsed` seeded from it.
    noteLauncherUsed(SESSION);
    render(cell(makeSpeech(SESSION)));
    expect(legend()).toBeNull();
    expect(hasSeenBootLegend()).toBe(false);

    // An hour later the agent goes to work on its own account, past the
    // debounce. Same snapshot a launcher press yields, same flag still true.
    activity("busy");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: false });
    expect(legend()).toBeNull();
    expect(hasSeenBootLegend()).toBe(false);
  });

  it("an arriving utterance dismisses it", async () => {
    const speech = makeSpeech(SESSION);
    const view = render(cell(speech));
    fireEvent.click(launcher());
    await settleSubmit();
    expect(legend()).not.toBeNull();

    // The answer the press was waiting for. There is something behind the wave
    // now, and a legend over it would be covering the thing it asked for.
    speech.arrive();
    view.rerender(cell(speech));

    await waitFor(() => expect(legend()).toBeNull());
    expect(pane()).not.toBeNull();
  });

  /**
   * DEFENDS `if (arrived) setLegendUp(false);` in the arrival effect.
   *
   * `an arriving utterance dismisses it` above does NOT defend it. There the
   * cell is idle, so the arrival ENDS the wait (`endStarting` finds no busy
   * spell to hand the body back to) and the wait-ending effect's own
   * `setLegendUp(false)` reaches the same end state one commit later —
   * deleting the arrival's line leaves that test green.
   *
   * This is the reachable state where the two come apart: the agent answered
   * and CARRIED ON WORKING. `noteNewestAnswer` calls `endStarting`, which
   * clears the press's flag and then returns early because the session is
   * still busy with a claim already granted (`agentArmed`), so `derive` keeps
   * handing back `AGENT_HAS_THE_BODY`. `waiting` never goes false, the
   * wait-ending effect never re-runs, and the arrival's own line is the only
   * thing that takes the overlay off the answer the user asked for.
   */
  it("an answer on an agent still at work dismisses it with no wait ending", async () => {
    globals.__PAVILIO_TUNING__ = { answerWaveDebounceMs: 20 };
    const speech = makeSpeech(SESSION);
    const view = render(cell(speech));
    fireEvent.click(launcher());
    await settleSubmit();
    expect(legend()).not.toBeNull();

    // The launched agent's own output puts the session busy, and the window
    // elapses: from here the agent holds the body on its own account, beside
    // the press's flag rather than instead of it.
    activity("busy");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: false });

    // It speaks — and keeps working.
    speech.arrive();
    view.rerender(cell(speech));

    await waitFor(() => expect(legend()).toBeNull());
    // The wait is STILL LIVE, which is the whole point of this case: there was
    // no wait-ending commit for the other dismissal to ride.
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: false });
    expect(pane()).not.toBeNull();
  });

  it("Escape dismisses it", async () => {
    render(cell(makeSpeech(SESSION)));
    fireEvent.click(launcher());
    await settleSubmit();
    expect(legend()).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(legend()).toBeNull());
  });

  it("activating the eye dismisses it", async () => {
    render(cell(makeSpeech(SESSION)));
    fireEvent.click(launcher());
    await settleSubmit();
    expect(legend()).not.toBeNull();

    // Using the control the legend names is the legend having worked.
    fireEvent.click(eye());
    await waitFor(() => expect(legend()).toBeNull());
  });

  it("the transport it names cannot be pressed under it, and is named anyway", async () => {
    render(cell(makeSpeech(SESSION)));
    fireEvent.click(launcher());
    await settleSubmit();
    expect(legend()).not.toBeNull();

    // The other half of "either control the legend names is activated", and
    // the honest shape of it: the whole strip is `disabled` until the cell's
    // first answer, so while the legend is up there is no transport press for
    // it to catch. The callout still points there, because what it teaches is
    // what the strip is FOR — and the dismissal arm is kept for a strip that
    // enables under a legend still standing.
    for (const control of ["previous", "playpause", "next"]) {
      expect(screen.getByTestId(`speech-bar-${control}-${SESSION}`)).toBeDisabled();
    }
    expect(legend()).not.toBeNull();
  });

  it("the wait ending takes the legend with it", async () => {
    render(cell(makeSpeech(SESSION)));
    fireEvent.click(launcher());
    await settleSubmit();
    expect(legend()).not.toBeNull();

    // The agent booted, worked and finished without ever speaking. The pane
    // closes again (Task 9's rule) and there is nothing left for the legend to
    // sit over.
    activity("busy");
    activity("idle");
    await waitFor(() => expect(pane()).toBeNull());
    expect(legend()).toBeNull();
  });

  it("a reduced-motion preference stops the legend animating", async () => {
    // The CALLOUT is the only animated part of the legend, and it is the part
    // the old spelling of this test could not see: a regex found
    // `.boot-legend { animation: none }` inside the query, ticked, and missed
    // that `.boot-legend-callout { animation: boot-legend-in 180ms }` — equal
    // specificity, 350 lines later — took the tie on source order. Measured in
    // headless Chrome under `--force-prefers-reduced-motion`, the callouts
    // animated. So the assertion is on the CASCADE, over the rendered box.
    const drop = injectStylesheet(stylesheetWithReducedMotionOn());
    try {
      await boot(720);

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

  it("the legend animates when nothing asks it not to", async () => {
    // The other half, so "nothing animates" cannot pass by the arrival having
    // been deleted: with the query's condition left as shipped — one jsdom
    // never matches — the callout carries its arrival.
    const drop = injectStylesheet();
    try {
      await boot(720);
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
    async (cellWidth) => {
      const drop = injectStylesheet();
      try {
        await boot(cellWidth);

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

  it.each([440, 720, 1200])("a %ipx cell carries both, clear of each other", async (cellWidth) => {
    const drop = injectStylesheet();
    try {
      await boot(cellWidth);

      expect(calloutTargets()).toEqual(
        [`speech-bar-playpause-${SESSION}`, `speech-bar-eye-${SESSION}`].sort(),
      );

      // ...and they cannot be touching. Read off the rendered boxes rather
      // than out of the file, so the numbers are the ones the cascade actually
      // gives these two elements at this width.
      const transport = getComputedStyle(calloutFor("transport")!);
      const eye = getComputedStyle(calloutFor("eye")!);
      const widest = px(transport.maxWidth);
      const transportRight = px(transport.left) + widest;
      const eyeLeft = cellWidth - px(eye.right) - widest;
      expect(
        transportRight,
        `the two callouts overlap by ${transportRight - eyeLeft}px in a ${cellWidth}px cell`,
      ).toBeLessThanOrEqual(eyeLeft);
    } finally {
      drop();
    }
  });

  it("the cell the legend measures is its own, not the window", async () => {
    // The distinction the viewport query could not make: a WIDE window with a
    // NARROW cell in it, which is what every 2x2 and 3x2 grid is. The window
    // here is jsdom's default 1024 and never changes.
    expect(window.innerWidth).toBeGreaterThan(520);
    const drop = injectStylesheet();
    try {
      await boot(320);
      expect(calloutTargets()).toEqual([`speech-bar-eye-${SESSION}`]);
    } finally {
      drop();
    }
  });

  // -------------------------------------------------------------------------
  // A leader is a LINE BETWEEN TWO THINGS, and both ends have to land.
  // -------------------------------------------------------------------------

  it("each leader runs from its callout's edge to the control's centre", async () => {
    const drop = injectStylesheet();
    try {
      await boot(720);

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

  it("the row's own numbers are what the leader arithmetic assumes", async () => {
    // The drift guard for the comment the geometry reasons from. Preflight
    // makes every box `border-box`, so `.speech-bar-row`'s 56px is the WHOLE
    // row, padding included — a control centred in it is 28px down, and the
    // bar's hairline is below the row rather than inside it.
    const drop = injectStylesheet();
    try {
      await boot(720);
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

  // -------------------------------------------------------------------------
  // The two orderings the arming effect must survive.
  // -------------------------------------------------------------------------

  it("a launcher edge seen a commit before the wait is not lost", async () => {
    render(cell(makeSpeech(SESSION)));

    // The delivery flag on its own. `LauncherPills` calls `noteAgentStarting`
    // before `onDelivered` today, so this order does not occur in the product
    // — which is the problem: swapping those two lines is a one-line edit that
    // used to kill the legend with nothing failing, because the effect wrote
    // its `lastLauncherUsed` ref BEFORE the `!waiting` guard and consumed the
    // edge it then refused to act on.
    act(() => {
      noteLauncherUsed(SESSION);
    });
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: false, pending: false });
    expect(legend()).toBeNull();

    // ...and the wait behind it.
    act(() => {
      noteAgentStarting(SESSION);
    });
    await waitFor(() => expect(legend()).not.toBeNull());
    expect(hasSeenBootLegend()).toBe(true);
  });

  it("hiding the bar mid-boot puts the legend away for good", async () => {
    const speech = makeSpeech(SESSION);
    const view = render(cell(speech));
    fireEvent.click(launcher());
    await settleSubmit();
    expect(legend()).not.toBeNull();

    // The bar goes. The two controls the legend names go with it, so there is
    // nothing left for the callouts to point at.
    view.rerender(cell(speech, SESSION, false));
    expect(legend()).toBeNull();

    // ...and bringing the bar back does not bring the legend back. Shown once
    // is shown: the browser was marked taught the moment it first appeared.
    view.rerender(cell(speech, SESSION, true));
    expect(legend()).toBeNull();
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: false });
  });
});
