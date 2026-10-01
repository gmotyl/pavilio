/**
 * The submitting return reports its OWN delivery, not just its refusal.
 *
 * ## Why a third report and not a reading of the two there are
 *
 * `onDelivered` says the BODY reached the socket, and `onFailed("return")`
 * says the return did not. Between them sits the case nobody could name: the
 * body went, the return went, and nothing came back. A caller that wanted to
 * act on that had to infer it — "delivered, and no failure by now" — which is
 * a guess about a write that happens {@link SUBMIT_RETURN_MS} later, on a
 * submit that may still be queued behind another. The retry ticket
 * (`answerRetry`) is exactly such a caller: it may arm its clock only for a
 * Return that a live socket accepted, because a Return that was refused is
 * already reported to the user and a body that never landed has nothing to
 * re-run.
 *
 * So the accepted Return is stated rather than deduced, and the two facts this
 * file pins are that it is stated exactly once per submit and that it is never
 * stated for a submit that also reported `onFailed("return")` — the arming
 * signal and the refusal are the two sides of one write and cannot both be
 * true of it.
 *
 * ## Why this is a unit file
 *
 * The report's shape is a timing one — after `onDelivered`, a gap later, once
 * per queued submit, and on the far side of a reconnect — and none of that is
 * visible through a rendered composer. `terminalInstances` is mocked the same
 * way `ptySubmit.reconnect.test.ts` mocks it, so the socket's comings and
 * goings are driven by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SUBMIT_RETURN_MS,
  __resetPtySubmitForTests,
  submitToPty,
} from "../ptySubmit";
import type { ConnectionState } from "../terminalInstances";

/** Connection-state subscribers, by session — the reconnect retry's wake-up. */
const listeners = new Map<string, Set<(state: ConnectionState) => void>>();

let connectionState: ConnectionState = "disconnected";
let exited = false;

/**
 * Hand a connection verdict to everything subscribed for that session, over a
 * COPY of the set — which is what `emitConnectionState` does, and what lets a
 * submit subscribe from inside the settle of the submit ahead of it.
 */
function emit(sessionId: string, state: ConnectionState): void {
  for (const cb of [...(listeners.get(sessionId) ?? [])]) cb(state);
}

vi.mock("../terminalInstances", () => ({
  bracketedPasteOn: () => false,
  getConnectionState: () => connectionState,
  hasExited: () => exited,
  reconnectSession: (sessionId: string) => {
    // The optimistic "connected" the real `connectWs` emits at the ws identity
    // swap, while the replacement socket is still CONNECTING. Kept here for the
    // reason `ptySubmit.reconnect.test.ts` keeps it: a retry woken by THIS emit
    // writes into a socket that cannot take the frame, and a mock that stayed
    // silent would let that inversion pass.
    emit(sessionId, "connected");
  },
  onConnectionChange: (
    sessionId: string,
    cb: (state: ConnectionState) => void,
  ) => {
    let set = listeners.get(sessionId);
    if (!set) {
      set = new Set();
      listeners.set(sessionId, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
    };
  },
}));

const SESSION = "cell-a";

/** What the pool emits when the replacement socket finishes its handshake. */
function socketCameBack(): void {
  emit(SESSION, "connected");
}

beforeEach(() => {
  __resetPtySubmitForTests();
  listeners.clear();
  connectionState = "connected";
  exited = false;
  vi.useFakeTimers();
});

afterEach(() => {
  __resetPtySubmitForTests();
  vi.useRealTimers();
});

describe("the submitting return reports its delivery", () => {
  it("reports the submitting return once it reaches the socket", () => {
    const send = vi.fn((_data: string) => true);
    const onDelivered = vi.fn();
    const onFailed = vi.fn();
    const onReturnDelivered = vi.fn();

    submitToPty(SESSION, send, "ship it", {
      onDelivered,
      onFailed,
      onReturnDelivered,
    });

    // The body's delivery is not the return's: the keypress that runs the line
    // is still a gap away, and anything armed on it now would be armed on a
    // write that has not happened.
    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(onReturnDelivered).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SUBMIT_RETURN_MS);

    expect(send.mock.calls).toEqual([["ship it"], ["\r"]]);
    expect(onReturnDelivered).toHaveBeenCalledTimes(1);
    expect(onFailed).not.toHaveBeenCalled();
    // Stated as an ordering and not only as a count, because the caller that
    // wants this report hangs the rest of its ticket off `onDelivered`: a
    // return reported before the body was would arm a ticket that does not
    // exist yet.
    expect(onDelivered.mock.invocationCallOrder[0]).toBeLessThan(
      onReturnDelivered.mock.invocationCallOrder[0],
    );

    // And nothing on a later turn of the clock says it a second time.
    vi.advanceTimersByTime(SUBMIT_RETURN_MS * 5);
    expect(onReturnDelivered).toHaveBeenCalledTimes(1);
  });

  it("reports a refused return as a failure and never as a delivery", () => {
    // The body lands and the return does not — the line is sitting in the
    // TUI's prompt with nobody having pressed Enter on it. The user is already
    // told that in words, so the two reports are mutually exclusive: a ticket
    // armed here would offer to re-press a key whose refusal is on screen.
    const send = vi.fn((data: string) => data !== "\r");
    const onDelivered = vi.fn();
    const onFailed = vi.fn();
    const onReturnDelivered = vi.fn();

    submitToPty(SESSION, send, "did this run?", {
      onDelivered,
      onFailed,
      onReturnDelivered,
    });
    vi.advanceTimersByTime(SUBMIT_RETURN_MS);

    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(onFailed.mock.calls).toEqual([["return"]]);
    expect(onReturnDelivered).not.toHaveBeenCalled();
  });

  it("a refused body never reports a return delivery", () => {
    // No terminal in this browser, so there is no socket to repair and the
    // refusal is final. Nothing was written, so there is no return to write
    // and nothing for a retry to re-run.
    connectionState = "unattached";
    const send = vi.fn((_data: string) => false);
    const onDelivered = vi.fn();
    const onFailed = vi.fn();
    const onReturnDelivered = vi.fn();

    submitToPty(SESSION, send, "nothing to repair", {
      onDelivered,
      onFailed,
      onReturnDelivered,
    });
    vi.advanceTimersByTime(SUBMIT_RETURN_MS * 5);

    expect(onFailed.mock.calls).toEqual([["body"]]);
    expect(onDelivered).not.toHaveBeenCalled();
    expect(onReturnDelivered).not.toHaveBeenCalled();
    expect(send.mock.calls).toEqual([["nothing to repair"]]);
  });

  it("a body accepted by the rebuilt socket still reports its return", () => {
    // A body delivered after a reconnect is a delivery in every way that
    // matters, and the return it owes is owed on the same terms — so the
    // report has to survive the path that goes through `reconnectAndRetry`
    // rather than only the straight-line one.
    let open = false;
    const send = vi.fn((_data: string) => open);
    const onReturnDelivered = vi.fn();
    const onFailed = vi.fn();

    submitToPty(SESSION, send, "ship it", { onReturnDelivered, onFailed });

    open = true;
    socketCameBack();

    expect(send.mock.calls).toEqual([["ship it"], ["ship it"]]);
    expect(onReturnDelivered).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SUBMIT_RETURN_MS);

    expect(send.mock.calls).toEqual([["ship it"], ["ship it"], ["\r"]]);
    expect(onReturnDelivered).toHaveBeenCalledTimes(1);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("each queued submit reports its own return delivery", () => {
    // Two replies in quick succession are two tickets, not one: the second
    // submit's return is the one the second ticket waits on, and a report
    // shared between them would arm the wrong clock.
    const first = vi.fn((_data: string) => true);
    const second = vi.fn((_data: string) => true);
    const firstReturn = vi.fn();
    const secondReturn = vi.fn();

    submitToPty(SESSION, first, "first", { onReturnDelivered: firstReturn });
    submitToPty(SESSION, second, "second", { onReturnDelivered: secondReturn });

    expect(second).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SUBMIT_RETURN_MS);

    // The first return has gone out, and it is what hands the session's turn
    // to the body behind it — so the queue advancing is part of what this
    // report must not disturb.
    expect(first.mock.calls).toEqual([["first"], ["\r"]]);
    expect(firstReturn).toHaveBeenCalledTimes(1);
    expect(second.mock.calls).toEqual([["second"]]);
    expect(secondReturn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SUBMIT_RETURN_MS);

    expect(second.mock.calls).toEqual([["second"], ["\r"]]);
    expect(secondReturn).toHaveBeenCalledTimes(1);
    expect(firstReturn).toHaveBeenCalledTimes(1);
  });
});

