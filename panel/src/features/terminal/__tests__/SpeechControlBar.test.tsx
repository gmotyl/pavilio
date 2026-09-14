/**
 * The cell's speech control bar — layout A of
 * `projects/pavilio/mockups/2026-09-14-speech-control-bar-options.html`: one
 * 56px rail carrying autoplay, previous, play/pause, next, the segmented
 * scrubber and the position.
 *
 * Two of these tests are the reason the bar is an overlay rather than a row in
 * the cell's flexbox. `TerminalView` runs `new ResizeObserver(() => inst.fit())`
 * with no coalescing, and `inst.fit()` unconditionally refreshes the terminal
 * AND sends a PTY resize even when nothing changed — the parked
 * `terminal-resize-discipline` change exists because codex already misbehaves
 * across layout changes. So "showing the bar does not resize the terminal" is
 * asserted against the real `fit` and the real resize frame, never by reading
 * the JSX.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CellSpeechState, GridSpeech, SpeechUnit } from "../../speech/types";
import { emptyUtteranceQueue, type UtteranceQueue } from "../../speech/utteranceQueue";
import type { Utterance } from "../../speech/types";
import { SpeechControlBar } from "../SpeechControlBar";

/**
 * A terminal instance stand-in whose `fit()` does exactly what the real one
 * does — refresh plus a PTY resize frame — so a test that asserts "no refit"
 * is asserting on the path that actually hurts.
 */
const term = vi.hoisted(() => {
  const fit = vi.fn();
  const sent: string[] = [];
  const observed: Element[] = [];
  return { fit, sent, observed };
});

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
      const ws = {
        readyState: 1,
        send: (frame: string) => term.sent.push(frame),
      };
      return {
        sessionId,
        terminal: { cols: 80, rows: 24, refresh: () => {} },
        fitAddon: {},
        holder,
        ws,
        send: () => {},
        // Mirrors the real `fit`: a refresh AND a resize frame, unconditionally.
        fit: () => {
          term.fit();
          ws.send(JSON.stringify({ type: "resize", cols: 80, rows: 24 }));
        },
        focus: () => {},
        addExitListener: () => () => {},
        reopen: () => {},
        onWsChange: () => () => {},
      };
    },
    releaseTerminal: () => {},
    // `bufferSnapshot` reads the palette off this at module load.
    THEME: new Proxy({}, { get: () => "#000000" }),
    // The real one fits; keeping that faithful is the point of the mock.
    followBottomAcrossResize: (_terminal: unknown, fit: () => void) => fit(),
  };
});

vi.mock("../useMobileReconnect", () => ({ useMobileReconnect: () => {} }));

// Imported after the mocks so it picks them up.
const { TerminalView } = await import("../TerminalView");

const resizeFrames = (): string[] => term.sent.filter((frame) => frame.includes('"resize"'));

class StubResizeObserver {
  observe(element: Element): void {
    term.observed.push(element);
  }
  unobserve(): void {}
  disconnect(): void {}
}

const units = (...chars: number[]): SpeechUnit[] =>
  chars.map((count) => ({ text: "x".repeat(count), chars: count }));

const utterance = (id: string): Utterance => ({
  id,
  sessionId: "cell-a",
  text: "whatever",
  at: 1,
});

const queueWith = (over: Partial<UtteranceQueue> = {}): UtteranceQueue => ({
  ...emptyUtteranceQueue,
  ...over,
});

interface SpeechOverrides {
  state?: CellSpeechState;
  queue?: UtteranceQueue;
  units?: SpeechUnit[];
  progress?: { unitIndex: number; unitTime: number; unitDuration: number | null } | null;
  durations?: ReadonlyMap<number, number>;
  armedSessionId?: string | null;
}

/** Shared, because a `useSyncExternalStore` snapshot must be referentially
 *  stable between notifications — a fresh `new Map()` per call is an infinite
 *  render loop, which is exactly what this caught the first time. */
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();

