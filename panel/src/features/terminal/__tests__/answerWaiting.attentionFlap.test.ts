/**
 * The pane must not flicker while an agent is genuinely working.
 *
 * ## The fact underneath this file
 *
 * The server's activity model has THREE states, not two, and `attention` is
 * NOT "the agent stopped". `terminalActivity.ts` promotes a session to
 * `attention` one `IDLE_DEBOUNCE_MS` after its last byte whenever the busy run
 * lasted longer than `BUSY_THRESHOLD_MS` — and `recordOutput` then BACKDATES
 * `busyStartedAt` past that threshold, so every later gap resolves to
 * `attention` again and never to `idle`.
 *
 * For an agent that thinks between bursts of output — a tool call, a pause, a
 * result, a pause — that is not a state at all but an OSCILLATION:
 * busy → attention → busy → attention for the whole run, one broadcast per
 * flip. `terminalActivity.test.ts` pins that sequence at the source; this file
 * is what the pane must do when it arrives.
 *
 * The reported symptom was exactly the shape of that sequence: "the answer
 * panel goes back to last answer by itself even when the busy indicator is
 * still red — few seconds answer, few seconds wave". The indicator stayed lit
 * because `attention` lights it too. The pane flickered because it read every
 * non-busy state as the agent letting go of the body.
 *
 * ## Why this suite is a store test
 *
 * The wait lives outside React, keyed by session, for the life of the tab; the
 * rendered half is `AnswerPane.waiting.test.tsx`'s. Reaching for a tree here
 * would only re-test it, and would put React's scheduling between the
 * broadcast and the assertion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The activity channel dials a WebSocket at import time and re-arms a 2s
// reconnect timer whenever that socket closes. Under fake timers a real dial
// would fail, close, and leave that timer in the table. A socket that never
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
  getAnswerWaiting,
  holdAnswer,
  isAnswerHeld,
  noteNewestAnswer,
  noteSpeaking,
  noteTransport,
  noteUtterance,
  beginWaiting,
  watchSessionActivity,
} from "../answerWaiting";
import { _applyEventForTests, _resetForTests } from "../useTerminalActivityChannel";

const SESSION = "cell-a";

/** The window these tests are written against, pinned on the document. */
const DEBOUNCE = 3000;

/** The body's handover, as the pane reads it. */
const handedOver = (sessionId = SESSION): boolean => getAnswerWaiting(sessionId).waiting;

/** An activity broadcast for the cell, as the server sends it. */
let at = 0;
const activity = (state: "idle" | "busy" | "attention", sessionId = SESSION): void => {
  at += 1;
  _applyEventForTests({ sessionId, state, at });
};

/**
 * One turn of the flap a working agent produces, as the server broadcasts it:
 * output (`busy`), long enough to be work, then a gap longer than the server's
 * idle debounce, which for a long run promotes to `attention` rather than to
 * `idle`.
 */
