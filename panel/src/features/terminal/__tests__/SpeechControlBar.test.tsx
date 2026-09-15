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
import { CellSpeakButton } from "../CellSpeakButton";
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

/**
 * The synthesis cache the bar peeks into, made writable. A `ready` segment
 * means "this unit's audio is in hand, so clicking it starts with no wait",
 * and the cache is filled from two places the bar cannot see — the host's
 * arrival warm and the player's ladder — so the only honest way to drive that
 * state here is to say what is warm. Everything else in `synth` stays real.
 */
const warm = vi.hoisted(() => new Set<string>());
/**
 * Requested, socket open, audio not here yet — the half of "cached" the peek
 * used to swallow into `ready`. Held apart from {@link warm} so a test can walk
 * a unit across the transition the bar exists to show.
 */
const warming = vi.hoisted(() => new Set<string>());
/** Whoever `subscribeSpeechCache` handed an unsubscribe to. */
const cacheListeners = vi.hoisted(() => new Set<() => void>());

vi.mock("../../speech/synth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../speech/synth")>()),
  // Unchanged meaning — the dedupe question, which an in-flight entry answers
  // yes to. Kept faithful so no test here can accidentally pass while the bar
  // is still reading it for readiness.
  isSpeechSynthesized: (text: string) => warm.has(text) || warming.has(text),
  speechCacheState: (text: string) =>
    warm.has(text) ? "ready" : warming.has(text) ? "warming" : "cold",
  subscribeSpeechCache: (listener: () => void) => {
    cacheListeners.add(listener);
    return () => {
      cacheListeners.delete(listener);
    };
  },
}));

/**
 * The cache announcing that a peek would now answer differently — what the real
 * one fires on an add, a settle and an eviction. Nothing else in these tests
 * publishes: `subscribeProgress` is inert, which is the whole point.
 */
function cacheChanged(): void {
  for (const listener of [...cacheListeners]) listener();
}

/** One unit's synthesis landing, announced. */
function settle(text: string): void {
  warming.delete(text);
  warm.add(text);
  cacheChanged();
}

// Imported after the mocks so it picks them up.
const { TerminalView } = await import("../TerminalView");

/** For tests that render the bar and never touch the eye. */
const noop = (): void => {};

const resizeFrames = (): string[] => term.sent.filter((frame) => frame.includes('"resize"'));

class StubResizeObserver {
  observe(element: Element): void {
    term.observed.push(element);
  }
  unobserve(): void {}
  disconnect(): void {}
}

const units = (...chars: number[]): SpeechUnit[] =>
  chars.map((count) => {
    const text = "x".repeat(count);

    return { text, chars: count, source: text };
  });

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

