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
 * The rest of this file is the other end of the same window: the TWO things
 * that cancel one, and what each of them owes afterwards.
 *
 * An answer landing inside a window cancels it, and that is right — the answer
 * is the better outcome and deserves an uninterrupted moment on screen. But a
 * session that is STILL busy afterwards is an agent that is genuinely still
 * working, and the server will not re-broadcast a state it never left. So the
 * arrival opens a FRESH window rather than spending the spell: the answer gets
 * its moment, and the wave comes back one window later.
 *
 * A SEND inside a window cancels it too, for its own reason — the user's
 * decision is a better answer to "is this real?" than any clock — and owes the
 * same thing at the same moment. The send's wait ends (the reply lands, or the
 * agent goes idle); if the agent is still busy at that point, the spell it
 * overtook was real work all along, nothing will re-announce it, and the wave
 * would otherwise be gone for the rest of the run. So the END of a send
 * re-opens a window exactly as an arrival does. "Type a reply while the agent
 * is working" is an ordinary path, which is the whole reason the symmetry
 * matters.
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
  holdAnswer,
  noteNewestAnswer,
  noteUtterance,
  releaseAnswer,
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

  it("a second watch on the same busy session does not stack a window", () => {
    // The real tree opens this watch from an effect, and effects re-run: a
    // remount from a layout change, a preset swap, a drag placement. Every one
    // of those calls `watchSessionActivity` again on a session that is still
    // busy and still unarmed, which is exactly the shape the "already busy"
    // branch answers — so without the guard inside `openDebounceWindow` each
    // call would schedule its own timer.
    //
    // `answerWaiting.debounce`'s own "repeated busy events do not stack timers"
    // does NOT reach this: repeated busy EVENTS are stopped one level earlier,
    // by `onActivity`'s transition check, and never get as far as the window.
    activity("busy");
    watchSessionActivity(SESSION);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(500);
    watchSessionActivity(SESSION);
    watchSessionActivity(SESSION);

    // One spell, one window.
    expect(vi.getTimerCount()).toBe(1);

    // ...and it is the FIRST call's window, running on the first call's clock
    // rather than pushed back by every remount. A stacked window would also
    // outlive this moment, so the empty table afterwards is the other half of
    // the same guard.
    vi.advanceTimersByTime(DEBOUNCE - 500);
    expect(handedOver()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
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

/**
 * The same hole as the arrival's, on the other path that cancels a window.
 *
 * The agent is already working, so a window is pending. The user types a reply
 * — ordinary, not exotic — and `beginWaiting` cancels that window, rightly: it
 * hands the body over on the frame of the keypress, and the clock it replaced
 * has nothing left to decide. Then the reply lands, the send's wait ends, and
 * the agent carries straight on working.
 *
 * Nothing re-broadcasts `busy`: the server emits on a TRANSITION, and the
 * session never left the state. So before the fix the cell sat busy with
 * `waiting === false` for the rest of the run — the wave gone, on a path the
 * user reaches by doing the most obvious thing there is.
 */
describe("a send inside the window", () => {
  it("a send inside the window returns the wave when the reply lands on a still-busy agent", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, "u-0");

    activity("busy");
    vi.advanceTimersByTime(500);

    // The user types into a cell whose agent is already working. The body is
    // theirs at once, and the window they overtook is spent.
    beginWaiting(SESSION, "u-0");
    expect(handedOver()).toBe(true);
    expect(getAnswerWaiting(SESSION).pending).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    // The reply lands. The send's wait is over — and the agent is STILL busy,
    // which is the fact the cancelled window was in the middle of weighing.
    noteUtterance(SESSION, "u-1");
    expect(getAnswerWaiting(SESSION).pending).toBe(false);
    expect(handedOver()).toBe(false);

    // So the end of the send re-opens a window, exactly as an arrival does:
    // the answer gets its uninterrupted moment on screen...
    vi.advanceTimersByTime(DEBOUNCE - 1);
    expect(handedOver()).toBe(false);

    // ...and one window later the working agent has the body back.
    vi.advanceTimersByTime(1);
    expect(handedOver()).toBe(true);
    // Nothing of the user's is outstanding any more, so the play button
    // carries no mark: this is the agent's own trigger, re-earned.
    expect(getAnswerWaiting(SESSION).pending).toBe(false);

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(handedOver()).toBe(true);
  });

  it("a send inside the window leaves no wave if the agent stops", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, "u-0");

    activity("busy");
    vi.advanceTimersByTime(500);
    beginWaiting(SESSION, "u-0");

    noteUtterance(SESSION, "u-1");

    // The agent answered and finished. The window the send's end opened must
    // die with the spell it was weighing — the re-open is "the agent is still
    // working", never "a send happened once".
    activity("idle");

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(handedOver()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a send on an idle agent opens no window when it ends", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, "u-0");

    // No busy spell at all: nothing was cancelled, so nothing is owed. The
    // re-open is a DEBT the send took on by overtaking the agent's trigger,
    // not a thing every send does on its way out.
    beginWaiting(SESSION, "u-0");
    expect(handedOver()).toBe(true);

    noteUtterance(SESSION, "u-1");
    expect(handedOver()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(handedOver()).toBe(false);
  });

  it("a hold still outranks the window the send's end re-opened", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, "u-0");

    activity("busy");
    beginWaiting(SESSION, "u-0");
    noteUtterance(SESSION, "u-1");

    // The user steps back to re-read while the re-opened window runs. The hold
    // is ONE term at the top of `derive`, ahead of both triggers, so the wave
    // the window is about to raise never reaches the body.
    holdAnswer(SESSION);
    vi.advanceTimersByTime(DEBOUNCE);
    expect(handedOver()).toBe(false);

    // And it is the hold doing it, not the window having been lost: releasing
    // hands the body straight to the agent that has been working all along.
    releaseAnswer(SESSION);
    expect(handedOver()).toBe(true);
  });
});
