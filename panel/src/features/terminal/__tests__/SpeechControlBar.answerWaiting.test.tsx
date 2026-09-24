/**
 * The bar as the waiting store's SURFACE.
 *
 * `answerWaiting.ts` decides nothing on its own and asks nothing of anybody:
 * every fact it holds is pushed in, and the one value it hands back — "that
 * arrival released a hold" — is a cue for the surface to move its own cursor.
 * Tasks 4 and 5 built that store; this file is what makes it real, because a
 * store whose entry points have no production caller is a module, not a
 * feature.
 *
 * The bar is the caller for all of it, and not by preference: it already holds
 * `speech.stateFor(sessionId)`, it already pushes `noteUtterance` one effect
 * away, and — the load-bearing half — it OUTLIVES the pane. `TerminalView`
 * mounts the pane only inside the row's own condition, so a cell whose eye is
 * closed still has its row, still sees its answers land, and still knows
 * whether its voice is reading. A pane that owned any of this would stop
 * knowing the moment the user closed it.
 *
 * Asserted through the real store rather than through spies on the module: the
 * criterion is what the pane's body ends up showing, and a spy would pass just
 * as happily on a push made with the wrong session, the wrong polarity or at
 * the wrong moment.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { CellSpeechState, GridSpeech, SpeechUnit, Utterance } from "../../speech/types";
import { emptyUtteranceQueue, type UtteranceQueue } from "../../speech/utteranceQueue";
import { SpeechControlBar } from "../SpeechControlBar";
import {
  __resetAnswerWaitingForTests,
  getAnswerWaiting,
  watchSessionActivity,
} from "../answerWaiting";
import { _applyEventForTests, _resetForTests } from "../useTerminalActivityChannel";

// The activity channel dials a WebSocket at import time and re-arms a 2s
// reconnect whenever that socket closes. A socket that never closes keeps
// jsdom from really trying, and keeps the timer table empty.
vi.hoisted(() => {
  class QuietSocket {
    onopen: unknown = null;
    onmessage: unknown = null;
    onclose: unknown = null;
    onerror: unknown = null;
    close(): void {}
    send(): void {}
  }
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = QuietSocket;
});

// The synthesis cache the scrubber peeks into. Nothing is warm and nothing
// subscribes: no test here draws a segment.
vi.mock("../../speech/synth", () => ({
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

const SESSION = "cell-a";

/** Referentially stable — a fresh value per call is a `useSyncExternalStore` loop. */
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();

const answer = (id: string): Utterance => ({
  id,
  sessionId: SESSION,
  text: `Answer ${id}.`,
  at: 1,
});

const queueWith = (over: Partial<UtteranceQueue> = {}): UtteranceQueue => ({
  ...emptyUtteranceQueue,
  ...over,
});

/** A cell holding one answer, with one step of history behind it. */
const WITH_HISTORY = queueWith({ previous: [answer("u-0")], current: answer("u-1") });

interface Cell {
  state: CellSpeechState;
  queue: UtteranceQueue;
}

function makeSpeech(cell: Cell): GridSpeech {
  return {
    stateFor: () => cell.state,
    queueFor: () => cell.queue,
    unitsFor: () => NO_UNITS,
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
  } satisfies GridSpeech;
}

const send = vi.fn();

const barTree = (speech: GridSpeech) => (
  <SpeechControlBar
    sessionId={SESSION}
    speech={speech}
    answerOpen={false}
    onToggleAnswer={() => {}}
    send={send}
  />
);

/** An activity broadcast landing while the bar is mounted. */
const activity = (state: "idle" | "busy" | "attention", at: number): void => {
  act(() => {
    _applyEventForTests({ sessionId: SESSION, state, at });
  });
};

/** Whether the pane's BODY has handed over — what the store is asked for. */
const bodyHandedOver = (): boolean => getAnswerWaiting(SESSION).waiting;

const previousButton = (): HTMLElement => screen.getByTestId(`speech-bar-previous-${SESSION}`);
const nextButton = (): HTMLElement => screen.getByTestId(`speech-bar-next-${SESSION}`);

/** Every command on the host, so a claim about "nothing else" covers them all. */
const commandsOf = (host: GridSpeech): [string, Mock][] =>
  (Object.keys(host) as (keyof GridSpeech)[])
    .filter((key) => typeof host[key] === "function" && key.startsWith("on"))
    .map((key) => [key, host[key] as unknown as Mock]);

const callCounts = (host: GridSpeech): Record<string, number> =>
  Object.fromEntries(commandsOf(host).map(([name, mock]) => [name, mock.mock.calls.length]));

beforeEach(() => {
  send.mockClear();
  _resetForTests();
  __resetAnswerWaitingForTests();
  // What `terminalInstances` does when the session is created: the watch is
  // the session's, not the bar's, so it is already open before anything
  // renders.
  watchSessionActivity(SESSION);
});

afterEach(() => {
  _resetForTests();
  __resetAnswerWaitingForTests();
});

