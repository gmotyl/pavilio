/**
 * How the debounce WINDOW gets opened — the half `answerWaiting.debounce`
 * does not cover, because every test there opens the watch before anything
 * else touches the session.
 *
 * The real component tree does not do that. `TerminalView` calls
 * `watchSessionActivity` from its OWN effect, and `SpeechControlBar` — its
 * child, rendered from mount — calls `noteNewestAnswer` from a child effect.
 * React runs CHILD effects before PARENT effects, so by the time the watch
 * opens the entry ALREADY EXISTS. A watch that treated an existing entry as
 * "somebody else is already looking after this" therefore opened no window at
 * all for a cell mounting onto an agent that was already working.
 *
 * That is the whole of the parent commit's behaviour on the path that matters
 * most: the server broadcasts only on a TRANSITION into busy and sends a full
 * snapshot on connect, so a panel reloaded while an agent works sees the
 * snapshot, mounts the cell, and never sees another transition. No transition,
 * no window, no wave — for the entire run.
 *
 * The second half of this file is the other end of the same window: an answer
 * landing inside one. Cancelling it is right — the answer is the better
 * outcome and deserves an uninterrupted moment on screen — but a session that
 * is STILL busy afterwards is an agent that is genuinely still working, and
 * the server will not re-broadcast a state it never left. So the arrival opens
 * a FRESH window rather than spending the spell: the answer gets its moment,
 * and the wave comes back one window later.
 *
 * ## Why the effect-order test mounts a tree
 *
 * The ordering IS the defect. Asserting it by calling the two functions in the
 * order this file happens to believe React uses would only re-state the belief;
 * mounting a parent and a child and recording which effect ran first asserts
 * it.
 */
import { render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The activity channel dials a WebSocket at import time and re-arms a 2s
// reconnect timer whenever that socket closes. Under fake timers a real dial
// would fail, close, and leave that timer in the table — which is precisely
// what the timer assertions below would then be reading.
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
  getAnswerWaiting,
  noteNewestAnswer,
  watchSessionActivity,
} from "../answerWaiting";
import { _applyEventForTests, _resetForTests } from "../useTerminalActivityChannel";

const SESSION = "cell-a";

/** The window these tests are written against, pinned on the document — the
 *  number is a server-side knob, not something this suite may inherit. */
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

describe("the window a cell gets when it mounts onto a busy agent", () => {
  it("a cell mounting onto an already-busy session still gets a window", () => {
    // The snapshot the server sends on connect: this session was busy before
    // this tab existed, and no transition will follow.
    activity("busy");

    // The child effect gets there first and conjures the entry. Nothing about
    // that is a claim on the body — it is a queue push that happens on render.
    noteNewestAnswer(SESSION, "u-0");

    // ...and the parent's watch, arriving second, must still open the window.
    watchSessionActivity(SESSION);
    expect(handedOver()).toBe(false);

    vi.advanceTimersByTime(DEBOUNCE);
    expect(handedOver()).toBe(true);
  });

  it("the real effect order — bar before view — still opens a window", () => {
    activity("busy");

    const order: string[] = [];

    function Bar(): null {
      useEffect(() => {
        order.push("bar");
        noteNewestAnswer(SESSION, "u-0");
      }, []);
      return null;
    }

    function View(): React.ReactElement {
      useEffect(() => {
        order.push("view");
        watchSessionActivity(SESSION);
      }, []);
      return <Bar />;
    }

    render(<View />);

    // The premise, asserted rather than assumed: React runs the child's effect
    // first, so `noteNewestAnswer` really is what creates the entry.
    expect(order).toEqual(["bar", "view"]);

    expect(handedOver()).toBe(false);
    vi.advanceTimersByTime(DEBOUNCE);
    expect(handedOver()).toBe(true);
  });

  it("a send is not overtaken by a window", () => {
    activity("busy");

    // The user typed and pressed Enter — their own decision, and the entry is
    // conjured by that gesture. The body hands over on this frame.
    beginWaiting(SESSION, "u-0");
    expect(handedOver()).toBe(true);
    expect(getAnswerWaiting(SESSION).pending).toBe(true);

    // A watch opening behind the gesture must not schedule a window against
    // the send it would only be overtaking anyway.
    watchSessionActivity(SESSION);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(handedOver()).toBe(true);
    expect(getAnswerWaiting(SESSION).pending).toBe(true);
  });
});

describe("an answer landing inside the window", () => {
  it("an answer arriving mid-window returns the wave once the window passes", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, "u-0");

    activity("busy");
    vi.advanceTimersByTime(500);

    // The answer lands half a second in. It gets the body — an uninterrupted
    // moment on screen is the point of cancelling that window.
    noteNewestAnswer(SESSION, "u-1");
    expect(handedOver()).toBe(false);
    vi.advanceTimersByTime(DEBOUNCE - 1);
    expect(handedOver()).toBe(false);

    // ...but the agent never stopped, and the server will not say so again.
    // A fresh window was opened by the arrival, so the wave comes back one
    // window later rather than never.
    vi.advanceTimersByTime(1);
    expect(handedOver()).toBe(true);

    // And it stays: this is an agent that is genuinely working.
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(handedOver()).toBe(true);
  });

  it("an answer arriving mid-window leaves no wave if the agent then stops", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, "u-0");

    activity("busy");
    vi.advanceTimersByTime(500);
    noteNewestAnswer(SESSION, "u-1");

    // The busy spell really was the repaint it looked like.
    activity("idle");

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(handedOver()).toBe(false);
  });
});
