/**
 * The speech bar as a ROW IN FLOW, reserved from mount.
 *
 * The bar used to be `position: absolute` over the xterm container, and the
 * reason was `TerminalView`'s uncoalesced `new ResizeObserver(() => inst.fit())`
 * plus an `inst.fit()` that refreshes the terminal AND sends a PTY resize
 * unconditionally: a control that appeared mid-stream would SIGWINCH a TUI
 * while it was still writing.
 *
 * Reserving the row from mount cuts that chain at its first link instead. The
 * row is in the cell's column from the moment the cell mounts, whether or not
 * it has ever spoken, so the observed container's box is settled before any
 * utterance can arrive and a first utterance changes nothing. The only path
 * left to a resize is the user's own hide toggle — a deliberate act, where a
 * fit and a SIGWINCH are the correct response.
 *
 * So the load-bearing assertions here are about `fit`: none on the first
 * utterance, exactly one on the hide. They run against a `fit` stand-in that
 * does what the real one does — a refresh and a resize frame — the way
 * `SpeechControlBar.test.tsx` and `TerminalView.answerPane.test.tsx` do.
 *
 * jsdom performs no layout, so "the container's rendered height is unchanged"
 * cannot be read off `getBoundingClientRect`. It is asserted as what actually
 * produces that height: the same container node, in the same column, with the
 * same siblings in the same order, and nothing refitting it.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prepare } from "../../speech/prepare";
import type { CellSpeechState, GridSpeech, SpeechUnit, Utterance } from "../../speech/types";
import {
  emptyUtteranceQueue,
  utteranceQueueReducer,
  type UtteranceQueue,
} from "../../speech/utteranceQueue";
import { forgetAnswerPane } from "../answerPaneState";
import { setStoredAutoOpenAnswer } from "../../speech/autoOpenAnswer";
import type { SessionMeta } from "../useTerminalSessions";

/**
 * The terminal instance stand-in. `fit()` refreshes AND sends a resize frame,
 * exactly like the real one, so a "no refit" assertion is made on the path
 * that actually hurts rather than on a spy that hurts nobody.
 */
const term = vi.hoisted(() => {
  const fit = vi.fn();
  const sent: string[] = [];
  const observed: Element[] = [];
  /** Every byte written to the PTY through `inst.send` — the launcher path. */
  const writes: string[] = [];
  return { fit, sent, observed, writes };
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
        terminal: { cols: 80, rows: 24, refresh: () => {}, focus: () => {} },
        fitAddon: {},
        holder,
        ws,
        // Recorded, not swallowed: this IS the transport the launcher pills
        // are supposed to reach, so a stub that dropped the bytes would let a
        // disconnected pill pass.
        send: (data: string) => term.writes.push(data),
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
    destroyTerminal: () => {},
    hasExited: () => false,
    reconnectSession: () => {},
    // `bufferSnapshot` reads the palette off this at module load.
    THEME: new Proxy({}, { get: () => "#000000" }),
    // The real one fits; keeping that faithful is the point of the mock.
    followBottomAcrossResize: (_terminal: unknown, fit: () => void) => fit(),
  };
});

vi.mock("../useMobileReconnect", () => ({ useMobileReconnect: () => {} }));
vi.mock("../useTerminalConnection", () => ({ useTerminalConnection: () => "connected" }));
vi.mock("../TerminalActivityLed", () => ({
  TerminalActivityLed: () => <span data-testid="activity-led" />,
}));
vi.mock("../../markdown/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));
vi.mock("../../speech/synth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../speech/synth")>()),
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

// Imported after the mocks so they pick them up.
const { TerminalView } = await import("../TerminalView");
const { TerminalLayoutGrid } = await import("../TerminalLayoutGrid");

const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();

const MARKDOWN = "The cell finally says something.";
const utterance: Utterance = { id: "u-1", sessionId: "cell-a", text: MARKDOWN, at: 1 };

