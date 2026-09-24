/**
 * The answer pane across a layout change, at the level that actually remounts.
 *
 * `TerminalLayoutGrid` renders two different body subtrees — one CSS grid of
 * cells, or (mobile / maximized) a stack of absolutely positioned wrappers —
 * and switches between them on MAX. React reconciles that as an unmount of
 * every `TerminalCell`, and with it `TerminalView`. The xterm survives only
 * because `terminalInstances` keeps it outside React; the pane's state has to
 * survive the same way. Smoke test, 2026-09-16: MAX closed the pane.
 *
 * Unlike `TerminalLayoutGrid.test.tsx` this suite mounts the REAL
 * `TerminalView` (over the same terminal stand-in `TerminalView.answerPane.test.tsx`
 * uses), because the pane lives inside it.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prepare } from "../../speech/prepare";
import type { GridSpeech, Utterance } from "../../speech/types";
import { emptyUtteranceQueue, utteranceQueueReducer } from "../../speech/utteranceQueue";
import type { SessionMeta } from "../useTerminalSessions";
import { forgetAnswerPane } from "../answerPaneState";
import { setStoredAutoOpenAnswer } from "../../speech/autoOpenAnswer";

vi.mock("../terminalInstances", () => {
  const holders = new Map<string, HTMLDivElement>();
  return {
    acquireTerminal: (sessionId: string) => {
      let holder = holders.get(sessionId);
      if (!holder) {
        holder = document.createElement("div");
        holders.set(sessionId, holder);
      }
      return {
        sessionId,
        terminal: { cols: 80, rows: 24, refresh: () => {}, focus: () => {} },
        fitAddon: {},
        holder,
        ws: { readyState: 1, send: () => {} },
        send: () => {},
        fit: () => {},
        focus: () => {},
        addExitListener: () => () => {},
        reopen: () => {},
        onWsChange: () => () => {},
      };
    },
    releaseTerminal: () => {},
    // The attention LED's dismiss. Present even where no test here lights
    // one: the arrival rule short-circuits on a session that is not on
    // `attention`, so a factory without this export passes for exactly as long
    // as nobody writes a test that does — and then fails as an UNHANDLED error
    // beside a green result, which is the worst shape a failure can take. See
    // `attentionDismiss.test.tsx`, which is where the rule is actually
    // asserted, and `autoplay.integration.test.tsx`, which has always carried
    // it.
    sendDismiss: () => {},
    destroyTerminal: () => {},
    hasExited: () => false,
    reconnectSession: () => {},
    THEME: new Proxy({}, { get: () => "#000000" }),
    followBottomAcrossResize: (_terminal: unknown, fit: () => void) => fit(),
  };
});

vi.mock("../useTerminalConnection", () => ({
  useTerminalConnection: () => "connected",
}));
vi.mock("../TerminalActivityLed", () => ({
  TerminalActivityLed: () => <span data-testid="activity-led" />,
}));
vi.mock("../useMobileReconnect", () => ({ useMobileReconnect: () => {} }));
vi.mock("../../markdown/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));
vi.mock("../../speech/synth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../speech/synth")>()),
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

// Imported after the mocks so it picks them up.
const { TerminalLayoutGrid } = await import("../TerminalLayoutGrid");

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
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

const MARKDOWN = "# Deploy plan\n\nThe first paragraph explains why the deploy waits.\n";
const utterance: Utterance = { id: "u-1", sessionId: "cell-a", text: MARKDOWN, at: 1 };
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();

/** A cell that has played nothing has heard nothing — shared, like every other
 *  "nothing here" snapshot on a host. */
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();

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
    heardFor: () => NOTHING_HEARD,
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

const sessions: SessionMeta[] = [
  { id: "cell-a", name: "a", project: "p", cwd: "/p", pid: 1, createdAt: "2026-09-16T00:00:00Z" },
  { id: "cell-b", name: "b", project: "p", cwd: "/p", pid: 2, createdAt: "2026-09-16T00:00:01Z" },
];

const grid = (speech: GridSpeech, maximized: boolean) => (
  <MemoryRouter>
    <TerminalLayoutGrid
      sessions={sessions}
      focusedId="cell-a"
      maximized={maximized}
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

const eye = (): HTMLElement => screen.getByTestId("speech-bar-eye-cell-a");
const pane = (): HTMLElement | null => screen.queryByTestId("answer-pane-cell-a");
const footerBox = (): HTMLInputElement =>
  screen.getByTestId("answer-pane-auto-open-cell-a") as HTMLInputElement;

beforeEach(() => {
  forgetAnswerPane("cell-a");
  forgetAnswerPane("cell-b");
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
});

describe("TerminalLayoutGrid — the answer pane across a layout change", () => {
  it("MAX and back leaves the pane open with its footer switch unchanged", async () => {
    // Seed the switch OFF, against the ON default: what has to survive MAX is
    // a switch the user MOVED, and a switch left where the default put it
    // would survive a remount that rebuilt it from scratch.
    setStoredAutoOpenAnswer(false);
    const speech = makeSpeech();
    const view = render(grid(speech, false));
    await settle();
    expect(screen.getByTestId("terminal-grid")).toBeInTheDocument();

    fireEvent.click(eye());
    expect(pane()).not.toBeNull();
    expect(footerBox()).not.toBeChecked();
    fireEvent.click(footerBox());
    expect(footerBox()).toBeChecked();

    // Maximize: the grid body is replaced by the fullscreen stack.
    view.rerender(grid(speech, true));
    await settle();
    expect(screen.queryByTestId("terminal-grid")).toBeNull();
    expect(pane()).not.toBeNull();
    expect(eye()).toHaveAttribute("aria-pressed", "true");
    expect(footerBox()).toBeChecked();

    // And back.
    view.rerender(grid(speech, false));
    await settle();
    expect(screen.getByTestId("terminal-grid")).toBeInTheDocument();
    expect(pane()).not.toBeNull();
    expect(eye()).toHaveAttribute("aria-pressed", "true");
    expect(footerBox()).toBeChecked();
  });

  it("a pane closed before MAX stays closed after it", async () => {
    const speech = makeSpeech();
    const view = render(grid(speech, false));
    await settle();
    fireEvent.click(eye());
    fireEvent.click(eye());
    expect(pane()).toBeNull();

    view.rerender(grid(speech, true));
    await settle();
    expect(pane()).toBeNull();
    expect(eye()).toHaveAttribute("aria-pressed", "false");
  });
});
