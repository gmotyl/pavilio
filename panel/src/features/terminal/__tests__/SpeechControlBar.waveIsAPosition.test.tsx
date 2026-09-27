/**
 * The wave as a POSITION in the cell's walk, rather than a lid over it.
 *
 * The bug this file exists for is the refresh: the agent is busy, the tab
 * reloads, and the cell comes back with the server's one retained utterance as
 * `current`, an empty history and an empty backlog. The wave owns the body, the
 * play button carries "1 unread", and both arrows are dead — because both ends
 * were derived from the utterance LIST alone:
 *
 *     hasPrevious = cursor < previous.length   // 0 < 0
 *     hasNext     = cursor > 0 || pending.length > 0
 *
 * So the one answer the cell has sits under the cursor, under the wave, with no
 * control on the row that reaches it. The hold — `adr/0016`'s single carve-out,
 * the documented way to get the text back while the agent works — is taken by
 * exactly the press the rail refuses.
 *
 * The fix is to say what the user already assumes: the wave is the step ABOVE
 * `current`. Backward from it lands on the newest answer; forward from the
 * newest answer with a hold standing lands back on it. Neither step moves the
 * cursor, because the wave is not an utterance — it is a position the BODY is
 * in, and `held` is what names it.
 *
 * Asserted through the real waiting store, like its sibling
 * `SpeechControlBar.answerWaiting.test.tsx`: the criterion is what the user can
 * press and what the body then shows, and a spy on the store would pass on a
 * push made with the wrong session or at the wrong moment.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CellSpeechState, GridSpeech, SpeechUnit, Utterance } from "../../speech/types";
import { emptyUtteranceQueue, type UtteranceQueue } from "../../speech/utteranceQueue";
import { SpeechControlBar } from "../SpeechControlBar";
import {
  __resetAnswerWaitingForTests,
  getAnswerWaiting,
  watchSessionActivity,
} from "../answerWaiting";
import { _applyEventForTests, _resetForTests } from "../useTerminalActivityChannel";

// Same two stubs the sibling file installs, and for the same reasons: the
// activity channel dials a socket at import time, and the scrubber peeks into
// the synthesis cache.
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

vi.mock("../../speech/synth", () => ({
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

const SESSION = "cell-a";

const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();

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

/**
 * THE REFRESH: one answer, no history, nothing waiting. This is what the server
 * hands a reloaded tab back — `utteranceQueue.ts` says so in its header — and
 * it is the shape in which both of the old derivations answer "no".
 */
const AFTER_A_REFRESH = queueWith({ current: answer("u-1") });

/** The same cell with somewhere to walk back to. */
const WITH_HISTORY = queueWith({ previous: [answer("u-0")], current: answer("u-1") });

interface Cell {
  state: CellSpeechState;
  queue: UtteranceQueue;
}

function makeSpeech(cell: Cell): GridSpeech {
  return {
    stateFor: () => cell.state,
    queueFor: () => cell.queue,
    heardFor: () => NOTHING_HEARD,
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

const send = vi.fn((_data: string) => true);

const barTree = (speech: GridSpeech) => (
  <SpeechControlBar
    sessionId={SESSION}
    speech={speech}
    answerOpen={false}
    onToggleAnswer={() => {}}
    send={send}
  />
);

const DEBOUNCE = 3000;

const activity = (state: "idle" | "busy" | "attention", at: number): void => {
  act(() => {
    _applyEventForTests({ sessionId: SESSION, state, at });
  });
  if (state === "busy") {
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE);
    });
  }
};

/** Whether the pane's BODY has handed over — i.e. whether the wave is the position. */
const bodyHandedOver = (): boolean => getAnswerWaiting(SESSION).waiting;

const previousButton = (): HTMLButtonElement =>
  screen.getByTestId(`speech-bar-previous-${SESSION}`) as HTMLButtonElement;
const nextButton = (): HTMLButtonElement =>
  screen.getByTestId(`speech-bar-next-${SESSION}`) as HTMLButtonElement;

beforeEach(() => {
  send.mockClear();
  _resetForTests();
  __resetAnswerWaitingForTests();
  vi.useFakeTimers();
  (globalThis as { __PAVILIO_TUNING__?: unknown }).__PAVILIO_TUNING__ = {
    answerWaveDebounceMs: DEBOUNCE,
  };
  watchSessionActivity(SESSION);
});

afterEach(() => {
  _resetForTests();
  __resetAnswerWaitingForTests();
  vi.useRealTimers();
  delete (globalThis as { __PAVILIO_TUNING__?: unknown }).__PAVILIO_TUNING__;
});

