/**
 * An arriving answer IS the agent stopping (ADR 0018).
 *
 * The Stop hook posts an utterance when the agent finishes its turn, so an
 * answer landing for the cell is the most authoritative "the agent stopped"
 * this module is ever told — better than `attention`, which is ambiguous, and
 * earlier than `idle`, which a finished agent sitting at `attention` never
 * reaches on its own. So an arrival ends the busy spell outright: the wave
 * goes, the quiet window goes, a pending debounce goes and is NOT re-opened,
 * a hold is released, and a launcher's starting wait is over.
 *
 * What it does NOT end is a SEND. A send is the user's own wait, and its way
 * out is `noteUtterance` comparing against the id the draft was sent on.
 *
 * The rest of the busy spell is left where it is: `activity` stays `busy`, so
 * the wave can only come back on a FRESH spell — the session leaving `busy`
 * and entering it again — never on output that merely continues this one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The activity channel dials a WebSocket at import time and re-arms a 2s
// reconnect timer whenever that socket closes. A socket that never closes
// keeps the timer table to this module's own timers.
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
  isAnswerHeld,
  noteAgentStarting,
  noteNewestAnswer,
  noteUtterance,
  watchSessionActivity,
} from "../answerWaiting";
import { _applyEventForTests, _resetForTests } from "../useTerminalActivityChannel";

const SESSION = "cell-a";

/** Pinned rather than imported from the default — see `answerWaiting.debounce`. */
const DEBOUNCE = 3000;

const SETTLED = { waiting: false, pending: false };
const AGENT_HAS_THE_BODY = { waiting: true, pending: false };
const BODY_HANDED_OVER = { waiting: true, pending: true };

const snapshot = () => getAnswerWaiting(SESSION);

/** An activity broadcast for the cell, as the server sends it. */
let at = 0;
const activity = (state: "idle" | "busy" | "attention"): void => {
  at += 1;
  _applyEventForTests({ sessionId: SESSION, state, at });
};

