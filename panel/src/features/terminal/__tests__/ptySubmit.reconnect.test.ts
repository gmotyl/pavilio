/**
 * A refused send repairs the socket and tries the frame again, once.
 *
 * ## What this pins, and why it is not the retry queue `ptySubmit` refuses
 *
 * The module's own prose rules out queueing a refused submit for "later": an
 * answer that lands two minutes after it was written replies to a prompt the
 * agent has moved past. That still holds. What is added here is narrower and
 * bounded — the user pressed Enter, and the socket under them was dead, so the
 * socket is rebuilt and the SAME frame is offered to it once, inside the same
 * gesture. Nothing is remembered across it and nothing is retried a second
 * time.
 *
 * ## Why this is a unit file and not a pane file
 *
 * The hard part is a timing shape, not a rendering: `send` is synchronous and
 * a reconnect is not, so the retry has to wait for a socket that may never
 * come back — and everything queued behind it on that session waits with it.
 * That shape is invisible through a rendered pane and is asserted here against
 * the queue itself, with `terminalInstances` mocked so the connection can be
 * driven by hand.
 *
 * `sendOnDeadSocket.test.tsx` keeps the user-visible half, on sessions this
 * browser holds no terminal for — which is the case where there is no socket
 * to repair and the refusal is still reported at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RECONNECT_WAIT_MS,
  SUBMIT_RETURN_MS,
  __resetPtySubmitForTests,
  submitToPty,
} from "../ptySubmit";
import type { ConnectionState } from "../terminalInstances";

/** Every reconnect asked for, in order, as `[sessionId, trigger]`. */
const reconnects: Array<[string, string | undefined]> = [];
/** Connection-state subscribers, by session — the retry's wake-up signal. */
const listeners = new Map<string, Set<(state: ConnectionState) => void>>();

let connectionState: ConnectionState = "disconnected";
let exited = false;

