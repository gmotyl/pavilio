/**
 * The guard on the pane's SECOND trigger: `busy` is not "the agent is working".
 *
 * Server-side, `recordOutput()` sets a session busy whenever its PTY emits
 * output, and lets it fall back to idle a second after the last byte. That is a
 * good proxy for "an agent is working" in the middle of a session and a bad one
 * at attach time, when a repaint is guaranteed: switching terminals or projects
 * reattaches the session and repaints the screen, which is output, so a switch
 * produces a 1-2s busy window with no agent work in it at all — and that window
 * was enough to cover an answer the user was still reading.
 *
 * So the agent's trigger waits out a window before it may take the body. This
 * file pins that window from both sides: a busy spell shorter than it never
 * reaches the body, and a busy spell longer than it hands over exactly as
 * before.
 *
 * ## What is deliberately NOT debounced
 *
 * A send is the user's own action, and delaying its feedback by three seconds
 * would make the panel feel broken. `beginWaiting` therefore hands over on the
 * frame it is called, and CANCELS any window that was pending — the user's
 * decision is the better answer to "is this real?" than any clock.
 *
 * ## Why this suite is a store test
 *
 * The wait lives outside React, keyed by session, for the life of the tab; the
 * rendered half is `AnswerPane.waiting.test.tsx`'s. Reaching for a tree here
 * would only re-test it, and would put React's own scheduling between the clock
 * and the assertion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The activity channel dials a WebSocket at import time and re-arms a 2s
// reconnect timer whenever that socket closes. Under fake timers a real dial
// would fail, close, and leave that timer in the table — which is precisely
// what the timer assertions below would then be reading. A socket that never
// closes keeps the table to this module's own timers.
vi.hoisted(() => {
  class QuietSocket {
    static OPEN = 1;
    readyState = 0;
    onopen: unknown = null;
    onmessage: unknown = null;
    onclose: unknown = null;
    onerror: unknown = null;
    close(): void {}
    send(): void {}
  }
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = QuietSocket;
});

import {
  __resetAnswerWaitingForTests,
  beginWaiting,
  forgetAnswerWaiting,
  getAnswerWaiting,
  noteNewestAnswer,
  noteSpeaking,
  watchSessionActivity,
} from "../answerWaiting";
import { _applyEventForTests, _resetForTests } from "../useTerminalActivityChannel";

const SESSION = "cell-a";

/**
 * The window these tests are written against, pinned on the document rather
 * than imported from the default: the number is a server-side knob, and a suite
 * that read whatever the default happens to be would stop describing anything
 * the day somebody tuned it.
 */
const DEBOUNCE = 3000;

/** The body's handover, as the pane reads it. */
const handedOver = (sessionId = SESSION): boolean => getAnswerWaiting(sessionId).waiting;

/** An activity broadcast for the cell, as the server sends it. */
let at = 0;
const activity = (state: "idle" | "busy" | "attention", sessionId = SESSION): void => {
  at += 1;
  _applyEventForTests({ sessionId, state, at });
};

beforeEach(() => {
  at = 0;
  _resetForTests();
  __resetAnswerWaitingForTests();
  vi.useFakeTimers();
  (globalThis as { __PAVILIO_TUNING__?: unknown }).__PAVILIO_TUNING__ = {
    answerWaveDebounceMs: DEBOUNCE,
  };
});

afterEach(() => {
  _resetForTests();
  __resetAnswerWaitingForTests();
  vi.useRealTimers();
  delete (globalThis as { __PAVILIO_TUNING__?: unknown }).__PAVILIO_TUNING__;
});

