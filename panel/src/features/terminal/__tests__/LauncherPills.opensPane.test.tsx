/**
 * A launcher press opens the answer pane.
 *
 * ## Why this file exists at all
 *
 * A cell that has never spoken cannot show that its agent is working. The pane
 * starts closed and its only auto-opener is an arriving utterance, so for the
 * whole of an agent's boot nothing opens it on the cell's behalf. Pressing a
 * launcher pill is the user asking the agent to start, so the press is the
 * second opener.
 *
 * The bar used to hide the eye until the cell had spoken, which made the press
 * the ONLY opener in that window — and left the pane with no way back once
 * Escape had closed it. The eye is on the row from mount now
 * (`SpeechControlBar.alwaysTransport.test.tsx`), so the press is no longer the
 * only way in; it is still an opener, because a user who pressed a button
 * should be shown what it did rather than having to go and ask.
 *
 * ## Why it is driven through the whole cell
 *
 * The subject is a seam, not a component: the press is in `LauncherPills`, the
 * wait is in `answerWaiting`, the pane's open state is in `answerPaneState`,
 * and `TerminalView` is the only thing that sees all three. A test of the pill
 * alone would assert that a function was called; what has to hold is that the
 * pane is ON SCREEN showing the wave, and that it goes away again when the
 * agent it was opened for finishes without saying anything. So the cell is
 * rendered whole, with a real bar, a real pane and a real PTY write under it.
 *
 * ## Why delivery is what is asserted, never the click
 *
 * `submitToPty` writes the body, and since the reconnect change a refused body
 * is offered a second socket before anything is reported — so "delivered" can
 * arrive a gap after the click, and `onDelivered` is the only honest signal. A
 * press whose frame never lands must open nothing: the pane would be claiming
 * an agent had been asked for when the command never left the browser. The
 * refused case here therefore pins the pane AND the wait, not just the toast.
 *
 * The socket stand-in reports delivery the way the real one does — `send`
 * returns whether the frame reached an OPEN socket — and `term.accept` is what
 * a test flips to make the cell's socket refuse.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepare } from "../../speech/prepare";
import { setStoredAutoOpenAnswer } from "../../speech/autoOpenAnswer";
import type { GridSpeech, SpeechUnit, Utterance } from "../../speech/types";
import { emptyUtteranceQueue, type UtteranceQueue } from "../../speech/utteranceQueue";

/**
 * The terminal instance stand-in. `send` is the only part that matters here:
 * it reports delivery, and refuses everything while `term.accept` is off.
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
        // The real contract: `true` only when the frame reached an OPEN socket.
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
    // The attention LED's dismiss, and the theme the buffer snapshot reads.
    // Present even though nothing here lights an LED: a factory missing an
    // export fails as an UNHANDLED error beside a green result, which is the
    // worst shape a failure can take.
    sendDismiss: () => {},
    THEME: new Proxy({}, { get: () => "#000000" }),
    followBottomAcrossResize: (_terminal: unknown, fit: () => void) => fit(),
    // `ptySubmit` asks these before offering a refused body a second socket.
    // `unattached` is the honest answer for a mocked pool — this browser holds
    // no real terminal — and it is also the answer that makes a refusal final,
    // which is the case the refused test is about.
    hasExited: () => false,
    getConnectionState: () => "unattached",
    onConnectionChange: () => () => {},
    reconnectSession: () => {},
    // The composer repairs the socket on focus; nothing here focuses it, but
    // the import is real and the mock has to carry it.
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

const ANSWER = "The migration finished, so the deploy is unblocked.";
const utterance: Utterance = { id: "u-1", sessionId: SESSION, text: ANSWER, at: 1 };

/** Shared, because a `useSyncExternalStore` snapshot must be referentially
 *  stable between notifications — a fresh value per call is a render loop. */
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);

/**
 * A cell that has never spoken — `empty`, so the row carries launcher pills —
 * with one answer it can be made to receive.
 *
 * `arrive` moves the boxed queue the way the real reducer does; a `rerender`
 * is then what hands the cell the new reference, which is all a cell ever sees
 * of an arrival.
 */
type Host = GridSpeech & { arrive: () => void };

