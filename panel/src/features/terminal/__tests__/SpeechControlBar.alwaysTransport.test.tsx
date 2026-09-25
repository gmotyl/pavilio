/**
 * The row always carries the eye and the transport.
 *
 * ## Why this file exists — a reason that lapsed
 *
 * The bar used to render the launcher pills INSTEAD of the transport strip
 * while the cell's state was `empty`, and the comment above that branch gave
 * three reasons: every transport control would be disabled, the scrubber would
 * have no segments, and the eye would have no pane to open.
 *
 * The third one stopped being true on this very branch. A launcher press now
 * hands the answer pane over to a "waiting for agent" wave
 * (`LauncherPills.opensPane.test.tsx`), so before the first answer there IS a
 * pane — and hiding the eye left it with no way back: the press opened the
 * pane, Escape closed it, and nothing on the row could open it again until the
 * cell finally spoke. A reload is worse, not better: the pane's open state is
 * in memory, so a refresh always starts closed and a cell that has never
 * spoken locks the user out of the answer panel entirely.
 *
 * So the strip is rendered always. The eye is LIVE, because it has a pane to
 * open. The transport is DISABLED until the first answer, because reasons one
 * and two still hold — and "disabled" says *not yet* where hiding said *never*.
 *
 * ## Why the height is measured rather than reasoned about
 *
 * The row is in flow and reserved from mount precisely so its height never
 * changes: `TerminalView` runs an uncoalesced `ResizeObserver(() =>
 * inst.fit())`, and `fit()` SIGWINCHes the PTY unconditionally, on top of an
 * unfixed codex resize bug. Putting the pills and the strip in the same line
 * is exactly the kind of change that grows a row, so the claim is measured:
 * the real `src/index.css` is put in the document and `getComputedStyle` is
 * asked, on the real rendered elements, in both states. jsdom lays nothing
 * out, so what this proves is the CASCADE — the height the row resolves to and
 * the floor its flex line can be squeezed to — not what a browser paints. That
 * is the same discipline `SpeechControlBar.test.tsx` uses for the row's
 * position and its hairline.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepare } from "../../speech/prepare";
import type { CellSpeechState, GridSpeech, SpeechUnit, Utterance } from "../../speech/types";
import { emptyUtteranceQueue, type UtteranceQueue } from "../../speech/utteranceQueue";

/** The terminal instance stand-in, for the one test that drives the whole cell. */
const term = vi.hoisted(() => ({ writes: [] as string[] }));

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
    // Present even where nothing here reaches them: a factory missing an export
    // fails as an UNHANDLED error beside a green result.
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

// The synthesis cache the bar peeks into: everything is cold, and nothing
// notifies. The segments' own states are asserted in `SpeechControlBar.test.tsx`.
vi.mock("../../speech/synth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../speech/synth")>()),
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

// Imported after the mocks so they pick them up.
const { SpeechControlBar } = await import("../SpeechControlBar");
const { TerminalView } = await import("../TerminalView");
const { forgetAnswerPane } = await import("../answerPaneState");
const { __resetAnswerWaitingForTests } = await import("../answerWaiting");
const { __resetPtySubmitForTests } = await import("../ptySubmit");

const SESSION = "cell-a";

const ANSWER = "The migration finished, so the deploy is unblocked.";
const answerAt = (id: string): Utterance => ({ id, sessionId: SESSION, text: ANSWER, at: 1 });

/** Shared, because a `useSyncExternalStore` snapshot must be referentially
 *  stable between notifications — a fresh value per call is a render loop. */
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);

interface HostOverrides {
  state?: CellSpeechState;
  queue?: UtteranceQueue;
  units?: readonly SpeechUnit[];
}