describe("the debounce on the agent's claim to the body", () => {
  it("a busy window shorter than the debounce never reaches the body", () => {
    watchSessionActivity(SESSION);

    activity("busy");
    // The transition alone proves nothing: output happened, which is all the
    // server ever said.
    expect(handedOver()).toBe(false);

    vi.advanceTimersByTime(DEBOUNCE - 1);
    expect(handedOver()).toBe(false);

    activity("idle");

    // ...and the window that was still pending is gone with it: an idle
    // session has nothing left to prove, so no later tick may hand the body to
    // an agent that has already stopped.
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(handedOver()).toBe(false);
  });

  it("a busy window longer than the debounce hands the body over", () => {
    watchSessionActivity(SESSION);

    activity("busy");
    vi.advanceTimersByTime(DEBOUNCE);

    // Output that has persisted past the window is work, not a repaint, and
    // the body says so — exactly as it did before the debounce existed.
    expect(handedOver()).toBe(true);
    // Nothing was SENT, so no reply is outstanding and the play button carries
    // no mark: the debounce changes when the agent's trigger fires, not what
    // it means.
    expect(getAnswerWaiting(SESSION).pending).toBe(false);
  });

  it("a reattach repaint of 1.2s leaves the answer on screen", () => {
    watchSessionActivity(SESSION);

    // The case the whole guard exists for, in the shape the server produces
    // it: the user switches to this terminal, the session reattaches, the
    // screen repaints, and `recordOutput()` calls that busy for as long as the
    // bytes keep coming plus its own idle second.
    activity("busy");
    vi.advanceTimersByTime(1200);
    // Still mid-window, and the answer is still on screen: this is the frame
    // the old behaviour covered it on.
    expect(handedOver()).toBe(false);

    activity("idle");
    expect(handedOver()).toBe(false);

    // The answer they were reading is still theirs a full ten minutes later:
    // nothing is left armed to take it away.
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(handedOver()).toBe(false);
  });

  it("an arriving utterance cancels a pending debounce", () => {
    watchSessionActivity(SESSION);
    // The first push is seeding, not an arrival — the store cannot tell where a
    // cell stands from a fact it has never been told.
    noteNewestAnswer(SESSION, "u-0");

    activity("busy");
    vi.advanceTimersByTime(1000);

    // The answer landed inside the window. It is the better outcome than a
    // wave — one raised now would cover the very thing it announces — so the
    // window that was about to raise one is cancelled and the answer gets the
    // screen to itself.
    noteNewestAnswer(SESSION, "u-1");

    // The cancellation, pinned on the clock: the window this spell opened
    // would have fired on this tick, and nothing does.
    vi.advanceTimersByTime(DEBOUNCE - 1000);
    expect(handedOver()).toBe(false);

    // What happens after that moment depends on whether the agent is still
    // working, and belongs to `answerWaiting.mount` ("an answer landing inside
    // the window"): a still-busy session gets a FRESH window, because an agent
    // that answered and carried on is still working and the server will not
    // say so twice. Here it stops, so the answer keeps the body for good.
    activity("idle");
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(handedOver()).toBe(false);
  });

  it("a send during the debounce hands over immediately", () => {
    watchSessionActivity(SESSION);

    activity("busy");
    vi.advanceTimersByTime(1000);
    expect(handedOver()).toBe(false);

    // The user's own action, on the frame they took it. Debouncing this would
    // be three seconds of a panel that looks broken.
    beginWaiting(SESSION, "u-1");
    expect(handedOver()).toBe(true);
    expect(getAnswerWaiting(SESSION).pending).toBe(true);

    // ...and the window it overtook is cancelled rather than left to fire
    // behind it: the send is a better answer to "is this real?" than the clock
    // it replaced.
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(handedOver()).toBe(true);
  });

  it("destroying the session clears the pending timer", () => {
    watchSessionActivity(SESSION);

    activity("busy");
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(1);

    // `destroyTerminal` calls exactly this (see `answerWaiting.activity`'s own
    // destroy criterion, which goes through the real one).
    forgetAnswerWaiting(SESSION);

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(handedOver()).toBe(false);
  });

  it("repeated busy events do not stack timers", () => {
    watchSessionActivity(SESSION);
    const timeout = vi.spyOn(globalThis, "setTimeout");

    activity("busy");
    vi.advanceTimersByTime(500);
    // A server re-broadcast of the state a session is already in is a reading,
    // not a transition — and even if it reached this far, a window already
    // running is the window this busy spell gets.
    activity("busy");
    activity("busy");

    expect(timeout.mock.calls.filter(([, delay]) => delay === DEBOUNCE)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);

    // And the one window that IS running is the one the FIRST event started,
    // so it elapses on that event's clock rather than being pushed back by
    // every byte the agent writes.
    vi.advanceTimersByTime(DEBOUNCE - 500);
    expect(handedOver()).toBe(true);
  });

  it("the playback deferral still applies after the debounce elapses", () => {
    watchSessionActivity(SESSION);
    noteSpeaking(SESSION, true);

    activity("busy");
    vi.advanceTimersByTime(DEBOUNCE);

    // Two independent questions, asked in order: the debounce asked whether
    // the busy was real and got a yes, and the deferral now asks whether this
    // is a rude moment and gets one too. Taking the text here would pull it
    // out from under a sentence the user is halfway through hearing.
    expect(handedOver()).toBe(false);

    noteSpeaking(SESSION, false);

    // The sentence finished and the agent is still working.
    expect(handedOver()).toBe(true);
  });
});
