/**
 * The answer pane's mount in the cell. `TerminalView` owns `answerOpen` and
 * mounts `AnswerPane` beside the bar — as a SIBLING of the observed xterm
 * container, never inside it — so that opening and closing the pane changes
 * no box the `ResizeObserver` measures. The stakes are the bar's: `inst.fit()`
 * refreshes the terminal AND sends a PTY resize unconditionally, so "no refit"
 * is asserted against a `fit` stand-in that does exactly that, the way
 * `SpeechControlBar.test.tsx` does.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepare } from "../../speech/prepare";
import type { GridSpeech, Utterance } from "../../speech/types";
import { emptyUtteranceQueue, utteranceQueueReducer } from "../../speech/utteranceQueue";

/**
 * The terminal instance stand-in: `fit()` refreshes AND sends a resize frame,
 * like the real one, so the "no refit" assertion is on the path that hurts.
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
    THEME: new Proxy({}, { get: () => "#000000" }),
    followBottomAcrossResize: (_terminal: unknown, fit: () => void) => fit(),
  };
});

vi.mock("../useMobileReconnect", () => ({ useMobileReconnect: () => {} }));

// mermaid pulls in a browser-only rendering stack the pane never needs here.
vi.mock("../../markdown/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

// The synthesis cache the bar and the rail peek into: everything is cold.
vi.mock("../../speech/synth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../speech/synth")>()),
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

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

const MARKDOWN = [
  "# Deploy plan",
  "",
  "The first paragraph explains why the deploy has to wait for the database migration to finish before any traffic is switched over.",
  "",
].join("\n");

const utterance: Utterance = { id: "u-1", sessionId: "cell-a", text: MARKDOWN, at: 1 };

const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();

/** A host with one utterance under the cursor and nothing playing. */
function makeSpeech(): GridSpeech {
  const queue = utteranceQueueReducer(emptyUtteranceQueue, {
    type: "arrived",
    utterance,
    speaking: false,
  });
  const units = prepare(MARKDOWN).units;
  return {
    stateFor: () => "ready",
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
    onArm: vi.fn(),
    onJumpToUnit: vi.fn(),
    onSeekWithinUnit: vi.fn(),
  } satisfies GridSpeech;
}

/** MarkdownRenderer calls useNavigate, so the cell needs a router. */
const cell = (speech: GridSpeech | undefined, speechBarVisible = true) => (
  <MemoryRouter>
    <TerminalView sessionId="cell-a" speech={speech} speechBarVisible={speechBarVisible} />
  </MemoryRouter>
);

/** Lets the mount effect's rAF and its 300ms settle timer run. */
async function settleTerminal(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}

const eye = (): HTMLElement => screen.getByTestId("speech-bar-eye-cell-a");
const pane = (): HTMLElement | null => screen.queryByTestId("answer-pane-cell-a");

beforeEach(() => {
  term.fit.mockClear();
  term.sent.length = 0;
  term.observed.length = 0;
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
});

describe("TerminalView and the answer pane", () => {
  it("the pane mounts beside the terminal and provokes no refit", async () => {
    const speech = makeSpeech();
    render(cell(speech));
    await settleTerminal();
    expect(pane()).toBeNull();

    // The xterm container is the first thing observed, before any pane exists.
    const observedContainer = term.observed[0];
    expect(observedContainer).toBeDefined();
    const fitsBefore = term.fit.mock.calls.length;
    const resizesBefore = resizeFrames().length;

    // Open.
    fireEvent.click(eye());
    await settleTerminal();
    const opened = pane();
    expect(opened).not.toBeNull();
    expect(eye()).toHaveAttribute("aria-pressed", "true");
    // A sibling of the container and of the bar — the same parent as both.
    expect(opened!.parentElement).toBe(observedContainer.parentElement);
    expect(opened!.parentElement).toBe(screen.getByTestId("speech-bar-cell-a").parentElement);
    expect(observedContainer.contains(opened!)).toBe(false);
    expect(term.fit.mock.calls.length).toBe(fitsBefore);
    expect(resizeFrames().length).toBe(resizesBefore);

    // Close.
    fireEvent.click(eye());
    await settleTerminal();
    expect(pane()).toBeNull();
    expect(eye()).toHaveAttribute("aria-pressed", "false");
    expect(term.fit.mock.calls.length).toBe(fitsBefore);
    expect(resizeFrames().length).toBe(resizesBefore);
  });

  it("hiding the bar closes the pane", async () => {
    const speech = makeSpeech();
    const view = render(cell(speech));
    await settleTerminal();
    fireEvent.click(eye());
    expect(pane()).not.toBeNull();

    view.rerender(cell(speech, false));
    expect(pane()).toBeNull();
    expect(screen.queryByTestId("speech-bar-cell-a")).toBeNull();
  });

  it("no speech host, no pane", async () => {
    render(cell(undefined));
    await settleTerminal();

    expect(screen.queryByTestId("speech-bar-cell-a")).toBeNull();
    expect(screen.queryByTestId("speech-bar-eye-cell-a")).toBeNull();
    expect(pane()).toBeNull();
  });
});