/** What a segment says it is: played, playing, ready or cold. */
function segmentAt(sessionId: string, index: number): string | null {
  return screen
    .getByTestId(`speech-bar-segment-${sessionId}-${index}`)
    .getAttribute("data-segment");
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
  warm.clear();
  warming.clear();
  cacheListeners.clear();
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

    render(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={speech} />);

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

    render(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={speech} />);

    expect(widthOf("cell-a", 0)).toBeCloseTo(25, 1);
    expect(widthOf("cell-a", 1)).toBeCloseTo(75, 1);
  });

  it("a unit in the synthesis cache is drawn ready, not cold", () => {
    const all = units(200, 240, 280);
    // Only the middle unit is warm. Nothing has played, so `ready` can only
    // come from the cache — which is the entire reason `isSpeechSynthesized`
    // exists: "clicking this segment starts with no wait".
    warm.add(all[1].text);

    const speech = makeSpeech({
      state: "ready",
      queue: queueWith({ current: utterance("u-1") }),
      units: all,
      progress: null,
      durations: new Map<number, number>(),
    });

    render(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={speech} />);

    expect(segmentAt("cell-a", 0)).toBe("cold");
    expect(segmentAt("cell-a", 1)).toBe("ready");
    expect(segmentAt("cell-a", 2)).toBe("cold");

    // And a ready segment is still a jump: warm is about the wait, not about
    // whether the click does anything.
    fireEvent.click(screen.getByTestId("speech-bar-segment-cell-a-1"));
    expect(speech.onJumpToUnit).toHaveBeenCalledWith("cell-a", 1);
  });

  it("a unit that has been heard stays played even while it is still warm", () => {
    const all = units(200, 240);
    // Warm AND measured. The run is over, so nothing is playing — the segment
    // must report the stronger fact, which is that it was spoken.
    warm.add(all[0].text);

    const speech = makeSpeech({
      state: "heard",
      queue: queueWith({ current: utterance("u-1") }),
      units: all,
      progress: null,
      durations: new Map([[0, 3]]),
    });

    render(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={speech} />);

    expect(segmentAt("cell-a", 0)).toBe("played");
    expect(segmentAt("cell-a", 1)).toBe("cold");
  });

  /**
   * The ladder, made watchable.
   *
   * `isSpeechSynthesized` answers "is there an entry under this key", and the
   * cache stores the in-flight promise — so it says yes the moment the socket
   * opens. `cascadeWarm` opens three slots in one tick, which made three
   * segments flip to `ready` together and the ladder read as a single step.
   * The states were not wrong about what they measured; they measured the
   * wrong thing.
   */
  describe("warming", () => {
    const barFor = (all: SpeechUnit[], over: SpeechOverrides = {}): GridSpeech =>
      makeSpeech({
        state: "ready",
        queue: queueWith({ current: utterance("u-1") }),
        units: all,
        progress: null,
        durations: new Map<number, number>(),
        ...over,
      });

    it("a unit whose synthesis is in flight is drawn warming", () => {
      const all = units(200, 240, 280);
      warming.add(all[1].text); // requested, socket open, no audio yet
      warm.add(all[2].text); // landed

      render(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={barFor(all)} />);

      expect(segmentAt("cell-a", 0)).toBe("cold");
      expect(segmentAt("cell-a", 1)).toBe("warming");
      expect(segmentAt("cell-a", 2)).toBe("ready");
    });

    it("a warming segment settles to ready with no progress tick", () => {
      const all = units(200, 240);
      warming.add(all[0].text);

      render(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={barFor(all)} />);
      expect(segmentAt("cell-a", 0)).toBe("warming");

      // The audio lands while the run is paused or stalled. `subscribeProgress`
      // publishes nothing in either state — and `cascadeWarm` keeps warming
      // through a pause, because a pause does not clear `run.active` — so the
      // cache's own notification is the only thing that can move this segment.
      act(() => settle(all[0].text));

      expect(segmentAt("cell-a", 0)).toBe("ready");
    });

    it("the cascade's window warms together and settles one at a time", () => {
      // Distinct lengths, so distinct texts: the cache is keyed by text, and
      // four identical units would be one entry with one state.
      const all = units(200, 210, 220, 230);
      // SYNTHESIS_CONCURRENCY slots open in the same tick.
      for (const unit of all.slice(0, 3)) warming.add(unit.text);

      render(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={barFor(all)} />);

      const row = () => all.map((_unit, index) => segmentAt("cell-a", index));
      expect(row()).toEqual(["warming", "warming", "warming", "cold"]);

      // One landing is one step of the ladder, not the whole staircase.
      act(() => settle(all[0].text));
      expect(row()).toEqual(["ready", "warming", "warming", "cold"]);

      act(() => settle(all[1].text));
      expect(row()).toEqual(["ready", "ready", "warming", "cold"]);
    });

    it("played still wins over warming", () => {
      const all = units(200, 240);
      // Measured — so it has been through the element — and warming again,
      // which a re-prepare or a neighbouring voice can do. Spoken is the
      // stronger fact.
      warming.add(all[0].text);

      render(
        <SpeechControlBar
          sessionId="cell-a"
          answerOpen={false}
          onToggleAnswer={noop}
          speech={barFor(all, { state: "heard", durations: new Map([[0, 3]]) })}
        />,
      );

      expect(segmentAt("cell-a", 0)).toBe("played");
      expect(segmentAt("cell-a", 1)).toBe("cold");
    });

    it("the playing segment still wins over warming", () => {
      const all = units(200, 240, 280);
      // Everything in flight at once, including the unit in the element.
      for (const unit of all) warming.add(unit.text);

      render(
        <SpeechControlBar
          sessionId="cell-a"
          answerOpen={false}
          onToggleAnswer={noop}
          speech={barFor(all, {
            state: "speaking",
            progress: { unitIndex: 1, unitTime: 1, unitDuration: 3 },
          })}
        />,
      );

      expect(segmentAt("cell-a", 0)).toBe("played");
      expect(segmentAt("cell-a", 1)).toBe("playing");
      expect(segmentAt("cell-a", 2)).toBe("warming");
    });

    it("a cell with no utterance is still empty and still inert while warming", () => {
      // Nothing to warm, nothing to draw: a cache notification for some other
      // cell must not conjure a scrubber here.
      const speech = makeSpeech({ state: "empty", queue: emptyUtteranceQueue, units: [] });

      render(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={speech} />);
      act(() => cacheChanged());

      expect(screen.queryAllByTestId(/^speech-bar-segment-cell-a-/)).toHaveLength(0);
      expect(screen.getByTestId("speech-bar-playpause-cell-a")).toBeDisabled();
    });
  });

  /**
   * The scrubber is a POINTER affordance, and it says so.
   *
   * It used to carry `role="button"` with `tabIndex={-1}` and a keyboard
   * handler nowhere — a role WAI-ARIA defines as focusable and Enter/Space
   * operable, on an element that was neither. That advertises an action to a
   * screen reader and then does not expose it, which is worse than not
   * advertising it: the announcement is the promise.
   *
   * Making the segments genuinely operable was the other honest option and was
   * rejected on the grid. An answer of fifteen units would put fifteen tab
   * stops inside ONE cell's bar, in a panel that tiles many cells — crossing
   * the grid by keyboard would mean tabbing through every unit of every answer
   * on screen. The function is not lost by dropping the role: `previous` /
   * `next` are real buttons with accessible names, and `Ctrl+Shift+←/→` walks
   * the queue from anywhere (`features/speech/useSpeechKeys`). What the
   * segments add over those is per-unit jumping and a drag-seek, both of which
   * are pointer gestures refining a function the keyboard already reaches.
   *
   * So: no role, no tab stop, and the graphic is hidden from assistive tech
   * rather than announced as a row of phantom buttons. The position readout
   * next to it — "3/7" — stays visible to a screen reader, which is the part
   * that carries information rather than affordance.
   */
  describe("the scrubber is a pointer affordance, not a row of buttons", () => {
    const barWithUnits = () =>
      makeSpeech({
        state: "ready",
        queue: queueWith({ current: utterance("u-1") }),
        units: units(200, 200, 200),
        progress: null,
        durations: new Map<number, number>(),
      });

    it("no segment claims a role it does not implement", () => {
      render(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={barWithUnits()} />);

      for (const segment of screen.getAllByTestId(/^speech-bar-segment-cell-a-/)) {
        expect(segment).not.toHaveAttribute("role");
        // Not even -1: a non-interactive graphic has no business in the focus
        // order, programmatic or otherwise.
        expect(segment).not.toHaveAttribute("tabindex");
        expect(segment).not.toHaveAttribute("aria-label");
      }
    });

    it("the segments are not announced at all", () => {
      render(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={barWithUnits()} />);

      expect(screen.getByTestId("speech-bar-scrubber-cell-a")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      // Fifteen units would otherwise be fifteen announcements per cell.
      expect(screen.queryAllByRole("button", { name: /^Unit \d/ })).toHaveLength(0);
    });

    it("the transport the scrubber refines is still reachable by keyboard", () => {
      // The trade-off's other half: dropping the role is only honest because
      // the function has a keyboard route. These are real buttons with names,
      // and `useSpeechKeys` binds Ctrl+Shift+←/→ to the same two handlers.
      const speech = makeSpeech({
        state: "ready",
        queue: queueWith({ previous: utterance("u-0"), current: utterance("u-1") }),
        units: units(200, 200, 200),
      });

      render(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={speech} />);

      const previous = screen.getByRole("button", { name: "Previous answer" });
      const next = screen.getByRole("button", { name: "Next answer" });
      expect(previous).not.toBeDisabled();
      expect(previous.tabIndex).toBe(0);
      expect(next.tabIndex).toBe(0);

      fireEvent.click(previous);
      expect(speech.onPrevious).toHaveBeenCalledWith("cell-a");
    });

    /**
     * The eye: the button that opens the answer pane, standing where the
     * `n/N` readout used to. Its accessible name carries the position, so a
     * screen reader is still told "unit 2 of 3" — from a control it can
     * press, instead of a span it could only hear.
     */
    describe("the eye", () => {
      const speaking = (answerOpen: boolean, onToggleAnswer = noop, progress = true) =>
        render(
          <SpeechControlBar
            sessionId="cell-a"
            answerOpen={answerOpen}
            onToggleAnswer={onToggleAnswer}
            speech={makeSpeech({
              state: "speaking",
              queue: queueWith({ current: utterance("u-1") }),
              units: units(200, 200, 200, 200, 200),
              progress: progress ? { unitIndex: 1, unitTime: 1, unitDuration: 3 } : null,
            })}
          />,
        );

      it("the eye replaces the position readout", () => {
        speaking(false);

        const eye = screen.getByTestId("speech-bar-eye-cell-a");
        expect(eye.tagName).toBe("BUTTON");
        expect(eye).toHaveAttribute("type", "button");
        expect(screen.queryByTestId("speech-bar-position-cell-a")).toBeNull();
        // Announced, unlike the scrubber beside it.
        expect(eye.closest("[aria-hidden='true']")).toBeNull();
      });

      it("the eye's name says show or hide and carries the position", () => {
        const closed = speaking(false);
        expect(screen.getByRole("button", { name: "Show answer, unit 2 of 5" })).toBeInTheDocument();
        expect(screen.getByTestId("speech-bar-eye-cell-a")).toHaveAttribute(
          "title",
          "Show answer, unit 2 of 5",
        );
        closed.unmount();

        const open = speaking(true);
        expect(screen.getByRole("button", { name: "Hide answer, unit 2 of 5" })).toBeInTheDocument();
        open.unmount();

        // No run yet: the position is the first unit, as the readout said.
        speaking(false, noop, false);
        expect(screen.getByRole("button", { name: "Show answer, unit 1 of 5" })).toBeInTheDocument();
      });

      it("the eye reports its pressed state", () => {
        const closed = speaking(false);
        const shut = screen.getByTestId("speech-bar-eye-cell-a");
        expect(shut).toHaveAttribute("aria-pressed", "false");
        expect(shut).toHaveAttribute("data-open", "0");
        closed.unmount();

        speaking(true);
        const eye = screen.getByTestId("speech-bar-eye-cell-a");
        expect(eye).toHaveAttribute("aria-pressed", "true");
        expect(eye).toHaveAttribute("data-open", "1");
      });

      it("clicking the eye toggles and does not reach the cell", () => {
        const onToggleAnswer = vi.fn();
        const cellClick = vi.fn();

        // The cell is the bar's parent; a click that escaped the bar root
        // would focus the terminal under it.
        render(
          <div onClick={cellClick}>
            <SpeechControlBar
              sessionId="cell-a"
              answerOpen={false}
              onToggleAnswer={onToggleAnswer}
              speech={makeSpeech({ units: units(200, 200, 200) })}
            />
          </div>,
        );

        fireEvent.click(screen.getByTestId("speech-bar-eye-cell-a"));

        expect(onToggleAnswer).toHaveBeenCalledTimes(1);
        expect(cellClick).not.toHaveBeenCalled();
      });
    });
  });

  /**
   * The pulse, repeated.
   *
   * The header speak control pulses on `data-pulse="1"` — set for `ready`, the
   * one state that is asking for something. An open bar covers the top of the
   * cell, so a user watching the transport would have to look back up at the
   * header to learn that anything is waiting. The bar's play button carries the
   * same attribute, from the same derivation: one fact in two places, and no
   * second rule to keep in sync.
   */
  describe("the pulse", () => {
    const ALL_STATES: CellSpeechState[] = [
      "empty",
      "preparing",
      "ready",
      "speaking",
      "stalled",
      "paused",
      "heard",
    ];

    const barFor = (state: CellSpeechState): GridSpeech =>
      makeSpeech({
        state,
        queue: queueWith({ current: utterance("u-1") }),
        units: units(200, 240),
      });

    const pulseOf = (testId: string): string | null =>
      screen.getByTestId(testId).getAttribute("data-pulse");

    it("the play button pulses while an unheard utterance waits", () => {
      render(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={barFor("ready")} />);

      expect(pulseOf("speech-bar-playpause-cell-a")).toBe("1");
    });

    it("the play button stops pulsing once the cell is speaking", () => {
      const view = render(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={barFor("speaking")} />);
      expect(pulseOf("speech-bar-playpause-cell-a")).toBe("0");

      // …and once it has been listened to all the way through.
      view.rerender(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={barFor("heard")} />);
      expect(pulseOf("speech-bar-playpause-cell-a")).toBe("0");
    });

    it("the play button and the header control always agree", () => {
      // The criterion is not "both pulse on ready" — it is that there is only
      // one derivation. Checking every state is how a second rule, computed in
      // the bar, would be caught the first time the two drifted.
      for (const state of ALL_STATES) {
        const view = render(
          <>
            <CellSpeakButton
              sessionId="cell-a"
              state={state}
              onSpeak={() => {}}
              onPause={() => {}}
              onResume={() => {}}
            />
            <SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={barFor(state)} />
          </>,
        );

        const header = pulseOf("terminal-cell-speak-cell-a");
        expect(header).toMatch(/^[01]$/);
        expect(pulseOf("speech-bar-playpause-cell-a")).toBe(header);

        view.unmount();
      }
    });
  });

  it("clicking a segment jumps to that unit", () => {
    const speech = makeSpeech({
      state: "ready",
      queue: queueWith({ current: utterance("u-1") }),
      units: units(200, 200, 200),
    });

    render(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={speech} />);
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

    render(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={speech} />);

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

    render(<SpeechControlBar sessionId="cell-a" answerOpen={false} onToggleAnswer={noop} speech={speech} />);

    expect(screen.getByTestId("speech-bar-playpause-cell-a")).toBeDisabled();
    expect(screen.getByTestId("speech-bar-previous-cell-a")).toBeDisabled();
    expect(screen.getByTestId("speech-bar-next-cell-a")).toBeDisabled();
    // An empty scrubber: present, so the rail keeps its shape, with nothing in it.
    expect(screen.getByTestId("speech-bar-scrubber-cell-a")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^speech-bar-segment-cell-a-/)).toHaveLength(0);
  });
});