/**
 * The third report is foreign code like the other two, and the queue's
 * invariant is not allowed to depend on it behaving.
 *
 * `ptySubmit.test.ts` already pins that rule for `onDelivered` and for both
 * refusals; this is the same rule for the report added here, and it needs its
 * own test because it is the same rule at a DIFFERENT call site — the one
 * inside the scheduled return, where a restructuring that raised the delivery
 * outside the `try` would leave the session's entry in `queues` standing with
 * nothing left to drain it. That entry IS the busy flag, so what the user gets
 * is a cell whose composer and launcher pills are dead until the page is
 * reloaded, and every existing test in the terminal tree passes while it is.
 */
describe("when the caller throws out of the return's delivery report", () => {
  it("still advances the queue when onReturnDelivered throws", () => {
    const first = vi.fn((_data: string) => true);

    submitToPty(SESSION, first, "first", {
      onReturnDelivered: () => {
        throw new Error("a subscriber blew up");
      },
    });
    expect(first.mock.calls).toEqual([["first"]]);

    // The throw happens inside the scheduled return, so this is where it
    // surfaces — asserted here so the suite catches it deliberately rather
    // than meeting it as an unhandled error.
    expect(() => vi.advanceTimersByTime(SUBMIT_RETURN_MS)).toThrow(
      "a subscriber blew up",
    );
    expect(first.mock.calls).toEqual([["first"], ["\r"]]);

    // The session's turn was handed on regardless, which is the only thing
    // that can be observed about it: a later submit is WRITTEN rather than
    // pushed onto a queue nothing will ever drain.
    const second = vi.fn((_data: string) => true);
    submitToPty(SESSION, second, "second");
    expect(second.mock.calls).toEqual([["second"]]);
  });

  it("still advances the queue when a submit queued behind one throws", () => {
    // The wedge is worse one step in: the throwing submit is itself the one
    // that was handed the turn, so a queue left mid-submit here strands a
    // session that already has a third reply waiting on it.
    const first = vi.fn((_data: string) => true);
    const second = vi.fn((_data: string) => true);

    submitToPty(SESSION, first, "first");
    submitToPty(SESSION, second, "second", {
      onReturnDelivered: () => {
        throw new Error("the second subscriber blew up");
      },
    });

    // The first return goes out and hands the turn to the body behind it.
    vi.advanceTimersByTime(SUBMIT_RETURN_MS);
    expect(second.mock.calls).toEqual([["second"]]);

    expect(() => vi.advanceTimersByTime(SUBMIT_RETURN_MS)).toThrow(
      "the second subscriber blew up",
    );
    expect(second.mock.calls).toEqual([["second"], ["\r"]]);

    const third = vi.fn((_data: string) => true);
    submitToPty(SESSION, third, "third");
    expect(third.mock.calls).toEqual([["third"]]);
  });
});
