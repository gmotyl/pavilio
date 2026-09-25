/**
 * The guards nobody had written a witness for.
 *
 * Every test in this file was added because a reviewer PROBED the module
 * rather than read it: each of the three guards below could be deleted and the
 * whole terminal suite still went green, while the behaviour measurably moved.
 * A guard with no witness is a line the next person is entitled to delete.
 *
 * - `endStarting`'s `if (!entry.starting) return;` — remove it and an arrival
 *   on a cell that never pressed a launcher schedules a window on the press's
 *   account (0 timers becomes 1),
 * - `noteAgentStarting`'s `entry.deferred = false` — remove it and a press made
 *   while the voice is reading over a working agent loses the wave at the
 *   moment its own arrival lands,
 * - `watchSessionActivity`'s `!entry.starting` — which did not exist until this
 *   file was written, and is the durable half of the rule the other two serve:
 *   a user gesture is never overtaken by a window, INCLUDING across the
 *   remount a layout change makes.
 *
 * The fourth subject here is not a guard but a claim: `endSend`'s docstring
 * used to say that a transport press is never one of the things that ends a
 * send. That is true of `noteTransport` — the FUNCTION — and false of the
 * *Next answer* PRESS, which also moves the cursor, which reaches the store as
 * `noteUtterance` one effect later, which DOES end the send. It is live,
 * shipped behaviour and it is pinned below rather than changed.
 *
 * ## Why this is a store test
 *
 * The wait lives outside React, keyed by session, for the life of the tab. The
 * calls below are exactly the ones `SpeechControlBar` makes, in the order it
 * makes them — the button's `onClick` first, the cursor the press moved one
 * effect later — and mounting a tree to produce that order would put React's
 * scheduling between the clock and the assertion without asserting anything
 * more.
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
  getAnswerWaiting,
  isAnswerHeld,
  holdAnswer,
  noteAgentStarting,
  noteNewestAnswer,
  noteSpeaking,
  noteTransport,
  noteUtterance,
  releaseAnswer,
  watchSessionActivity,
} from "../answerWaiting";
import { _applyEventForTests, _resetForTests } from "../useTerminalActivityChannel";

const SESSION = "cell-a";

/** The window these tests are written against, pinned on the document rather
 *  than imported from the default: the number is a server-side knob, and a
 *  suite that read whatever the default happens to be would stop describing
 *  anything the day somebody tuned it. */
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

describe("a transport press that moves the cursor ends the send", () => {
  it("*Next answer* ends a pending send and gives the window back", () => {
    watchSessionActivity(SESSION);
    // The first push is SEEDING: an entry that has never been told where the
    // cell stands cannot tell an arrival from a starting point.
    noteNewestAnswer(SESSION, "u-1");

    // The agent is already working when the user types, so the send spends a
    // window that was weighing real work.
    activity("busy");
    beginWaiting(SESSION, "u-1");
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: true });
    expect(vi.getTimerCount()).toBe(0);

    // The bar's *Next answer* button, in the order it fires them: the click
    // handler first...
    noteTransport(SESSION);
    releaseAnswer(SESSION);
    // ...which alone only SHRINKS the wait to its mark. This is the half the
    // docstring's "a transport press is NOT one of them" is true of.
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: false, pending: true });

    // ...and then the cursor the press moved, which reaches the store from
    // `SpeechControlBar`'s own effect one commit later. *Next* is enabled only
    // when there IS something newer to step to, so this is the user stepping
    // onto an answer the cell did not have when they pressed Enter — which is
    // the event `endSend` exists for.
    noteUtterance(SESSION, "u-2");

    // So the mark goes, and it is right that it does: a newer answer is on the
    // body, which is what the mark was waiting to be able to say.
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: false, pending: false });
    // And the window the send spent is paid back, exactly as it is for any
    // other end of a send: the agent is still working and nothing will
    // re-announce a state it never left.
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(DEBOUNCE);
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: false });
  });

  it("*Previous answer* ends the send too, but the hold keeps the wave off", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, "u-1");
    activity("busy");
    beginWaiting(SESSION, "u-1");

    // The bar's *Previous answer* button: the same `noteTransport`, and a
    // `holdAnswer` beside it.
    noteTransport(SESSION);
    holdAnswer(SESSION);
    // Stepping BACK moves the cursor too — onto an older id, which is still
    // "not the one the draft was sent on" — so the same `endSend` runs.
    noteUtterance(SESSION, "u-0");
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: false, pending: false });

    // What the hold masks is not the mark but the WAVE: the window the send
    // gave back fires, the agent earns its claim, and `derive` still answers
    // with the text, because the hold outranks every claim on the body.
    vi.advanceTimersByTime(DEBOUNCE);
    expect(isAnswerHeld(SESSION)).toBe(true);
    expect(handedOver()).toBe(false);
  });
});

