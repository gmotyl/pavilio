/**
 * The pane's THIRD trigger: the user pressing a launcher pill.
 *
 * The other two both assume a cell that has already spoken. A cell that never
 * has cannot show that its agent is working at all — the pane starts closed and
 * the bar shows launcher pills where the eye would be, so there is no control
 * that opens it and no body to hand over. Pressing a pill is the user asking
 * the agent to start, and that press is the way in.
 *
 * ## Why it is not `beginWaiting`
 *
 * It is a send in every respect but one: nothing was ASKED. `pending` means
 * *the reply to the draft you sent has not landed yet*, and a `start` press is
 * not a question — so the snapshot is `AGENT_HAS_THE_BODY`
 * (`{waiting: true, pending: false}`) rather than `BODY_HANDED_OVER`, and the
 * play button carries no mark for a reply nobody is owed.
 *
 * Everything else it DOES inherit from `beginWaiting`, because both are the
 * same kind of event — a user gesture:
 *
 * - it hands the body over on the frame it is called, with no debounce. The
 *   window guards the AGENT's trigger, where `busy` may be a reattach repaint;
 *   a press is not a reading that might be noise, it is a decision,
 * - it CANCELS a window that was pending, for the same reason: the user's own
 *   decision is a better answer to *is this real?* than any clock,
 * - it releases a standing hold. The hold is the user saying *I want the text*;
 *   asking the agent to start is that same user moving on.
 *
 * ## Why this suite is a store test
 *
 * The wait lives outside React, keyed by session, for the life of the tab — the
 * pane is remounted by every layout change. The rendered half belongs to
 * `AnswerPane.waiting.test.tsx`; reaching for a tree here would only re-test it
 * and would put React's scheduling between the clock and the assertion.
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

/**
 * Every unsubscribe the store hands back, recorded as it is CALLED.
 *
 * "Nothing is left subscribed" is an absence claim, and asserting it on the
 * snapshot alone passes over an empty room: `onActivity` looks its entry up and
 * returns when there is none, so a destroy that forgot to unsubscribe behaves
 * exactly like one that did — right up until the session id is reused. So the
 * channel is wrapped rather than watched from the outside, and the release is
 * observed directly.
 */
const { unsubscribed } = vi.hoisted(() => ({ unsubscribed: [] as string[] }));

vi.mock("../useTerminalActivityChannel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../useTerminalActivityChannel")>();
  return {
    ...actual,
    subscribeActivity: (sessionId: string, fn: (state: "idle" | "busy" | "attention") => void) => {
      const off = actual.subscribeActivity(sessionId, fn);
      return () => {
        unsubscribed.push(sessionId);
        off();
      };
    },
  };
});

import {
  __resetAnswerWaitingForTests,
  forgetAnswerWaiting,
  getAnswerWaiting,
  holdAnswer,
  isAnswerHeld,
  noteAgentStarting,
  noteNewestAnswer,
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
  unsubscribed.length = 0;
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

describe("a launcher press begins a wait", () => {
  it("starting the agent hands the body over with no pending mark", () => {
    watchSessionActivity(SESSION);

    noteAgentStarting(SESSION);

    // The body is the wave's, exactly as it is for an agent that went busy on
    // its own account...
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: false });
  });

  it("the handover is synchronous, not debounced", () => {
    watchSessionActivity(SESSION);

    noteAgentStarting(SESSION);

    // ...on the frame the user pressed it. The debounce asks whether a busy
    // spell was REAL, and a press is not a reading that might be noise.
    expect(handedOver()).toBe(true);
    // Pinned on the timer table as well as on the body: an implementation that
    // opened a window and happened to publish early would pass the line above
    // and still be a press the clock gets a say in.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an arriving utterance ends an agent-starting wait", () => {
    watchSessionActivity(SESSION);
    // The first push is SEEDING, not an arrival — the store cannot read where a
    // cell stands from a fact it has never been told. A cell that has never
    // spoken seeds with `null`, which is exactly the cell a launcher press is
    // pressed on.
    noteNewestAnswer(SESSION, null);

    noteAgentStarting(SESSION);
    expect(handedOver()).toBe(true);

    // The answer the press was waiting for. The wave stood in for a body that
    // had nothing in it; now it has.
    noteNewestAnswer(SESSION, "u-1");

    expect(handedOver()).toBe(false);
  });

  it("an agent that goes idle without speaking ends the wait", () => {
    watchSessionActivity(SESSION);

    noteAgentStarting(SESSION);
    // The launched agent writes to the PTY, which is what puts the session
    // busy. The wave is already up, so the window this opens decides nothing
    // the press has not already decided.
    activity("busy");
    vi.advanceTimersByTime(DEBOUNCE);
    expect(handedOver()).toBe(true);

    // The exit that makes the whole feature shippable: an agent that finished
    // without ever speaking. Nothing arrives, and the wait still ends.
    activity("idle");

    expect(handedOver()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("destroying the session ends the wait and leaves nothing subscribed", () => {
    watchSessionActivity(SESSION);
    noteAgentStarting(SESSION);
    expect(handedOver()).toBe(true);

    // `destroyTerminal` calls exactly this.
    forgetAnswerWaiting(SESSION);

    expect(handedOver()).toBe(false);
    expect(unsubscribed).toEqual([SESSION]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starting the agent releases a standing hold", () => {
    watchSessionActivity(SESSION);
    activity("busy");
    vi.advanceTimersByTime(DEBOUNCE);

    // The user stepped back for the text, which outranks every claim on the
    // body.
    holdAnswer(SESSION);
    expect(handedOver()).toBe(false);

    noteAgentStarting(SESSION);

    // ...until the same user asks the agent to start, which is them moving on
    // — the same release `beginWaiting` makes, for the same reason. Without it
    // `derive` would answer the press with the old answer on the body and no
    // wave at all.
    expect(isAnswerHeld(SESSION)).toBe(false);
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: false });
  });

  it("starting the agent is not overtaken by a pending window", () => {
    watchSessionActivity(SESSION);

    // A busy spell already being weighed — a reattach repaint on the cell the
    // user is about to press into is the ordinary way this happens.
    activity("busy");
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(1);

    noteAgentStarting(SESSION);

    // A user gesture is never overtaken by a window: the press answers the
    // question the window was asking, so the window goes rather than being
    // left to fire behind a decision already made.
    expect(handedOver()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a still-busy agent gets a window back when the starting wait ends", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, null);

    // The press lands on a session that was ALREADY busy, so its own output
    // continues that spell rather than starting a new one — no transition, and
    // therefore no window of its own. The only window this run will ever see
    // is the one the press cancelled.
    activity("busy");
    vi.advanceTimersByTime(1000);
    noteAgentStarting(SESSION);
    expect(vi.getTimerCount()).toBe(0);

    // The answer lands and the starting wait is over — but the agent is still
    // working, and the server will not re-broadcast a state it never left.
    noteNewestAnswer(SESSION, "u-1");
    expect(handedOver()).toBe(false);

    // So the press owes the window back: the answer gets its uninterrupted
    // moment, and the working agent re-earns the body one window later.
    vi.advanceTimersByTime(DEBOUNCE);
    expect(handedOver()).toBe(true);
    expect(getAnswerWaiting(SESSION).pending).toBe(false);
  });
});
