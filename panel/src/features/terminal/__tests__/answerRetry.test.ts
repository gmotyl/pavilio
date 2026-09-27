/**
 * The per-send retry ticket, tested as the store it is.
 *
 * This module's whole reason for existing is that it must NOT share a lifetime
 * with `answerWaiting`: that store's wait ends on an idle transition, and an
 * idle transition is exactly the state in which this store is supposed to make
 * its offer. So the two are exercised apart, and every fact here arrives the
 * way the real callers push it — a submit, the accepted Return, the server's
 * activity broadcast, the cursor the pane is on.
 *
 * Mounting a tree to produce that order would put React's scheduling between
 * the clock and the assertion without asserting anything more: the ticket
 * outlives the composer that opened it, which is the point of keeping it at
 * module level.
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
 * The activity subscription, counted. Released is not otherwise observable —
 * the channel exports no reader for its listener sets, and a leaked
 * subscription whose callback finds no ticket behaves exactly like one that
 * was closed — so the one criterion that says the watch is RELEASED is pinned
 * by wrapping the real function rather than by a side effect that would pass
 * without it.
 */
const watches = vi.hoisted(() => ({ opened: 0, closed: 0 }));

vi.mock("../useTerminalActivityChannel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../useTerminalActivityChannel")>();
  return {
    ...actual,
    subscribeActivity: (
      sessionId: string,
      fn: (state: "idle" | "busy" | "attention") => void,
    ) => {
      watches.opened += 1;
      const off = actual.subscribeActivity(sessionId, fn);
      return () => {
        watches.closed += 1;
        off();
      };
    },
  };
});

import {
  RETRY_OFFER_MS,
  __resetAnswerRetryForTests,
  armRetryOffer,
  beginRetryTicket,
  clearRetryTicket,
  consumeRetryOffer,
  forgetAnswerRetry,
  isRetryOffered,
  noteRetrySentOn,
  noteRetryUtterance,
  subscribeAnswerRetry,
} from "../answerRetry";
import { _applyEventForTests, _resetForTests } from "../useTerminalActivityChannel";

const SESSION = "cell-a";

/** An activity broadcast for the cell, as the server sends it. */
let at = 0;
const activity = (state: "idle" | "busy" | "attention", sessionId = SESSION): void => {
  at += 1;
  _applyEventForTests({ sessionId, state, at });
};

/** A submit whose initial Return the socket accepted — the only way in. */
const acceptedSend = (sentOn: string | null = "u-1", sessionId = SESSION): number => {
  const generation = beginRetryTicket(sessionId);
  noteRetrySentOn(sessionId, sentOn);
  armRetryOffer(sessionId, generation);
  return generation;
};

beforeEach(() => {
  at = 0;
  watches.opened = 0;
  watches.closed = 0;
  _resetForTests();
  __resetAnswerRetryForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  _resetForTests();
  __resetAnswerRetryForTests();
  vi.useRealTimers();
});