describe("an arrival never pays a debt a launcher press never took on", () => {
  it("an arrival on a cell that never pressed a pill schedules no window", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, "u-0");

    // A busy spell being weighed, and a send that spends it — the user's own
    // decision is a better answer to *is this real?* than any clock.
    activity("busy");
    expect(vi.getTimerCount()).toBe(1);
    beginWaiting(SESSION, "u-0");
    expect(vi.getTimerCount()).toBe(0);

    // The answer lands. There is no window to cancel, so `noteNewestAnswer`'s
    // own re-open declines — correctly, for its own debt.
    noteNewestAnswer(SESSION, "u-1");

    // ...and `endStarting`, which this arrival also runs, must decline too.
    // Nothing was ever pressed here, so no press is owed a window back; the
    // send's own debt is `endSend`'s to pay, from the site that knows a send
    // was outstanding. Without the `!entry.starting` guard this reads 1: a
    // cell that never touched a launcher gets a window on the press's account.
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("a launcher press drops the playback deferral for good", () => {
  it("the wave survives the arrival when the press was made mid-sentence", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, null);

    // The voice is reading when the agent goes to work, so the handover is
    // DEFERRED: taking the text away here pulls it out from under a sentence
    // the listener is halfway through hearing.
    noteSpeaking(SESSION, true);
    activity("busy");
    vi.advanceTimersByTime(DEBOUNCE);
    expect(handedOver()).toBe(false);

    // The user presses a launcher pill anyway. The deferral is politeness
    // towards a sentence an AGENT interrupted, and the user interrupting
    // themselves is not that — so it is dropped, not merely outranked.
    noteAgentStarting(SESSION);
    expect(handedOver()).toBe(true);

    // The answer the press was waiting for. It ends the STARTING wait — and
    // the agent is still busy and still armed, so the body passes straight to
    // the agent's own claim rather than back to the answer.
    //
    // This is where `noteAgentStarting`'s `entry.deferred = false` earns its
    // keep. Left standing, the deferral survives the press it had nothing to
    // do with and `derive` answers this arrival with SETTLED: the wave the
    // user's own press raised disappears the moment their agent speaks, for a
    // playback that started before either.
    noteNewestAnswer(SESSION, "u-1");
    expect(handedOver()).toBe(true);
  });
});

describe("a remount does not overtake a launcher press", () => {
  it("re-opening the watch on a starting cell schedules no window", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, null);

    // The press lands on a session that was ALREADY busy — a reattach repaint
    // is the ordinary way that happens — and spends the window that spell had
    // open.
    activity("busy");
    vi.advanceTimersByTime(1000);
    noteAgentStarting(SESSION);
    expect(vi.getTimerCount()).toBe(0);

    // A layout change: maximize, a preset, a drag, a seam resize. Every one of
    // them remounts `TerminalView`, whose effect re-opens the session's watch —
    // which is the whole reason this wait lives outside React.
    watchSessionActivity(SESSION);

    // `send` was never the only gesture worth protecting. A window opened here
    // fires a moment later, hands the agent a claim the press had already
    // cancelled, and the arrival that follows then ends the starting wait onto
    // that claim instead of onto the answer — so the cell's first reply loses
    // the uninterrupted moment the press bought it.
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(DEBOUNCE);
    expect(handedOver()).toBe(true);

    // The press's own debt is still paid where it always was — at the end of
    // the starting wait, by `endStarting`.
    noteNewestAnswer(SESSION, "u-1");
    expect(handedOver()).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(DEBOUNCE);
    expect(handedOver()).toBe(true);
  });
});
