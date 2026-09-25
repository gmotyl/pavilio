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
const { __resetAnswerWaitingForTests, getAnswerWaiting } = await import("../answerWaiting");
const { __resetPtySubmitForTests } = await import("../ptySubmit");
const { _applyEventForTests, _resetForTests } = await import("../useTerminalActivityChannel");
const { hasSeenBootLegend } = await import("../bootLegendSeen");

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

  it("a reduced-motion preference stops the legend animating", () => {
    // Read out of the stylesheet, because jsdom loads none: the assertion is
    // that the rule EXISTS and lives in the stylesheet's single
    // `prefers-reduced-motion` query, not a second one that would have to be
    // kept in step with the first by hand.
    const queries = [...CSS.matchAll(/@media \(prefers-reduced-motion: reduce\) \{/g)];
    expect(queries).toHaveLength(1);

    const block = CSS.slice(queries[0].index!);
    const end = block.indexOf("\n}");
    expect(end).toBeGreaterThan(0);
    const inside = block.slice(0, end);

    expect(inside).toContain(".boot-legend");
    expect(inside).toMatch(/animation:\s*none/);
  });
});