function makeSpeech(over: SpeechOverrides = {}): GridSpeech {
  const durations = over.durations ?? NO_DURATIONS;
  const progress = over.progress ?? null;
  const units_ = over.units ?? [];

  return {
    stateFor: () => over.state ?? "empty",
    queueFor: () => over.queue ?? emptyUtteranceQueue,
    unitsFor: () => units_,
    // Nothing here moves, so the store never notifies: the snapshots below are
    // read once and stay put.
    subscribeProgress: () => () => {},
    progressFor: () => progress,
    unitDurationsFor: () => durations,
    armedSessionId: over.armedSessionId ?? null,
    onSpeak: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onArm: vi.fn(),
    onJumpToUnit: vi.fn(),
    onSeekWithinUnit: vi.fn(),
  };
}

/** The rendered width of a segment, as a number of percent. */
function widthOf(sessionId: string, index: number): number {
  const segment = screen.getByTestId(`speech-bar-segment-${sessionId}-${index}`);
  return Number.parseFloat(segment.style.width);
}

/** Gives a segment a real box, which jsdom otherwise reports as 0×0. */
function boxFor(element: HTMLElement, left: number, width: number): void {
  element.getBoundingClientRect = () =>
    ({ left, width, right: left + width, top: 0, bottom: 26, height: 26, x: left, y: 0 }) as DOMRect;
}

/** Lets the mount effect's rAF and its 300ms settle timer run. */
async function settleTerminal(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}

beforeEach(() => {
  term.fit.mockClear();
  term.sent.length = 0;
  term.observed.length = 0;
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
});