describe("the bar tells the waiting store whether the voice is reading", () => {
  it("defers the handover while the voice is speaking", () => {
    render(barTree(makeSpeech({ state: "speaking", queue: WITH_HISTORY })));

    activity("busy", 2);

    // The agent went to work mid-sentence. Taking the text away here pulls it
    // out from under a sentence the listener is halfway through hearing.
    expect(bodyHandedOver()).toBe(false);
  });

  it("counts a stalled run as reading", () => {
    render(barTree(makeSpeech({ state: "stalled", queue: WITH_HISTORY })));

    activity("busy", 2);

    // A run blocked on synthesis is still a run the listener is inside: more
    // of the same answer is coming, and the pause is still theirs to press.
    expect(bodyHandedOver()).toBe(false);
  });

  it("does not count a paused run as reading", () => {
    render(barTree(makeSpeech({ state: "paused", queue: WITH_HISTORY })));

    activity("busy", 2);

    // A held run is not mid-sentence. There is no sentence to finish, so
    // there is nothing for the handover to be patient about.
    expect(bodyHandedOver()).toBe(true);
  });

  it("hands the body over when the playback the deferral waited on ends", () => {
    const cell: Cell = { state: "speaking", queue: WITH_HISTORY };
    const speech = makeSpeech(cell);
    const { rerender } = render(barTree(speech));

    activity("busy", 2);
    expect(bodyHandedOver()).toBe(false);

    // The last unit played out. The agent is still working, so the body is
    // now its.
    cell.state = "heard";
    rerender(barTree(speech));

    expect(bodyHandedOver()).toBe(true);
  });

  it("pushes false when the bar unmounts while the voice is reading", () => {
    const { unmount } = render(barTree(makeSpeech({ state: "speaking", queue: WITH_HISTORY })));

    activity("busy", 2);
    expect(bodyHandedOver()).toBe(false);

    // A cell torn out of the grid — a layout change, a preset, a maximize —
    // while its voice was reading. A `true` left standing behind it would
    // defer every later handover for the life of the tab, against a playback
    // that no surface is watching any more.
    unmount();

    expect(bodyHandedOver()).toBe(true);
  });
});

describe("the bar tells the waiting store when an answer lands", () => {
  it("sees an answer that lands behind the one on screen", () => {
    // The voice is reading, so the reducer's `speaking` arm appends to
    // `pending` and leaves `current` exactly where it was. Keyed on
    // `current?.id` this arrival is invisible — in the one situation a hold
    // exists for.
    const cell: Cell = { state: "speaking", queue: WITH_HISTORY };
    const speech = makeSpeech(cell);
    const { rerender } = render(barTree(speech));

    fireEvent.click(previousButton());
    const before = callCounts(speech);

    cell.queue = queueWith({ ...WITH_HISTORY, pending: [answer("u-2")] });
    rerender(barTree(speech));

    // The arrival released the hold, and the cue to put the cursor back on the
    // newest answer came with it.
    expect(speech.onNewestAnswer).toHaveBeenCalledTimes(1);
    expect(speech.onNewestAnswer).toHaveBeenCalledWith(SESSION);

    // ...and NOTHING else was touched. The snap is a body move: no transport
    // control was pressed, so the voice goes on reading what it was reading.
    expect(callCounts(speech)).toEqual({ ...before, onNewestAnswer: 1 });
  });

  it("does not snap when the arrival released no hold", () => {
    const cell: Cell = { state: "ready", queue: WITH_HISTORY };
    const speech = makeSpeech(cell);
    const { rerender } = render(barTree(speech));

    cell.queue = queueWith({ previous: [answer("u-1")], current: answer("u-2") });
    rerender(barTree(speech));

    // Nobody stepped back, so nothing is being held and there is no place to
    // put the cursor back to. A snap here would be a cursor move nobody asked
    // for, on every answer the panel ever receives.
    expect(speech.onNewestAnswer).not.toHaveBeenCalled();
  });

  it("keeps the hold across a render that brought no answer with it", () => {
    // The bar re-renders for reasons that have nothing to do with the queue —
    // the playhead, the synthesis cache, the row beside it. A push made on
    // every render must still be an ARRIVAL only when the newest answer
    // actually changed, or the first repaint after a step back would drop the
    // hold the user had just made.
    const cell: Cell = { state: "ready", queue: WITH_HISTORY };
    const speech = makeSpeech(cell);
    const { rerender } = render(barTree(speech));

    activity("busy", 2);
    fireEvent.click(previousButton());
    expect(bodyHandedOver()).toBe(false);

    rerender(barTree(speech));

    expect(bodyHandedOver()).toBe(false);
    expect(speech.onNewestAnswer).not.toHaveBeenCalled();
  });
});

describe("the transport holds the answer and lets it go", () => {
  it("holds on previous and releases on next", () => {
    const cell: Cell = {
      state: "ready",
      // A step behind the cursor for previous, and an answer waiting for next.
      queue: queueWith({ ...WITH_HISTORY, pending: [answer("u-2")] }),
    };
    render(barTree(makeSpeech(cell)));

    activity("busy", 2);
    expect(bodyHandedOver()).toBe(true);

    // Stepping back is the user saying *I want the text*, and it outranks the
    // agent's claim on the body for as long as it stands.
    fireEvent.click(previousButton());
    expect(bodyHandedOver()).toBe(false);

    // Stepping forward is the user done with it. The agent is still working,
    // so the body goes straight back to the wave.
    fireEvent.click(nextButton());
    expect(bodyHandedOver()).toBe(true);
  });
});