function makeSpeech(over: HostOverrides = {}): GridSpeech {
  return {
    stateFor: () => over.state ?? "empty",
    queueFor: () => over.queue ?? emptyUtteranceQueue,
    heardFor: () => NOTHING_HEARD,
    unitsFor: () => over.units ?? NO_UNITS,
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

/**
 * A cell that has answered, with a step available in both directions — so the
 * transport's two ends are asked the question they actually answer (the
 * cursor's, not the state's) rather than being pinned against an empty queue
 * that would disable them for a second reason.
 */
function spokenSpeech(): GridSpeech {
  return makeSpeech({
    state: "ready",
    queue: {
      previous: [answerAt("u-0")],
      current: answerAt("u-1"),
      pending: [answerAt("u-2")],
      cursor: 0,
    },
    units: prepare(ANSWER).units,
  });
}

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const noop = (): void => {};
const noSend = (): boolean => true;

function renderBar(speech: GridSpeech, onToggleAnswer: () => void = noop) {
  return render(
    <SpeechControlBar
      sessionId={SESSION}
      speech={speech}
      answerOpen={false}
      onToggleAnswer={onToggleAnswer}
      send={noSend}
    />,
  );
}

const eye = (): HTMLElement | null => screen.queryByTestId(`speech-bar-eye-${SESSION}`);
const playPause = (): HTMLElement => screen.getByTestId(`speech-bar-playpause-${SESSION}`);
const previous = (): HTMLElement => screen.getByTestId(`speech-bar-previous-${SESSION}`);
const next = (): HTMLElement => screen.getByTestId(`speech-bar-next-${SESSION}`);
const scrubber = (): HTMLElement => screen.getByTestId(`speech-bar-scrubber-${SESSION}`);
const pillLabels = (): string[] =>
  screen
    .queryAllByTestId(new RegExp(`^speech-bar-launch-${SESSION}-\\d+$`))
    .map((pill) => pill.textContent ?? "");

// ---------------------------------------------------------------------------
// The measurement rig. The real stylesheet goes into the document, so the
// selectors that decide the row's size are the shipped ones and the elements
// they match are the rendered ones.
// ---------------------------------------------------------------------------

const css = readFileSync(join(__dirname, "..", "..", "..", "index.css"), "utf8");

function useRealStylesheet(): () => void {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  return () => style.remove();
}

/** A computed length in px, as a number. `auto` and the unset case are null. */
function px(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The narrowest the row's flex line can be squeezed to, in px.
 *
 * A child that cannot shrink (`flex-shrink: 0`) contributes its own width; one
 * that can contributes its `min-width`, which is the floor a flex item is
 * allowed to be pressed to. Add the gaps between them and the row's own
 * padding and the result is the width below which the line stops fitting —
 * which is the only honest spelling of "nothing overflows" available without a
 * layout engine.
 */
function minimumRowWidth(row: HTMLElement): number {
  const rowStyle = getComputedStyle(row);
  const children = [...row.children] as HTMLElement[];
  const gap = px(rowStyle.gap) ?? 0;
  const padding = (px(rowStyle.paddingLeft) ?? 0) + (px(rowStyle.paddingRight) ?? 0);

  const content = children.reduce((sum, child) => {
    const style = getComputedStyle(child);
    if (style.display === "none") return sum;
    const floor =
      (px(style.flexShrink) ?? 1) === 0 ? (px(style.width) ?? 0) : (px(style.minWidth) ?? 0);
    return sum + floor;
  }, 0);

  const gaps = Math.max(children.filter((c) => getComputedStyle(c).display !== "none").length - 1, 0);
  return content + gaps * gap + padding;
}

const rowOf = (): HTMLElement =>
  screen.getByTestId(`speech-bar-${SESSION}`).querySelector(".speech-bar-row") as HTMLElement;

beforeEach(() => {
  term.writes.length = 0;
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  __resetAnswerWaitingForTests();
  __resetPtySubmitForTests();
  forgetAnswerPane(SESSION);
});

afterEach(() => {
  __resetAnswerWaitingForTests();
  __resetPtySubmitForTests();
  forgetAnswerPane(SESSION);
  vi.unstubAllGlobals();
});

describe("the bar always carries the eye and the transport", () => {
  it("a cell that has never spoken still shows the eye", () => {
    renderBar(makeSpeech());

    // The eye is on the row from mount, and it is a live control — it has a
    // pane to open, which is exactly the reason that lapsed.
    const control = eye();
    expect(control).not.toBeNull();
    expect(control).not.toBeDisabled();
    // ...and its name is honest. "Answer, unit 1 of 0" is not a position.
    expect(control).toHaveAttribute("aria-label", "Answer, nothing spoken yet");
    expect(control).toHaveAttribute("aria-pressed", "false");
    // The whole strip is there, not just the eye.
    expect(scrubber()).toBeInTheDocument();
    expect(playPause()).toBeInTheDocument();
  });

  it("a cell that has never spoken shows the transport disabled", () => {
    const speech = makeSpeech();
    renderBar(speech);

    // Reasons one and two of the old comment, kept — as DISABLED rather than
    // absent, which says *not yet* instead of *never*.
    expect(previous()).toBeDisabled();
    expect(playPause()).toBeDisabled();
    expect(next()).toBeDisabled();

    // The existing `empty` semantics carry the why, rather than a parallel
    // disabled state invented for this row.
    expect(playPause()).toHaveAttribute("aria-label", "Nothing to speak yet");
    expect(playPause()).toHaveAttribute("data-icon", "none");
    expect(playPause()).toHaveAttribute("data-speech", "empty");

    // And a press that gets through anyway reaches nothing.
    fireEvent.click(playPause());
    expect(speech.onSpeak).not.toHaveBeenCalled();
    expect(speech.onResume).not.toHaveBeenCalled();
    expect(speech.onPause).not.toHaveBeenCalled();
  });

  it("a cell that has never spoken has a scrubber with nothing in it", () => {
    renderBar(makeSpeech());

    // No segments, because there are no units — and so no fill and no
    // playhead: the strip claims no progress it does not have.
    expect(screen.queryAllByTestId(new RegExp(`^speech-bar-segment-${SESSION}-`))).toHaveLength(0);
    expect(scrubber().children).toHaveLength(0);
    // It yields its share of the rail while it is empty, which is what makes
    // room for the pills beside the strip. See the layout test below.
    expect(scrubber()).toHaveAttribute("data-empty", "1");
  });

  it("the eye works before the first answer", () => {
    const onToggleAnswer = vi.fn();
    renderBar(makeSpeech(), onToggleAnswer);

    fireEvent.click(eye() as HTMLElement);

    expect(onToggleAnswer).toHaveBeenCalledTimes(1);
  });

  it("the launcher pills survive alongside the transport", async () => {
    const send = vi.fn((_data: string) => true);
    render(
      <SpeechControlBar
        sessionId={SESSION}
        speech={makeSpeech()}
        answerOpen={false}
        onToggleAnswer={noop}
        send={send}
      />,
    );

    // This change ADDS to the row; it does not take the pills' place.
    expect(pillLabels()).toEqual(["claude", "codex", "opencode"]);
    expect(playPause()).toBeInTheDocument();
    expect(eye()).not.toBeNull();

    // ...and they still run their command.
    fireEvent.click(screen.getByRole("button", { name: "claude" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(send).toHaveBeenCalled();
    expect(send.mock.calls.map(([data]) => data)).toEqual(["claude", "\r"]);
  });

  it("the first answer enables the transport", () => {
    const view = renderBar(makeSpeech());

    expect(playPause()).toBeDisabled();
    const pillsBefore = pillLabels();
    expect(pillsBefore).not.toEqual([]);

    view.rerender(
      <SpeechControlBar
        sessionId={SESSION}
        speech={spokenSpeech()}
        answerOpen={false}
        onToggleAnswer={noop}
        send={noSend}
      />,
    );

    // Exactly as it behaves today: the play control is live, and the two ends
    // follow the cursor rather than the state.
    expect(playPause()).not.toBeDisabled();
    expect(playPause()).toHaveAttribute("aria-label", "Speak the last response");
    expect(previous()).not.toBeDisabled();
    expect(next()).not.toBeDisabled();
    // The scrubber takes the rail back, with a segment per unit.
    expect(scrubber()).not.toHaveAttribute("data-empty", "1");
    expect(
      screen.queryAllByTestId(new RegExp(`^speech-bar-segment-${SESSION}-`)).length,
    ).toBeGreaterThan(0);
    // And the eye carries a position again, because now there is one.
    expect(eye()).toHaveAttribute("aria-label", `Answer, unit 1 of ${prepare(ANSWER).units.length}`);
    // One direction only: the pills go when the first answer lands.
    expect(pillLabels()).toEqual([]);
  });

  /**
   * The bug this whole change is for, driven through the cell that owns both
   * halves: the pane's open state lives in `answerPaneState`, Escape is
   * `TerminalView`'s document listener, and the eye is on the bar. A test of
   * the bar alone would assert a callback fired.
   */
  it("the eye reopens a pane closed with Escape", async () => {
    render(
      <MemoryRouter>
        <TerminalView sessionId={SESSION} speech={makeSpeech()} speechBarVisible />
      </MemoryRouter>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    // A launcher press is what opens the pane on a cell that has never spoken.
    fireEvent.click(screen.getByRole("button", { name: "claude" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(screen.queryByTestId(`answer-pane-${SESSION}`)).not.toBeNull();

    // Escape puts the keyboard back in the terminal and takes the pane away.
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByTestId(`answer-pane-${SESSION}`)).toBeNull();

    // ...and the eye is the way back. Before this change there was none: the
    // cell has still not spoken, so nothing else on the row could reopen it.
    act(() => {
      fireEvent.click(eye() as HTMLElement);
    });
    expect(screen.queryByTestId(`answer-pane-${SESSION}`)).not.toBeNull();
    expect(screen.queryByTestId(`answer-pane-waiting-${SESSION}`)).toBeInTheDocument();
  });

  /**
   * The hard constraint. The row is a fixed rail spent at mount; carrying the
   * pills AND the strip must not grow it, and must not push the line wider
   * than it already goes once the cell has spoken.
   */
  describe("the row does not grow to hold both", () => {
    let dropStylesheet: () => void;

    beforeEach(() => {
      dropStylesheet = useRealStylesheet();
    });

    afterEach(() => {
      dropStylesheet();
    });

    it("the row's height is the same before and after the first answer", () => {
      const view = renderBar(makeSpeech());
      const empty = getComputedStyle(rowOf());
      const emptyHeight = empty.height;

      // The rule reached this element at all — a stylesheet that failed to
      // parse would report the user-agent value and pass on thin air.
      expect(emptyHeight).toBe("56px");
      // And the line cannot wrap onto a second one, which is the only other
      // way a fixed-height row grows its content past its box.
      expect(empty.flexWrap).toBe("nowrap");

      view.rerender(
        <SpeechControlBar
          sessionId={SESSION}
          speech={spokenSpeech()}
          answerOpen={false}
          onToggleAnswer={noop}
          send={noSend}
        />,
      );

      const spoken = getComputedStyle(rowOf());
      expect(spoken.height).toBe(emptyHeight);
      expect(spoken.flexWrap).toBe("nowrap");

      // Nothing in the line is taller than the row's content box, in either
      // state, so no child can push the height from inside.
      const contentHeight = 56 - 6 - 6;
      for (const child of [...rowOf().children] as HTMLElement[]) {
        const height = px(getComputedStyle(child).height);
        if (height === null) continue;
        expect(height).toBeLessThanOrEqual(contentHeight);
      }
    });

    it("the empty row's line is no wider than the one the cell already carries", () => {
      const view = renderBar(makeSpeech());
      const withPills = minimumRowWidth(rowOf());

      view.rerender(
        <SpeechControlBar
          sessionId={SESSION}
          speech={spokenSpeech()}
          answerOpen={false}
          onToggleAnswer={noop}
          send={noSend}
        />,
      );
      const withScrubber = minimumRowWidth(rowOf());

      // The floor is a real number, not an accident of everything computing
      // to zero: the fixed controls alone are 44px each.
      expect(withPills).toBeGreaterThan(44);
      // The empty row carries one more box than the spoken one, and squeezes
      // no wider: the pills and the collapsed scrubber both floor at zero, so
      // what is left is the same fixed rail the cell lives with once it has
      // answered. A narrow cell is therefore no worse off before the first
      // answer than after it.
      expect(withPills).toBeLessThanOrEqual(withScrubber);
    });
  });
});