describe("the deadline", () => {
  it("offers a retry two seconds after an accepted return when the session is idle", () => {
    const told = vi.fn();
    subscribeAnswerRetry(told);

    acceptedSend();
    expect(isRetryOffered(SESSION)).toBe(false);

    vi.advanceTimersByTime(RETRY_OFFER_MS);

    expect(isRetryOffered(SESSION)).toBe(true);
    expect(told).toHaveBeenCalled();
  });

  it("does not offer before the deadline", () => {
    acceptedSend();

    vi.advanceTimersByTime(RETRY_OFFER_MS - 1);

    expect(isRetryOffered(SESSION)).toBe(false);
  });

  it("offers nothing when the session is busy at the deadline", () => {
    // Busy BEFORE the ticket opens, and that order is the whole test. A
    // broadcast made after `beginRetryTicket` is taken by the eager
    // `onActivity` withdrawal instead: the ticket is gone before the clock
    // runs out, the timer callback bails on its `tickets.get` and the gate at
    // the deadline is never asked anything — which is how these two tests
    // passed while that gate was deleted outright. Seeding the state first
    // leaves nothing listening to react, so the timer runs the full
    // `RETRY_OFFER_MS` and `getActivityState` at the deadline is the only
    // thing that can say no.
    activity("busy");
    acceptedSend();

    vi.advanceTimersByTime(RETRY_OFFER_MS);

    expect(isRetryOffered(SESSION)).toBe(false);
    // The ticket is gone, not merely unoffered: a session that was working at
    // the deadline answered the question this ticket existed to ask.
    expect(consumeRetryOffer(SESSION)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("offers nothing when the session is at attention at the deadline", () => {
    // `attention` is *busy a long time, then quiet for a second* — an agent
    // mid-run between two bursts of output, which is not an unanswered send.
    // Seeded before the ticket for the reason above: this file has to reach
    // the deadline's own reading of the state, not the transition rule.
    activity("attention");
    acceptedSend();

    vi.advanceTimersByTime(RETRY_OFFER_MS);

    expect(isRetryOffered(SESSION)).toBe(false);
    expect(consumeRetryOffer(SESSION)).toBe(false);
    // The timer is spent and the ticket with it — `attention` is read at the
    // deadline exactly as `busy` is, not merely left unoffered.
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the offer's lifetime", () => {
  it("clears a visible offer when the session goes busy", () => {
    acceptedSend();
    vi.advanceTimersByTime(RETRY_OFFER_MS);
    expect(isRetryOffered(SESSION)).toBe(true);

    const told = vi.fn();
    subscribeAnswerRetry(told);
    activity("busy");

    expect(isRetryOffered(SESSION)).toBe(false);
    expect(told).toHaveBeenCalled();
  });

  it("a newer utterance clears the ticket", () => {
    acceptedSend("u-1");
    vi.advanceTimersByTime(RETRY_OFFER_MS);

    noteRetryUtterance(SESSION, "u-2");

    expect(isRetryOffered(SESSION)).toBe(false);
    expect(consumeRetryOffer(SESSION)).toBe(false);
  });

  it("the utterance the send replied to does not clear the ticket", () => {
    acceptedSend("u-1");
    vi.advanceTimersByTime(RETRY_OFFER_MS);

    // What `SpeechControlBar` pushes on every remount: the cursor has not
    // moved, so this is the cell saying where it still stands.
    noteRetryUtterance(SESSION, "u-1");

    expect(isRetryOffered(SESSION)).toBe(true);
  });

  it("forgetting a session releases its timer and activity subscription", () => {
    acceptedSend();
    expect(vi.getTimerCount()).toBe(1);
    expect(watches).toEqual({ opened: 1, closed: 0 });

    forgetAnswerRetry(SESSION);

    expect(vi.getTimerCount()).toBe(0);
    expect(isRetryOffered(SESSION)).toBe(false);
    expect(watches).toEqual({ opened: 1, closed: 1 });

    // And nothing is listening for this session any more: a broadcast that
    // would have reached the store reaches nobody.
    const told = vi.fn();
    subscribeAnswerRetry(told);
    activity("busy");
    expect(told).not.toHaveBeenCalled();
  });
});

describe("generations", () => {
  it("ignores an arm for a superseded generation", () => {
    const stale = beginRetryTicket(SESSION);
    beginRetryTicket(SESSION);

    armRetryOffer(SESSION, stale);

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(RETRY_OFFER_MS);
    expect(isRetryOffered(SESSION)).toBe(false);
  });

  it("a new submit replaces the older ticket and its timer", () => {
    acceptedSend();
    vi.advanceTimersByTime(RETRY_OFFER_MS - 1);
    expect(vi.getTimerCount()).toBe(1);

    beginRetryTicket(SESSION);

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(RETRY_OFFER_MS);
    expect(isRetryOffered(SESSION)).toBe(false);
  });

  it("a stale clear leaves the current ticket alone", () => {
    const stale = beginRetryTicket(SESSION);
    const current = beginRetryTicket(SESSION);
    noteRetrySentOn(SESSION, "u-1");
    armRetryOffer(SESSION, current);

    clearRetryTicket(SESSION, stale);

    vi.advanceTimersByTime(RETRY_OFFER_MS);
    expect(isRetryOffered(SESSION)).toBe(true);
  });
});

describe("spending the offer", () => {
  it("consuming the offer succeeds exactly once", () => {
    acceptedSend();
    vi.advanceTimersByTime(RETRY_OFFER_MS);

    expect(consumeRetryOffer(SESSION)).toBe(true);
    expect(consumeRetryOffer(SESSION)).toBe(false);
    expect(isRetryOffered(SESSION)).toBe(false);
  });

  it("consuming with no offer standing returns false", () => {
    expect(consumeRetryOffer(SESSION)).toBe(false);

    // Armed but not yet due is still nothing to spend.
    acceptedSend();
    expect(consumeRetryOffer(SESSION)).toBe(false);
  });
});