function makeSpeech(): Host {
  let queue: UtteranceQueue = emptyUtteranceQueue;
  let spoken = false;
  const units = prepare(ANSWER).units;

  return {
    arrive: () => {
      queue = { ...emptyUtteranceQueue, current: utterance };
      spoken = true;
    },
    // One direction only, exactly as the real host: a cell never returns to
    // `empty` once it has an answer, so the pills never come back.
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
const cell = (speech: GridSpeech, speechBarVisible = true) => (
  <MemoryRouter>
    <TerminalView sessionId={SESSION} speech={speech} speechBarVisible={speechBarVisible} />
  </MemoryRouter>
);

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const pane = (): HTMLElement | null => screen.queryByTestId(`answer-pane-${SESSION}`);
const wave = (): HTMLElement | null => screen.queryByTestId(`answer-pane-waiting-${SESSION}`);
const launcher = (): HTMLElement => screen.getByRole("button", { name: "claude" });

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
function activity(state: "idle" | "busy" | "attention"): void {
  at += 1;
  act(() => {
    _applyEventForTests({ sessionId: SESSION, state, at });
  });
}

beforeEach(() => {
  at = 0;
  term.writes.length = 0;
  term.accept = true;
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  // All three stores outlive a view on purpose, so every test starts the cell
  // from fresh entries.
  _resetForTests();
  __resetAnswerWaitingForTests();
  __resetPtySubmitForTests();
  forgetAnswerPane(SESSION);
});

afterEach(() => {
  _resetForTests();
  __resetAnswerWaitingForTests();
  __resetPtySubmitForTests();
  forgetAnswerPane(SESSION);
  vi.unstubAllGlobals();
});

describe("a launcher press opens the answer pane", () => {
  it("a launcher press opens the pane and leaves no opened-for-wait mark", async () => {
    render(cell(makeSpeech()));
    // The cell has never spoken, so the pane is closed. The eye is on the row
    // — it has been since the strip stopped being conditional — but nothing
    // has pressed it, which is what makes the press below the opener.
    expect(pane()).toBeNull();
    expect(screen.getByTestId(`speech-bar-eye-${SESSION}`)).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(launcher());
    await settleSubmit();

    // The command actually went: the body, and the return that runs it.
    expect(term.writes).toEqual(["claude", "\r"]);
    // ...and the pane is open on the wave, not on an empty body.
    expect(pane()).not.toBeNull();
    expect(wave()).toBeInTheDocument();
    // The state machine's half, with NO pending mark: pressing `start` is not
    // asking a question, so nothing is outstanding.
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: false });
  });

  it("a refused launcher press opens nothing", async () => {
    term.accept = false;
    render(cell(makeSpeech()));

    fireEvent.click(launcher());
    await settleSubmit();

    // Nothing left the browser...
    expect(term.writes).toEqual([]);
    // ...so there is no agent to wait for and nothing to show a wave about.
    expect(pane()).toBeNull();
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: false, pending: false });
    // And the row's own advance is unchanged by this task: a refused pill
    // still leaves the launchers up rather than swapping to `start`.
    expect(screen.queryByTestId(`speech-bar-start-${SESSION}`)).toBeNull();
  });

  it("a hidden speech bar suppresses the open", async () => {
    const speech = makeSpeech();
    const view = render(cell(speech, false));

    // With the row hidden there is no pill to press at all — the bar's
    // visibility outranks the press in the most literal way there is.
    expect(screen.queryByRole("button", { name: "claude" })).toBeNull();
    expect(pane()).toBeNull();

    // And a press made while the row was up does not survive it coming down.
    view.rerender(cell(speech, true));
    fireEvent.click(launcher());
    await settleSubmit();
    expect(pane()).not.toBeNull();

    view.rerender(cell(speech, false));
    expect(pane()).toBeNull();

    // ...nor does it come back unasked when the row returns, which is the rule
    // the eye and the auto-open switch already live under.
    view.rerender(cell(speech, true));
    expect(pane()).toBeNull();
  });

  it("the press opens the pane with auto-open switched off", async () => {
    // The browser-wide default Settings keeps, off — and the cell's entry is
    // dropped afterwards so it seeds from it.
    setStoredAutoOpenAnswer(false);
    forgetAnswerPane(SESSION);
    render(cell(makeSpeech()));

    fireEvent.click(launcher());
    await settleSubmit();

    // The switch means "open the pane when a NEW ANSWER arrives". A press is a
    // different event — the user pressing a button and being shown the result
    // of pressing it needs no separate opt-in.
    expect(pane()).not.toBeNull();
    expect(wave()).toBeInTheDocument();
    // Asserted on the control itself, so this cannot pass against a switch the
    // press quietly turned on.
    expect(screen.getByTestId(`answer-pane-auto-open-${SESSION}`)).not.toBeChecked();
  });

  it("the wait ending on idle does not close a press-opened pane", async () => {
    render(cell(makeSpeech()));

    fireEvent.click(launcher());
    await settleSubmit();
    expect(wave()).toBeInTheDocument();

    // The launched agent writes to the PTY, which is what puts the session
    // busy. The wave is already up and stays up.
    activity("busy");
    expect(wave()).toBeInTheDocument();

    // It finishes without ever speaking. The wait ends by the existing idle
    // exit with no answer to show — and `answerPaneState` keeps no memory of
    // why the pane is open, so it is left open and empty over the terminal,
    // exactly as the eye would have left it, rather than closing itself.
    activity("idle");
    await waitFor(() =>
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: false, pending: false }),
    );
    expect(pane()).not.toBeNull();
  });

  it("an answer arriving leaves the pane open on the answer", async () => {
    const speech = makeSpeech();
    const view = render(cell(speech));

    fireEvent.click(launcher());
    await settleSubmit();
    expect(wave()).toBeInTheDocument();

    // The answer the press was waiting for. The wave stood in for a body that
    // had nothing in it; now it has one.
    speech.arrive();
    view.rerender(cell(speech));

    await waitFor(() => expect(wave()).toBeNull());
    expect(pane()).not.toBeNull();
    expect(screen.getByTestId(`answer-pane-body-${SESSION}`)).toHaveTextContent(
      "the deploy is unblocked",
    );

    // ...and the wait ending afterwards does not take it away again. The pane
    // is no longer the press's to close: there is something behind it now.
    activity("busy");
    activity("idle");
    expect(pane()).not.toBeNull();
    expect(screen.getByTestId(`answer-pane-body-${SESSION}`)).toHaveTextContent(
      "the deploy is unblocked",
    );
  });

  /**
   * A regression guard for the same fact the two tests above already hold,
   * exercised on the one path where a stray "put it back the way the press
   * found it" behaviour would be hardest to notice: auto-open OFF, so the
   * arrival does not also call `setAnswerPaneOpen(…, true)` on top of the
   * press's own open. If the wait ending ever again closed a press-opened
   * pane, this is the sequence — press, answer, idle — that would catch it
   * closing an answer the user is reading.
   */
  it("an answer with auto-open off survives the wait ending", async () => {
    // The browser-wide default Settings keeps, off — and the cell's entry
    // dropped afterwards so it seeds from it.
    setStoredAutoOpenAnswer(false);
    forgetAnswerPane(SESSION);
    const speech = makeSpeech();
    const view = render(cell(speech));

    fireEvent.click(launcher());
    await settleSubmit();
    expect(wave()).toBeInTheDocument();
    // The switch really is off, so no auto-open runs on the arrival below.
    expect(screen.getByTestId(`answer-pane-auto-open-${SESSION}`)).not.toBeChecked();

    // The answer the press was waiting for.
    speech.arrive();
    view.rerender(cell(speech));
    await waitFor(() => expect(wave()).toBeNull());

    // The agent stops. The wait the press opened the pane for is over — but
    // the pane is not the press's to close any more.
    activity("busy");
    activity("idle");
    await waitFor(() =>
      expect(getAnswerWaiting(SESSION)).toEqual({ waiting: false, pending: false }),
    );
    expect(pane()).not.toBeNull();
    expect(screen.getByTestId(`answer-pane-body-${SESSION}`)).toHaveTextContent(
      "the deploy is unblocked",
    );
  });
});