describe("the wave is a step the transport can stand on", () => {
  it("leaves backward live on the one answer a reloaded tab has", () => {
    render(barTree(makeSpeech({ state: "ready", queue: AFTER_A_REFRESH })));

    // Before the wave there is genuinely nowhere to go: no history, and the
    // cursor is already on the only answer.
    expect(previousButton()).toBeDisabled();

    activity("busy", 2);
    expect(bodyHandedOver()).toBe(true);

    // ...and now there is. The answer is the step BEHIND the wave, which is the
    // whole claim this change makes.
    expect(previousButton()).not.toBeDisabled();
  });

  it("adds no step when the wave does not own the body", () => {
    render(barTree(makeSpeech({ state: "ready", queue: AFTER_A_REFRESH })));

    // An idle session: the body is already the answer, so there is nothing to
    // step back FROM. The new arm is the wave's, not a blanket enable — without
    // this the rail would offer a press that does nothing on every idle cell
    // holding exactly one answer.
    expect(previousButton()).toBeDisabled();
    expect(nextButton()).toBeDisabled();
  });

  it("leaves forward live while a hold stands with nothing waiting", () => {
    render(barTree(makeSpeech({ state: "ready", queue: AFTER_A_REFRESH })));

    activity("busy", 2);
    fireEvent.click(previousButton());

    // The mirror of the first case. The cursor has not moved and the backlog is
    // empty, so both of the old arms of `hasNext` are false — the live one is
    // the wave, which is where a forward press now goes.
    expect(bodyHandedOver()).toBe(false);
    expect(nextButton()).not.toBeDisabled();
  });

  it("keeps both ends dead on a cell that has never spoken", () => {
    render(barTree(makeSpeech({ state: "empty", queue: emptyUtteranceQueue })));

    activity("busy", 2);
    expect(bodyHandedOver()).toBe(true);

    // The wave is a position ABOVE an answer. With no answer under the cursor
    // there is nothing for it to sit on top of, and the row's own rule — the
    // transport is disabled until the first answer — is untouched.
    expect(previousButton()).toBeDisabled();
    expect(nextButton()).toBeDisabled();
  });

  it("still asks the list once the cursor is below the wave", () => {
    render(barTree(makeSpeech({ state: "ready", queue: WITH_HISTORY })));

    // No wave, but a step of real history: the old derivation, unchanged.
    expect(previousButton()).not.toBeDisabled();
    expect(nextButton()).toBeDisabled();
  });
});

describe("stepping on and off the wave moves no cursor", () => {
  it("lands the first press back on the newest answer, not the one behind it", () => {
    const speech = makeSpeech({ state: "ready", queue: WITH_HISTORY });
    render(barTree(speech));

    activity("busy", 2);
    fireEvent.click(previousButton());

    // The hold is taken — the body is the answer now — and the CURSOR HAS NOT
    // MOVED. Without the early return the press would hold and step in one go,
    // so the newest answer, the one the unread count is about, is the single
    // answer the backward walk never lands on. Invisible whenever the cell
    // happens to have history, which is why this cell has some.
    expect(bodyHandedOver()).toBe(false);
    expect(speech.onPrevious).not.toHaveBeenCalled();
  });

  it("walks into history on the second press", () => {
    const speech = makeSpeech({ state: "ready", queue: WITH_HISTORY });
    render(barTree(speech));

    activity("busy", 2);
    fireEvent.click(previousButton());
    fireEvent.click(previousButton());

    // Below the wave a backward press is an ordinary backward press.
    expect(speech.onPrevious).toHaveBeenCalledTimes(1);
    expect(speech.onPrevious).toHaveBeenCalledWith(SESSION);
  });

  it("steps forward onto the wave without moving the cursor", () => {
    const speech = makeSpeech({ state: "ready", queue: AFTER_A_REFRESH });
    render(barTree(speech));

    activity("busy", 2);
    fireEvent.click(previousButton());
    expect(bodyHandedOver()).toBe(false);

    fireEvent.click(nextButton());

    // The mirror of the first case: the hold is spent on the step that arrives
    // at the wave, and nothing is asked of the queue.
    expect(bodyHandedOver()).toBe(true);
    expect(speech.onNext).not.toHaveBeenCalled();
  });

  it("keeps the hold while forward is still walking the history", () => {
    const speech = makeSpeech({
      state: "ready",
      queue: queueWith({
        previous: [answer("u-1"), answer("u-0")],
        current: answer("u-2"),
        cursor: 2,
      }),
    });
    render(barTree(speech));

    activity("busy", 2);
    fireEvent.click(previousButton());
    expect(bodyHandedOver()).toBe(false);

    fireEvent.click(nextButton());

    // Forward used to release on EVERY press, so a walk that started two
    // answers deep snapped the body back to the wave on the first step while
    // the cursor was still in the history — the pane showing one thing and the
    // transport pointing at another. The hold stands for exactly as long as the
    // cursor is below the wave.
    expect(speech.onNext).toHaveBeenCalledWith(SESSION);
    expect(bodyHandedOver()).toBe(false);
  });
});