describe("SpeechControlBar", () => {
  it("renders in every cell without interaction", async () => {
    const speech = makeSpeech();

    render(
      <>
        <TerminalView sessionId="cell-a" speech={speech} />
        <TerminalView sessionId="cell-b" speech={speech} />
      </>,
    );
    await settleTerminal();

    // No click, no hover, no toggle: the bar is on by default, in both cells.
    expect(screen.getByTestId("speech-bar-cell-a")).toBeInTheDocument();
    expect(screen.getByTestId("speech-bar-cell-b")).toBeInTheDocument();
  });

  it("mounting the bar does not refit the terminal or resize the PTY", async () => {
    const speech = makeSpeech();
    const view = render(
      <TerminalView sessionId="cell-a" speech={speech} speechBarVisible={false} />,
    );
    await settleTerminal();

    const fitsBefore = term.fit.mock.calls.length;
    const resizesBefore = resizeFrames().length;

    // Mount the bar.
    view.rerender(<TerminalView sessionId="cell-a" speech={speech} speechBarVisible />);
    await settleTerminal();
    expect(screen.getByTestId("speech-bar-cell-a")).toBeInTheDocument();
    expect(term.fit.mock.calls.length).toBe(fitsBefore);
    expect(resizeFrames().length).toBe(resizesBefore);

    // …and unmount it again.
    view.rerender(<TerminalView sessionId="cell-a" speech={speech} speechBarVisible={false} />);
    await settleTerminal();
    expect(screen.queryByTestId("speech-bar-cell-a")).not.toBeInTheDocument();
    expect(term.fit.mock.calls.length).toBe(fitsBefore);
    expect(resizeFrames().length).toBe(resizesBefore);

    // The structural reason: the bar is a sibling of the observed container,
    // not a child of it, so the ResizeObserver cannot see it appear.
    view.rerender(<TerminalView sessionId="cell-a" speech={speech} speechBarVisible />);
    const observedContainer = term.observed[0];
    expect(observedContainer).toBeDefined();
    expect(observedContainer.contains(screen.getByTestId("speech-bar-cell-a"))).toBe(false);
  });

  it("renders one segment per unit before anything is synthesized", () => {
    const speech = makeSpeech({
      state: "ready",
      queue: queueWith({ current: utterance("u-1") }),
      // Nothing synthesized, nothing playing, no duration known anywhere.
      units: units(100, 300, 100),
      progress: null,
      durations: new Map<number, number>(),
    });

    render(<SpeechControlBar sessionId="cell-a" speech={speech} />);

    expect(screen.getAllByTestId(/^speech-bar-segment-cell-a-/)).toHaveLength(3);
    // Widths seeded from `SpeechUnit.chars`: 100/300/100 of 500.
    expect(widthOf("cell-a", 0)).toBeCloseTo(20, 1);
    expect(widthOf("cell-a", 1)).toBeCloseTo(60, 1);
    expect(widthOf("cell-a", 2)).toBeCloseTo(20, 1);
    // And none of them claims to be in hand.
    expect(screen.getByTestId("speech-bar-segment-cell-a-0")).toHaveAttribute(
      "data-segment",
      "cold",
    );
  });

  it("a segment's width follows its real duration once known", () => {
    const speech = makeSpeech({
      state: "speaking",
      queue: queueWith({ current: utterance("u-1") }),
      // Equal character counts, so a chars-only bar would draw 50/50.
      units: units(200, 200),
      progress: { unitIndex: 1, unitTime: 1, unitDuration: 3 },
      durations: new Map([
        [0, 1],
        [1, 3],
      ]),
    });

    render(<SpeechControlBar sessionId="cell-a" speech={speech} />);

    expect(widthOf("cell-a", 0)).toBeCloseTo(25, 1);
    expect(widthOf("cell-a", 1)).toBeCloseTo(75, 1);
  });

  it("clicking a segment jumps to that unit", () => {
    const speech = makeSpeech({
      state: "ready",
      queue: queueWith({ current: utterance("u-1") }),
      units: units(200, 200, 200),
    });

    render(<SpeechControlBar sessionId="cell-a" speech={speech} />);
    fireEvent.click(screen.getByTestId("speech-bar-segment-cell-a-2"));

    expect(speech.onJumpToUnit).toHaveBeenCalledWith("cell-a", 2);
  });

  it("dragging the playing segment seeks within the unit", () => {
    const speech = makeSpeech({
      state: "speaking",
      queue: queueWith({ current: utterance("u-1") }),
      units: units(200, 200),
      progress: { unitIndex: 1, unitTime: 0.5, unitDuration: 4 },
      durations: new Map([[1, 4]]),
    });

    render(<SpeechControlBar sessionId="cell-a" speech={speech} />);

    const playing = screen.getByTestId("speech-bar-segment-cell-a-1");
    boxFor(playing, 100, 200);

    fireEvent.mouseDown(playing, { clientX: 150 });
    fireEvent.mouseMove(document, { clientX: 200 });
    fireEvent.mouseUp(document, { clientX: 200 });

    // A quarter across a 4s unit, then half-way across it.
    expect(speech.onSeekWithinUnit).toHaveBeenNthCalledWith(1, "cell-a", 1);
    expect(speech.onSeekWithinUnit).toHaveBeenLastCalledWith("cell-a", 2);
    // A drag is a seek, never a jump: the unit is already in the element.
    expect(speech.onJumpToUnit).not.toHaveBeenCalled();
  });

  it("a cell with no utterance has inert transport controls", () => {
    const speech = makeSpeech({ state: "empty", queue: emptyUtteranceQueue, units: [] });

    render(<SpeechControlBar sessionId="cell-a" speech={speech} />);

    expect(screen.getByTestId("speech-bar-playpause-cell-a")).toBeDisabled();
    expect(screen.getByTestId("speech-bar-previous-cell-a")).toBeDisabled();
    expect(screen.getByTestId("speech-bar-next-cell-a")).toBeDisabled();
    // An empty scrubber: present, so the rail keeps its shape, with nothing in it.
    expect(screen.getByTestId("speech-bar-scrubber-cell-a")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^speech-bar-segment-cell-a-/)).toHaveLength(0);
  });
});