/** A speech host reporting one fixed reading of the cell. */
function makeSpeech(
  state: CellSpeechState,
  queue: UtteranceQueue = emptyUtteranceQueue,
  units: readonly SpeechUnit[] = NO_UNITS,
): GridSpeech {
  return {
    stateFor: () => state,
    queueFor: () => queue,
    unitsFor: () => units,
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

/** The same host once the cell's first answer has landed. */
function spokenSpeech(): GridSpeech {
  const queue = utteranceQueueReducer(emptyUtteranceQueue, {
    type: "arrived",
    utterance,
    speaking: false,
  });
  return makeSpeech("ready", queue, prepare(MARKDOWN).units);
}

const sessions: SessionMeta[] = [
  { id: "cell-a", name: "a", project: "p", cwd: "/p", pid: 1, createdAt: "2026-09-23T00:00:00Z" },
];

const grid = (speech: GridSpeech) => (
  <MemoryRouter>
    <TerminalLayoutGrid
      sessions={sessions}
      focusedId="cell-a"
      maximized={false}
      onFocus={() => {}}
      onExit={() => {}}
      speech={speech}
    />
  </MemoryRouter>
);

/** Lets the mount effect's rAF and its 300ms settle timer run. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}

const bar = (): HTMLElement => screen.getByTestId("speech-bar-cell-a");
const resizeFrames = (): string[] => term.sent.filter((frame) => frame.includes('"resize"'));

/**
 * What the cell's column holds, in order — the shape a height comes from.
 *
 * Two levels up from the observed container, not one: the container now sits
 * inside the TERMINAL AREA, the positioned box that is the answer pane's
 * offsetParent, and the cell's column is that box's parent. Reading the
 * container's own parent would describe the terminal area instead — a box with
 * one child, which agrees with itself no matter what happens to the row.
 */
function columnShape(container: Element): string[] {
  const column = container.parentElement?.parentElement;
  return [...(column?.children ?? [])].map(
    (child) => child.getAttribute("data-testid") ?? child.tagName.toLowerCase(),
  );
}

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

class StubResizeObserver {
  observe(element: Element): void {
    term.observed.push(element);
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  forgetAnswerPane("cell-a");
  term.fit.mockClear();
  term.sent.length = 0;
  term.observed.length = 0;
  term.writes.length = 0;
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
});

describe("the speech row", () => {
  // -------------------------------------------------------------------------
  // The pill's wire, end to end.
  //
  // `SpeechControlBar` makes `send` required so that a host cannot render
  // "pills that look live and do nothing when clicked" — and the type system
  // cannot see the only thing that would actually cause that: a `TerminalView`
  // whose `send` callback reaches the wrong transport, or none. That callback
  // had no test at all; its body could be replaced with a no-op and the whole
  // suite stayed green, because the one production call site is mocked
  // wholesale everywhere else. So this clicks a real pill on the real view and
  // asserts on the bytes the terminal instance received.
  // -------------------------------------------------------------------------
  it("hands the row the cell's own PTY write", async () => {
    render(<TerminalView sessionId="cell-a" speech={makeSpeech("empty")} />);
    await settle();

    // A silent cell shows the launchers; the first is the `claude` default.
    const pill = screen.getByTestId("speech-bar-launch-cell-a-0");
    expect(pill).toHaveTextContent("claude");
    expect(term.writes).toEqual([]);

    fireEvent.click(pill);

    // The command, and then the return that runs it as a separate write, on
    // the instance this cell acquired — not on a spy the view happens to hold.
    // The split is `ptySubmit`'s and every caller has it.
    expect(term.writes).toEqual(["claude"]);
    await waitFor(() => expect(term.writes).toEqual(["claude", "\r"]));
  });

  it("renders the speech row on a cell that has never spoken", async () => {
    // Nothing in the queue, nothing to play, no interaction — and the row is
    // there anyway. That is what "reserved from mount" means: the height is
    // spent before the cell has anything to say, so an arrival cannot claim it.
    render(<TerminalView sessionId="cell-a" speech={makeSpeech("empty")} />);
    await settle();

    expect(bar()).toBeInTheDocument();
  });

  it("places the row before the terminal container, not over it", async () => {
    render(<TerminalView sessionId="cell-a" speech={makeSpeech("empty")} />);
    await settle();

    const container = term.observed[0];
    expect(container).toBeDefined();
    // A sibling, still — never a child of the observed box.
    expect(container.contains(bar())).toBe(false);
    // …but now a PREVIOUS sibling in the same column, rather than a layer over
    // it: the container starts where the row ends.
    //
    // The column's second item is the TERMINAL AREA rather than the container
    // itself: the answer pane needs a positioned box meaning "the terminal and
    // nothing above it" to overlay, so the container gained a wrapper (see
    // `TerminalView`). The row is still the box before it, and the area still
    // holds the observed container and nothing else of the cell — which is the
    // claim this test was always making.
    const area = container.parentElement;
    expect(area?.contains(bar())).toBe(false);
    expect(bar().parentElement).toBe(area?.parentElement);
    expect(bar().nextElementSibling).toBe(area);
    // And the parent lays them out as a column, so "before" is a box above
    // rather than a stacking order.
    expect(bar().parentElement?.className).toContain("flex-col");
  });

  it("does not refit the terminal when the first utterance arrives", async () => {
    // The subject here is the ROW, so the pane is held shut explicitly rather
    // than left to the default — which is now ON, and would put the pane in
    // the flow on the very arrival this test measures. A pane the user asked
    // to open is a deliberate act, like the hide toggle below; what must cost
    // nothing is the arrival ITSELF.
    setStoredAutoOpenAnswer(false);
    const view = render(<TerminalView sessionId="cell-a" speech={makeSpeech("empty")} />);
    await settle();

    const container = term.observed[0];
    const shapeBefore = columnShape(container);
    const fitsBefore = term.fit.mock.calls.length;
    const resizesBefore = resizeFrames().length;

    // The cell's first answer lands.
    view.rerender(<TerminalView sessionId="cell-a" speech={spokenSpeech()} />);
    await settle();

    // The transport is live — the arrival was seen.
    expect(screen.getByTestId("speech-bar-playpause-cell-a")).toHaveAttribute(
      "data-speech",
      "ready",
    );
    // jsdom lays nothing out, so the height is asserted as what determines it:
    // the same container node, in the same column, with the same siblings in
    // the same order. Nothing entered or left the flow.
    expect(term.observed[0]).toBe(container);
    expect(columnShape(container)).toEqual(shapeBefore);
    // And nothing refit it, so no SIGWINCH reached the PTY mid-answer.
    expect(term.fit.mock.calls.length).toBe(fitsBefore);
    expect(resizeFrames().length).toBe(resizesBefore);
  });

  it("fits nothing of its own on mount", async () => {
    // A mount already fits three times, and every one of them predates this
    // change: the mount effect's rAF, the focus effect's rAF (`focused`
    // defaults to true), and the mount effect's 300ms settle timer. The ROW
    // must add none of its own — its height is reserved before the first of
    // those runs, so a mount has nothing to respond to, and a toggle effect
    // that fired on mount anyway would refit and SIGWINCH every cell in the
    // grid the moment the panel opened, which is the whole class of resize
    // this change exists to remove.
    //
    // Seeding `lastBarVisible` with the CURRENT value of `speechBarVisible` is
    // what prevents it — seed it with anything else and the counts below go to
    // four. So the number is the point, not an incidental total.
    const shown = render(<TerminalView sessionId="cell-a" speech={makeSpeech("empty")} />);
    await settle();

    expect(bar()).toBeInTheDocument();
    expect(term.fit).toHaveBeenCalledTimes(3);
    expect(resizeFrames()).toHaveLength(3);
    shown.unmount();

    // The same on a cell that comes up with the row already hidden: what is
    // pinned is the ABSENCE of a toggle, not one particular starting value, and
    // a mount is never a toggle in either direction.
    term.fit.mockClear();
    term.sent.length = 0;
    render(
      <TerminalView sessionId="cell-b" speech={makeSpeech("empty")} speechBarVisible={false} />,
    );
    await settle();

    expect(screen.queryByTestId("speech-bar-cell-b")).not.toBeInTheDocument();
    expect(term.fit).toHaveBeenCalledTimes(3);
    expect(resizeFrames()).toHaveLength(3);
  });

  it("refits once when the row is hidden", async () => {
    const speech = makeSpeech("empty");
    const view = render(<TerminalView sessionId="cell-a" speech={speech} />);
    await settle();

    term.fit.mockClear();
    term.sent.length = 0;

    // The user's own hide toggle: the row leaves the column and the terminal
    // genuinely grows, so a fit and a resize frame are the correct response —
    // exactly once, not per render.
    view.rerender(<TerminalView sessionId="cell-a" speech={speech} speechBarVisible={false} />);
    await settle();

    expect(screen.queryByTestId("speech-bar-cell-a")).not.toBeInTheDocument();
    expect(term.fit).toHaveBeenCalledTimes(1);
    expect(resizeFrames()).toHaveLength(1);
  });

  it("keeps the row shown by default regardless of speech state", async () => {
    // The derivation lives in the cell, so this mounts the cell rather than the
    // view: `speechBarVisible` used to read the session's speech state, which
    // made the row's EXISTENCE conditional on having spoken. It no longer does.
    const silent = render(grid(makeSpeech("empty")));
    await settle();
    expect(bar()).toBeInTheDocument();
    silent.unmount();

    forgetAnswerPane("cell-a");
    render(grid(spokenSpeech()));
    await settle();
    expect(bar()).toBeInTheDocument();
  });
});