const oneBurst = (): void => {
  activity("busy");
  vi.advanceTimersByTime(DEBOUNCE + 500);
  activity("attention");
  vi.advanceTimersByTime(1500);
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

describe("a working agent's pane does not oscillate", () => {
  /**
   * The sequence the user actually hit, in their words: *"I did not navigate
   * answers but I did read the answer that came, the answer was steady while
   * reading and the wave started flickering as soon as the read stopped."*
   *
   * The flap was there the whole time. The DEFERRAL was hiding it: the window
   * elapses while the voice is reading, so the claim it grants is armed and
   * deferred in the same breath and `derive` keeps the body on the answer —
   * steady, for the length of the read, however many times the server flips
   * the session between `busy` and `attention` underneath. `noteSpeaking(…,
   * false)` takes that lid off, and from then on every flip is visible.
   *
   * So the deferral and the hold are two lids on one pot, and this is the
   * cheaper reproduction of the two: it needs no transport press at all.
   */
  it("is steady while the voice reads, and STAYS steady when the read ends", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, "u1");

    // An answer lands for a working agent, and the voice starts reading it.
    activity("busy");
    noteNewestAnswer(SESSION, "u2");
    noteSpeaking(SESSION, true);
    vi.advanceTimersByTime(DEBOUNCE + 500);

    // The claim is armed but deferred against the sentence being read, so the
    // body keeps the answer. This half was never broken.
    expect(handedOver()).toBe(false);

    const whileReading: boolean[] = [];
    for (let i = 0; i < 3; i += 1) {
      activity("attention");
      vi.advanceTimersByTime(1500);
      whileReading.push(handedOver());
      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE + 500);
      whileReading.push(handedOver());
    }
    expect(whileReading).toEqual([false, false, false, false, false, false]);

    // The read ends. The lid comes off: the agent is still working, so the
    // wave is right — and it must now STAY, rather than blinking off at the
    // agent's next pause and back on one window later.
    noteSpeaking(SESSION, false);
    expect(handedOver()).toBe(true);

    const afterReading: boolean[] = [];
    for (let i = 0; i < 3; i += 1) {
      activity("attention");
      vi.advanceTimersByTime(1500);
      afterReading.push(handedOver());
      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE + 500);
      afterReading.push(handedOver());
    }
    // Before the fix this read [false, true, false, true, false, true] — the
    // flicker, starting the moment the read stopped, exactly as reported.
    expect(afterReading).toEqual([true, true, true, true, true, true]);
  });

  it("keeps the body through the busy<->attention flap of a thinking agent", () => {
    watchSessionActivity(SESSION);

    // The agent starts and earns the body the ordinary way.
    activity("busy");
    vi.advanceTimersByTime(DEBOUNCE);
    expect(handedOver()).toBe(true);

    // Now it thinks. Each gap between bursts arrives as `attention`, because
    // the run has already outlived the server's busy threshold. None of them
    // is the agent finishing, so none of them may give the body back.
    const seen: boolean[] = [];
    for (let i = 0; i < 4; i += 1) {
      activity("attention");
      vi.advanceTimersByTime(1500);
      seen.push(handedOver());
      activity("busy");
      vi.advanceTimersByTime(DEBOUNCE + 500);
      seen.push(handedOver());
    }

    // Before the fix this read [false, true, false, true, ...] — the flicker
    // the user reported, with the debounce window setting its period.
    expect(seen).toEqual([true, true, true, true, true, true, true, true]);
  });

  it("gives the body back the moment the agent really stops", () => {
    watchSessionActivity(SESSION);
    oneBurst();
    oneBurst();
    expect(handedOver()).toBe(true);

    // `idle` is the one exit the agent cannot fake: the server reaches it only
    // from a short run, or from a user gesture on an attention session.
    activity("idle");
    expect(handedOver()).toBe(false);
  });

  it("gives the body back one window after an agent finishes into attention", () => {
    watchSessionActivity(SESSION);
    activity("busy");
    vi.advanceTimersByTime(DEBOUNCE);
    expect(handedOver()).toBe(true);

    // The agent finished and is asking the user something. That arrives as
    // `attention` — the same broadcast a gap between bursts makes — so the
    // pane does not act on it yet.
    activity("attention");
    vi.advanceTimersByTime(DEBOUNCE - 1);
    expect(handedOver()).toBe(true);

    // ...and acts when the silence outlives the window. This is the cost of
    // the fix, paid once at the END of a run, and it is the reason `attention`
    // is not simply left to the agent: a finished agent sitting there never
    // reaches `idle` on its own, so a wave that waited for `idle` would wait
    // for the rest of the session.
    vi.advanceTimersByTime(1);
    expect(handedOver()).toBe(false);

    // Ten more minutes of it change nothing further.
    vi.advanceTimersByTime(600_000);
    expect(handedOver()).toBe(false);
  });

  it("schedules nothing once the quiet window has been answered", () => {
    watchSessionActivity(SESSION);
    activity("busy");
    vi.advanceTimersByTime(DEBOUNCE);

    // The flap, then a real stop. Neither window may be left running: a stale
    // quiet timer would hand a later busy spell's body back for no reason.
    oneBurst();
    activity("idle");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a send's wait survives the flap and still ends on the reply", () => {
    watchSessionActivity(SESSION);
    beginWaiting(SESSION, "u1");
    noteNewestAnswer(SESSION, "u1");
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: true });

    // The agent works on the reply, thinking between bursts.
    oneBurst();
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: true });
    oneBurst();
    expect(getAnswerWaiting(SESSION)).toEqual({ waiting: true, pending: true });

    // The reply lands — the cursor moves onto an id that is not the one the
    // draft was sent on — so the send is over and the mark goes with it. The
    // agent is still working, so the body stays the agent's.
    noteNewestAnswer(SESSION, "u2");
    noteUtterance(SESSION, "u2");
    expect(getAnswerWaiting(SESSION).pending).toBe(false);
  });
});

describe("a hold the user took survives a blip", () => {
  it("keeps the hold through an attention gap in a working agent's run", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, "u1");

    activity("busy");
    vi.advanceTimersByTime(DEBOUNCE);
    expect(handedOver()).toBe(true);

    // *Previous*: the user stepping back to re-read while the agent works.
    noteTransport(SESSION);
    holdAnswer(SESSION);
    expect(isAnswerHeld(SESSION)).toBe(true);
    expect(handedOver()).toBe(false);

    // The agent pauses between bursts. That is not the user's hold being
    // over — nothing the user did released it, and the agent has not stopped.
    activity("attention");
    vi.advanceTimersByTime(1500);
    expect(isAnswerHeld(SESSION)).toBe(true);

    // ...and the burst that follows must not raise the wave over the text the
    // user asked to keep looking at.
    activity("busy");
    vi.advanceTimersByTime(DEBOUNCE + 500);
    expect(isAnswerHeld(SESSION)).toBe(true);
    expect(handedOver()).toBe(false);
  });

  it("still releases the hold when the agent actually finishes", () => {
    watchSessionActivity(SESSION);
    noteNewestAnswer(SESSION, "u1");

    activity("busy");
    vi.advanceTimersByTime(DEBOUNCE);
    holdAnswer(SESSION);
    expect(isAnswerHeld(SESSION)).toBe(true);

    oneBurst();
    expect(isAnswerHeld(SESSION)).toBe(true);

    activity("idle");
    expect(isAnswerHeld(SESSION)).toBe(false);
  });
});
