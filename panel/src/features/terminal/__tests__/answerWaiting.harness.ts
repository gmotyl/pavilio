/**
 * Shared setup for the answer-waiting store tests: the cell they drive, the
 * activity broadcast the server would send it, and the clock every one of
 * them runs on.
 *
 * Holds no `describe`/`it`. The `QuietSocket` stays in each test file's own
 * `vi.hoisted`: it has to be installed before the activity channel is
 * imported, and this module imports it.
 */
import { afterEach, beforeEach, vi } from "vitest";
import {
  __resetAnswerWaitingForTests,
  getAnswerWaiting,
  type AnswerWaitingSnapshot,
} from "../answerWaiting";
import { _applyEventForTests, _resetForTests } from "../useTerminalActivityChannel";

export const SESSION = "cell-a";

/**
 * The window these tests are written against, pinned on the document rather
 * than imported from the default: the number is a server-side knob, and a suite
 * that read whatever the default happens to be would stop describing anything
 * the day somebody tuned it.
 */
export const DEBOUNCE = 3000;

/** The session's waiting snapshot, as the pane reads it. */
export const session = (sessionId = SESSION): AnswerWaitingSnapshot =>
  getAnswerWaiting(sessionId);

/** The body's handover, as the pane reads it. */
export const handedOver = (sessionId = SESSION): boolean => session(sessionId).waiting;

type ActivityState = "idle" | "busy" | "attention";

let at = 0;

/**
 * An activity broadcast for the cell, as the server sends it. With `settle`, a
 * busy broadcast also elapses the debounce window it opens — for suites whose
 * criteria are about an ESTABLISHED busy spell.
 */
export function activity(
  state: ActivityState,
  sessionId = SESSION,
  { settle = false }: { settle?: boolean } = {},
): void {
  at += 1;
  _applyEventForTests({ sessionId, state, at });
  if (settle && state === "busy") vi.advanceTimersByTime(DEBOUNCE);
}

/** `activity` with the debounce window already elapsed for a busy broadcast. */
export const settledActivity = (state: ActivityState, sessionId = SESSION): void =>
  activity(state, sessionId, { settle: true });

/** Both stores back to empty, and the broadcast counter with them. */
export function reset(): void {
  at = 0;
  _resetForTests();
  __resetAnswerWaitingForTests();
}

/**
 * Per test: a reset store, fake timers, and the debounce window pinned on the
 * boot document; undone afterwards.
 */
export function useWaitingClock(): void {
  beforeEach(() => {
    reset();
    vi.useFakeTimers();
    (globalThis as { __PAVILIO_TUNING__?: unknown }).__PAVILIO_TUNING__ = {
      answerWaveDebounceMs: DEBOUNCE,
    };
  });
  afterEach(() => {
    reset();
    vi.useRealTimers();
    delete (globalThis as { __PAVILIO_TUNING__?: unknown }).__PAVILIO_TUNING__;
  });
}
