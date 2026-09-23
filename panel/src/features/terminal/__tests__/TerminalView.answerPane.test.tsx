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
import {
  getStoredAutoOpenAnswer,
  setStoredAutoOpenAnswer,
} from "../../speech/autoOpenAnswer";
import { prepare } from "../../speech/prepare";
import type { GridSpeech, Utterance } from "../../speech/types";
import {
  emptyUtteranceQueue,
  utteranceQueueReducer,
  type UtteranceQueue,
} from "../../speech/utteranceQueue";
import { cssRule } from "../../shell/__tests__/hamburgerGeometry";

/**
 * The terminal instance stand-in: `fit()` refreshes AND sends a resize frame,
 * like the real one, so the "no refit" assertion is on the path that hurts.
 */
const term = vi.hoisted(() => {
  const fit = vi.fn();
  const focus = vi.fn();
  const sent: string[] = [];
  const observed: Element[] = [];
  return { fit, focus, sent, observed };
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
        // `focus` is the xterm Terminal's own — what Escape in the pane lands on.
        terminal: { cols: 80, rows: 24, refresh: () => {}, focus: term.focus },
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
const { forgetAnswerPane } = await import("../answerPaneState");

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

/**
 * A host with one utterance under the cursor and nothing playing. The queue is
 * held in a box the tests can move: `arrive`, `previous` and `next` step it the
 * way the real host's reducer does, and a `rerender` then hands the cell the
 * new queue reference — which is all the cell ever sees of an arrival.
 */
type Host = GridSpeech & {
  arrive: (id: string) => void;
  previous: () => void;
  next: () => void;
};

function makeSpeech(): Host {
  let queue: UtteranceQueue = utteranceQueueReducer(emptyUtteranceQueue, {
    type: "arrived",
    utterance,
    speaking: false,
  });
  const units = prepare(MARKDOWN).units;
  return {
    arrive: (id) => {
      queue = utteranceQueueReducer(queue, {
        type: "arrived",
        utterance: { ...utterance, id, at: queue.pending.length + 2 },
        speaking: false,
      });
    },
    previous: () => {
      queue = utteranceQueueReducer(queue, { type: "previous" });
    },
    next: () => {
      queue = utteranceQueueReducer(queue, { type: "next" });
    },
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
  };
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
const footerBox = (): HTMLInputElement =>
  screen.getByTestId("answer-pane-auto-open-cell-a") as HTMLInputElement;

/** The browser-wide default, as Settings would leave it. */
const storeDefault = (on: boolean): void => {
  setStoredAutoOpenAnswer(on);
};

beforeEach(() => {
  term.fit.mockClear();
  term.focus.mockClear();
  term.sent.length = 0;
  term.observed.length = 0;
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  // The pane's state outlives the view on purpose (see `answerPaneState.ts`),
  // so every test starts the cell from a fresh entry.
  forgetAnswerPane("cell-a");
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
    // A sibling of the observed container, and never a child of it — an
    // overlay INSIDE the observed box would hand the uncoalesced
    // `ResizeObserver` a new trigger every time the pane opened.
    //
    // It is no longer a sibling of the BAR, though: the pane's positioning
    // context is the terminal area, not the cell column, which is what keeps
    // the row out from under it. The test below is where that is pinned.
    expect(opened!.parentElement).toBe(observedContainer.parentElement);
    expect(opened!.parentElement).not.toBe(
      screen.getByTestId("speech-bar-cell-a").parentElement,
    );
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

  it("mounts the pane inside the terminal area so the row stays uncovered", async () => {
    render(cell(makeSpeech()));
    await settleTerminal();
    const observedContainer = term.observed[0];
    expect(observedContainer).toBeDefined();

    fireEvent.click(eye());
    await settleTerminal();
    const opened = pane();
    expect(opened).not.toBeNull();

    // The pane's positioning context is the TERMINAL AREA — the box that holds
    // the observed xterm container and the overlay over it, and nothing else
    // of the cell.
    const area = opened!.parentElement;
    expect(area).toBe(observedContainer.parentElement);

    // Parentage alone is not a positioning context. `position: absolute`
    // resolves against the nearest POSITIONED ancestor, so without `relative`
    // HERE the pane would resolve against the cell's column instead and its
    // `top: 0` would land on the row — the exact failure this test exists to
    // prevent. That one token is what makes the box a box.
    expect(area?.className).toContain("relative");

    // And the wrapper carries the flex sizing the container used to, so the
    // terminal's height is unchanged: exactly one claimant of the column's
    // free space. Moving `flex-1 min-h-0` back down onto the container would
    // collapse the terminal to zero — `flex-1` on a child of a non-flex block
    // does nothing.
    expect(area?.className).toContain("flex-1");
    expect(area?.className).toContain("min-h-0");
    expect(observedContainer.className).not.toContain("flex-1");
    expect(observedContainer.className).toContain("h-full");

    // The speech row is OUTSIDE that box: it is the area's previous sibling in
    // the cell's column, so no amount of pane can reach it. The cell header is
    // outside by the same construction — it is not even in this column, it is
    // the grid cell's own row above it.
    const row = screen.getByTestId("speech-bar-cell-a");
    expect(area!.contains(row)).toBe(false);
    expect(row.nextElementSibling).toBe(area);
    expect(row.parentElement).toBe(area!.parentElement);

    // Which is what makes the top edge exact instead of arithmetic: the pane
    // starts at the top of that box, and the top of that box IS where the row
    // ends. The superseded `top: 68px` was the floating bar's 6 + 56 + 6, and
    // it became a 12px gap the moment the row entered the flow.
    expect(cssRule(".answer-pane")).toMatch(/(^|;)\s*top:\s*0\s*(;|$)/);
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

  it("hiding the bar forgets the pane was open", async () => {
    const speech = makeSpeech();
    const view = render(cell(speech));
    await settleTerminal();
    fireEvent.click(eye());
    expect(pane()).not.toBeNull();

    view.rerender(cell(speech, false));
    expect(pane()).toBeNull();

    // The bar comes back closed: hiding it CLOSED the pane rather than merely
    // covering it, so nothing reappears unasked.
    view.rerender(cell(speech, true));
    expect(screen.getByTestId("speech-bar-cell-a")).toBeInTheDocument();
    expect(pane()).toBeNull();
    expect(eye()).toHaveAttribute("aria-pressed", "false");
  });

  it("no speech host, no pane", async () => {
    render(cell(undefined));
    await settleTerminal();

    expect(screen.queryByTestId("speech-bar-cell-a")).toBeNull();
    expect(screen.queryByTestId("speech-bar-eye-cell-a")).toBeNull();
    expect(pane()).toBeNull();
  });

  it("the pane survives a remount of the view", async () => {
    // Maximize, grid presets, drag and seam resize all remount `TerminalView`
    // (the grid swaps its body subtree). The xterm survives that through
    // `terminalInstances`; the pane's state must survive the same way.
    const speech = makeSpeech();
    const first = render(cell(speech));
    await settleTerminal();
    fireEvent.click(eye());
    expect(pane()).not.toBeNull();

    first.unmount();
    expect(pane()).toBeNull();

    render(cell(speech));
    await settleTerminal();
    expect(pane()).not.toBeNull();
    expect(eye()).toHaveAttribute("aria-pressed", "true");
  });

  it("the footer switch survives a remount", async () => {
    storeDefault(false);
    const speech = makeSpeech();
    const first = render(cell(speech));
    await settleTerminal();
    fireEvent.click(eye());
    expect(footerBox()).not.toBeChecked();
    fireEvent.click(footerBox());
    expect(footerBox()).toBeChecked();

    first.unmount();
    render(cell(speech));
    await settleTerminal();
    // Still the cell's own choice, not a reseed from the browser default.
    expect(footerBox()).toBeChecked();
  });

  it("a remount is not an arrival", async () => {
    // The seen set outlives the view too: the queue the remounted view is
    // handed holds nothing new, so a switch that is on opens nothing.
    storeDefault(true);
    const speech = makeSpeech();
    const first = render(cell(speech));
    await settleTerminal();
    expect(pane()).toBeNull();

    first.unmount();
    render(cell(speech));
    await settleTerminal();
    expect(pane()).toBeNull();
  });

  it("Escape puts focus back in the terminal", async () => {
    const speech = makeSpeech();
    render(cell(speech));
    await settleTerminal();
    fireEvent.click(eye());
    const opened = pane();
    expect(opened).not.toBeNull();
    expect(term.focus).not.toHaveBeenCalled();

    fireEvent.keyDown(opened!, { key: "Escape" });
    expect(pane()).toBeNull();
    // The xterm Terminal's own focus — so the next question can be typed at once.
    expect(term.focus).toHaveBeenCalledTimes(1);
  });
});

describe("TerminalView opens the pane on a new answer", () => {
  it("a cell seeds its switch from the default at mount", async () => {
    storeDefault(true);
    const speech = makeSpeech();
    render(cell(speech));
    await settleTerminal();
    fireEvent.click(eye());
    expect(footerBox()).toBeChecked();

    // The cell's switch is its own: flipping it writes nothing back to the
    // default, and the default changing later does not reach a mounted cell.
    fireEvent.click(footerBox());
    expect(footerBox()).not.toBeChecked();
    expect(getStoredAutoOpenAnswer()).toBe(true);
    fireEvent.click(footerBox());
    expect(footerBox()).toBeChecked();

    storeDefault(false);
    fireEvent.click(eye());
    fireEvent.click(eye());
    expect(footerBox()).toBeChecked();
  });

  it("a cell mounted with the default off starts off", async () => {
    storeDefault(false);
    const speech = makeSpeech();
    render(cell(speech));
    await settleTerminal();
    fireEvent.click(eye());
    expect(footerBox()).not.toBeChecked();
  });

  it("a new answer opens the pane and focuses it when the switch is on", async () => {
    storeDefault(true);
    const speech = makeSpeech();
    const view = render(cell(speech));
    await settleTerminal();
    expect(pane()).toBeNull();

    speech.arrive("u-2");
    view.rerender(cell(speech));

    const opened = pane();
    expect(opened).not.toBeNull();
    expect(eye()).toHaveAttribute("aria-pressed", "true");
    // Focus lands on the pane so Escape works at once.
    expect(document.activeElement).toBe(opened);
  });

  it("the utterance a fresh tab is handed does not open the pane", async () => {
    storeDefault(true);
    const speech = makeSpeech();
    const view = render(cell(speech));
    await settleTerminal();

    // The stored utterance the server hands a fresh tab is old news, and so is
    // any re-render that hands the same queue over again.
    expect(pane()).toBeNull();
    view.rerender(cell(speech));
    expect(pane()).toBeNull();
  });

  it("previous and next open nothing", async () => {
    storeDefault(true);
    const speech = makeSpeech();
    speech.arrive("u-2");
    const view = render(cell(speech));
    await settleTerminal();
    expect(pane()).toBeNull();

    speech.previous();
    view.rerender(cell(speech));
    expect(pane()).toBeNull();

    speech.next();
    view.rerender(cell(speech));
    expect(pane()).toBeNull();
  });

  it("off, or a hidden bar, opens nothing", async () => {
    // Off: an arrival is not an opening.
    storeDefault(false);
    const off = makeSpeech();
    const offView = render(cell(off));
    await settleTerminal();
    off.arrive("u-2");
    offView.rerender(cell(off));
    expect(pane()).toBeNull();
    offView.unmount();

    // Hidden bar: the bar's visibility outranks the checkbox, and the arrival
    // is not held back for when the bar returns either.
    storeDefault(true);
    const hidden = makeSpeech();
    const hiddenView = render(cell(hidden, false));
    await settleTerminal();
    hidden.arrive("u-2");
    hiddenView.rerender(cell(hidden, false));
    expect(pane()).toBeNull();
    hiddenView.rerender(cell(hidden, true));
    expect(pane()).toBeNull();
  });
});