vi.mock("../terminalInstances", () => ({
  getConnectionState: () => connectionState,
  hasExited: () => exited,
  reconnectSession: (sessionId: string, trigger?: string) => {
    reconnects.push([sessionId, trigger]);
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

/**
 * What the real pool emits when the replacement socket finishes its handshake.
 *
 * Deliberately NOT the optimistic emit `connectWs` makes at the ws identity
 * swap: that one goes out synchronously inside the reconnect itself, before
 * the retry has subscribed, and the socket is still CONNECTING when it does.
 */
function socketCameBack(): void {
  for (const cb of listeners.get(SESSION) ?? []) cb("connected");
}

/** What the pool emits when the replacement socket fails to open. */
function socketStayedDown(): void {
  for (const cb of listeners.get(SESSION) ?? []) cb("disconnected");
}

beforeEach(() => {
  __resetPtySubmitForTests();
  reconnects.length = 0;
  listeners.clear();
  connectionState = "disconnected";
  exited = false;
  vi.useFakeTimers();
});

afterEach(() => {
  __resetPtySubmitForTests();
  vi.useRealTimers();
});

describe("a refused send repairs the socket", () => {
  it("a refused body write triggers one reconnect", () => {
    const send = vi.fn((_data: string) => false);

    submitToPty(SESSION, send, "did this go?");

    // Exactly one, and carrying the trigger the reconnect log already defines
    // as "the user activated this session" — a send is an activation (ADR
    // 0010), which is what permits reopening a socket at all here.
    expect(reconnects).toEqual([[SESSION, "auto-activate"]]);
  });

  it("a successful reconnect delivers the body and schedules the return", () => {
    let open = false;
    const send = vi.fn((_data: string) => open);
    const onDelivered = vi.fn();
    const onFailed = vi.fn();

    submitToPty(SESSION, send, "ship it", { onDelivered, onFailed });

    // Nothing is claimed while the socket is still being rebuilt.
    expect(onDelivered).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();

    open = true;
    socketCameBack();

    expect(send.mock.calls).toEqual([["ship it"], ["ship it"]]);
    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(onFailed).not.toHaveBeenCalled();

    // The retry is a delivery like any other, so it owes the keypress that
    // runs the line — a body delivered with no return is a reply left sitting
    // in the agent's prompt.
    vi.advanceTimersByTime(SUBMIT_RETURN_MS);
    expect(send.mock.calls).toEqual([["ship it"], ["ship it"], ["\r"]]);
  });

  it("a failed reconnect reports the body failure and advances the queue", () => {
    const send = vi.fn((_data: string) => false);
    const onFailed = vi.fn();

    submitToPty(SESSION, send, "did this go?", { onFailed });
    socketStayedDown();

    // Exactly today's report: nothing reached the agent, and the caller is
    // told which half was refused so it can keep the text.
    expect(onFailed.mock.calls).toEqual([["body"]]);
    // The socket never came back, so the frame was not offered to it again.
    expect(send.mock.calls).toEqual([["did this go?"]]);

    // And the session's turn came back with it. A reconnect that stalled the
    // queue would leave every later submit on this cell pushed onto an array
    // nothing will ever drain.
    const later = vi.fn((_data: string) => true);
    submitToPty(SESSION, later, "try again");
    expect(later.mock.calls).toEqual([["try again"]]);
  });

  it("a second refusal after reconnect does not retry again", () => {
    const send = vi.fn((_data: string) => false);
    const onFailed = vi.fn();

    submitToPty(SESSION, send, "no second attempt", { onFailed });
    socketCameBack();

    // The one retry was taken and refused. That is the answer.
    expect(send.mock.calls).toEqual([
      ["no second attempt"],
      ["no second attempt"],
    ]);
    expect(onFailed.mock.calls).toEqual([["body"]]);
    expect(reconnects).toHaveLength(1);

    // Nothing is left on a clock that could offer the frame a third time.
    vi.advanceTimersByTime(RECONNECT_WAIT_MS * 3);
    expect(send.mock.calls).toEqual([
      ["no second attempt"],
      ["no second attempt"],
    ]);
    expect(reconnects).toHaveLength(1);
  });

  it("a live socket triggers no reconnect", () => {
    connectionState = "connected";
    const send = vi.fn((_data: string) => true);
    const onDelivered = vi.fn();

    submitToPty(SESSION, send, "ship it", { onDelivered });

    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(reconnects).toEqual([]);

    vi.advanceTimersByTime(SUBMIT_RETURN_MS);
    expect(send.mock.calls).toEqual([["ship it"], ["\r"]]);
    expect(reconnects).toEqual([]);
  });

  it("a refused launcher press swaps the row only after a successful retry", () => {
    let open = false;
    const send = vi.fn((_data: string) => open);
    // What `LauncherPills` hangs on `onDelivered`: the row dropping its pills
    // for `start`. It costs the user the only way back to the other launchers
    // on this cell, so it must not happen on the strength of a refused write.
    const swapRow = vi.fn();
    const onFailed = vi.fn();

    submitToPty(SESSION, send, "claude", { onDelivered: swapRow, onFailed });

    expect(swapRow).not.toHaveBeenCalled();

    open = true;
    socketCameBack();

    expect(send.mock.calls).toEqual([["claude"], ["claude"]]);
    expect(swapRow).toHaveBeenCalledTimes(1);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("queued submits survive a reconnect", () => {
    let open = false;
    const first = vi.fn((_data: string) => open);
    const second = vi.fn((_data: string) => true);

    submitToPty(SESSION, first, "pavilio-session-start alpha");
    submitToPty(SESSION, second, "queued behind the pill");

    // The session is still mid-submit — the reconnect is part of that submit —
    // so what is behind it waits rather than being dropped or written past it.
    expect(second).not.toHaveBeenCalled();

    open = true;
    socketCameBack();

    expect(first.mock.calls).toEqual([
      ["pavilio-session-start alpha"],
      ["pavilio-session-start alpha"],
    ]);
    expect(second).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SUBMIT_RETURN_MS);

    expect(second.mock.calls).toEqual([["queued behind the pill"]]);
  });

  it("an exited session is not reconnected", () => {
    exited = true;
    const send = vi.fn((_data: string) => false);
    const onFailed = vi.fn();

    submitToPty(SESSION, send, "anybody there?", { onFailed });

    // A dead agent is not a dead socket. Rebuilding the ws would reattach to a
    // process that is gone and say nothing useful about why the send failed.
    expect(reconnects).toEqual([]);
    expect(send.mock.calls).toEqual([["anybody there?"]]);
    expect(onFailed.mock.calls).toEqual([["body"]]);
  });

  it("gives up on a reconnect that never completes", () => {
    const send = vi.fn((_data: string) => false);
    const onFailed = vi.fn();

    submitToPty(SESSION, send, "did this go?", { onFailed });

    // A handshake that neither opens nor errors emits nothing at all, so the
    // wait has to be bounded by a clock of its own — the queue's turn is not
    // handed on until this submit finishes, and everything behind it on the
    // session is blocked until it does.
    expect(onFailed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(RECONNECT_WAIT_MS);

    expect(onFailed.mock.calls).toEqual([["body"]]);
    expect(send.mock.calls).toEqual([["did this go?"]]);

    const later = vi.fn((_data: string) => true);
    submitToPty(SESSION, later, "try again");
    expect(later.mock.calls).toEqual([["try again"]]);
  });

  it("a session with no terminal in this browser is not reconnected", () => {
    connectionState = "unattached";
    const send = vi.fn((_data: string) => false);
    const onFailed = vi.fn();

    submitToPty(SESSION, send, "nothing to repair", { onFailed });

    // There is no socket to rebuild, so waiting for one would only stall the
    // queue for the length of the bound before reporting what is already
    // known.
    expect(reconnects).toEqual([]);
    expect(onFailed.mock.calls).toEqual([["body"]]);
  });
});