/** A cell whose agent has been working long enough to own the body. */
const waveUp = (): void => {
  watchSessionActivity(SESSION);
  noteNewestAnswer(SESSION, "u-0");
  activity("busy");
  vi.advanceTimersByTime(DEBOUNCE);
  expect(snapshot()).toEqual(AGENT_HAS_THE_BODY);
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

describe("an arriving answer ends the wave", () => {
  it("an arriving answer ends a wave that holds the body", () => {
    waveUp();

    // The session is still busy — the Stop hook fires before the PTY has
    // finished repainting — and the answer still gets the body at once.
    expect(noteNewestAnswer(SESSION, "u-1")).toBe(false);
    expect(snapshot()).toEqual(SETTLED);
  });

  it("an arriving answer during the quiet window ends it", () => {
    waveUp();
    activity("attention");
    // The quiet window is pending: the wave stays until it elapses.
    expect(snapshot()).toEqual(AGENT_HAS_THE_BODY);

    noteNewestAnswer(SESSION, "u-1");
    expect(snapshot()).toEqual(SETTLED);
    // Cancelled outright, not merely left to fire into a settled entry.
    expect(vi.getTimerCount()).toBe(0);

    // The window had nothing left to decide, so its elapsing changes nothing.
    vi.advanceTimersByTime(DEBOUNCE);
    expect(snapshot()).toEqual(SETTLED);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an answer during the debounce keeps the wave away while the spell stays busy", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, "u-0");
    activity("busy");
    vi.advanceTimersByTime(1000);

    noteNewestAnswer(SESSION, "u-1");

    // The spell stays busy well past the window that was pending, and no
    // fresh window is opened in its place.
    vi.advanceTimersByTime(10 * DEBOUNCE);
    expect(snapshot()).toEqual(SETTLED);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("output continuing after the arrival does not bring the wave back", () => {
    waveUp();
    noteNewestAnswer(SESSION, "u-1");
    expect(snapshot()).toEqual(SETTLED);

    // The PTY keeps emitting: the server re-broadcasts the state it is already
    // in, which is no transition at all.
    for (let i = 0; i < 5; i += 1) {
      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE);
      expect(snapshot()).toEqual(SETTLED);
    }
  });

  it("a fresh busy spell after the arrival brings the wave back", () => {
    waveUp();
    noteNewestAnswer(SESSION, "u-1");
    expect(snapshot()).toEqual(SETTLED);

    activity("idle");
    activity("busy");
    // Debounced as ever: the transition alone proves nothing.
    vi.advanceTimersByTime(DEBOUNCE - 1);
    expect(snapshot()).toEqual(SETTLED);

    vi.advanceTimersByTime(1);
    expect(snapshot()).toEqual(AGENT_HAS_THE_BODY);
  });

  it("an arriving answer releases a hold and settles the body while busy", () => {
    waveUp();
    holdAnswer(SESSION);
    expect(isAnswerHeld(SESSION)).toBe(true);

    // `true` is still the surface's cue to put its cursor on the newest answer.
    expect(noteNewestAnswer(SESSION, "u-1")).toBe(true);
    expect(isAnswerHeld(SESSION)).toBe(false);
    // Released AND settled — not handed back to the agent's claim.
    expect(snapshot()).toEqual(SETTLED);
  });

  it("a sent draft's wave is not ended by the arrival alone", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, "u-0");
    beginWaiting(SESSION, "u-0");
    expect(snapshot()).toEqual(BODY_HANDED_OVER);

    noteNewestAnswer(SESSION, "u-1");
    expect(snapshot()).toEqual(BODY_HANDED_OVER);

    // The send's own way out.
    noteUtterance(SESSION, "u-1");
    expect(snapshot()).toEqual(SETTLED);
  });

  it("a send ending after the arrival does not bring the wave back", () => {
    // The cursor lags the newest answer: the user sent while the voice was
    // still reading, so the reply is appended to the queue (the arrival) and
    // the cursor reaches it only later, when playback gets there (the end of
    // the send). The PTY is still busy throughout.
    waveUp();
    beginWaiting(SESSION, "u-0");
    expect(snapshot()).toEqual(BODY_HANDED_OVER);

    noteNewestAnswer(SESSION, "u-1");
    noteUtterance(SESSION, "u-1");
    expect(snapshot()).toEqual(SETTLED);

    // The end of the send owes no window back: the arrival already ended the
    // spell that window would have weighed.
    vi.advanceTimersByTime(DEBOUNCE);
    expect(snapshot()).toEqual(SETTLED);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a fresh busy spell after a send that ended past the arrival still brings the wave back", () => {
    waveUp();
    beginWaiting(SESSION, "u-0");
    noteNewestAnswer(SESSION, "u-1");
    noteUtterance(SESSION, "u-1");
    vi.advanceTimersByTime(DEBOUNCE);
    expect(snapshot()).toEqual(SETTLED);

    activity("idle");
    activity("busy");
    vi.advanceTimersByTime(DEBOUNCE);
    expect(snapshot()).toEqual(AGENT_HAS_THE_BODY);
  });

  it("a remount after the arrival does not bring the wave back", () => {
    waveUp();
    noteNewestAnswer(SESSION, "u-1");

    // A layout change re-opens the watch on a session still busy with the
    // answered spell's tail. That is not a session that went busy again.
    watchSessionActivity(SESSION);
    vi.advanceTimersByTime(DEBOUNCE);
    expect(snapshot()).toEqual(SETTLED);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a send made after the arrival is still owed its window back", () => {
    waveUp();
    noteNewestAnswer(SESSION, "u-1");

    // New work on a PTY that never left busy. The send ends WITHOUT an arrival
    // of its own — a Previous press moves the cursor off the id it was sent on
    // — and the agent is still working, so the wave comes back a window later.
    beginWaiting(SESSION, "u-1");
    noteUtterance(SESSION, "u-0");
    vi.advanceTimersByTime(DEBOUNCE);
    expect(snapshot()).toEqual(AGENT_HAS_THE_BODY);
  });

  it("the same answer reported twice changes nothing", () => {
    waveUp();

    expect(noteNewestAnswer(SESSION, "u-0")).toBe(false);
    expect(snapshot()).toEqual(AGENT_HAS_THE_BODY);
  });

  it("an arriving answer ends a launcher's starting wait", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, null);
    noteAgentStarting(SESSION);
    expect(snapshot()).toEqual(AGENT_HAS_THE_BODY);

    activity("busy");
    noteNewestAnswer(SESSION, "u-1");
    expect(snapshot()).toEqual(SETTLED);

    // The press's window is not owed back on an arrival: the agent stopped.
    vi.advanceTimersByTime(10 * DEBOUNCE);
    expect(snapshot()).toEqual(SETTLED);
  });
});
