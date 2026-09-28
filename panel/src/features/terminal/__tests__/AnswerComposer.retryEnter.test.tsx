/**
 * The composer's end of the retry ticket: it opens one per send, shows the
 * offer when the store makes it, and spends it on exactly one `\r`.
 *
 * ## Why the real store rather than a mocked one
 *
 * The thing worth pinning here is the SEAM — that the generation
 * `beginRetryTicket` hands out is the one this submit's callbacks carry, and
 * that a report from a submit the user has moved past therefore arms nothing.
 * A mocked store would let the composer pass that with any number at all,
 * because the only thing checking it would be the assertion. So the store is
 * the real one, driven through the real `ptySubmit` and the real clock, and
 * the module is wrapped rather than replaced: every function still does what
 * it does, and the wrapper only records that it was reached and with what.
 * `answerRetry.test.ts` wraps `subscribeActivity` the same way and for the same
 * reason.
 *
 * ## What the wrapping catches that behaviour alone does not
 *
 * Two things, both of them holes a reviewer opened in the shipped store and
 * walked through with the whole suite green:
 *
 * - `consumeRetryOffer` must drop the WHOLE ticket and not merely lower a
 *   flag. A flag-only version answers `false` the second time, so every
 *   behavioural assertion about double taps still passes while the ticket and
 *   its activity subscription leak for the life of the tab. The counted
 *   activity watch is what says the difference out loud: a spent offer closes
 *   its subscription.
 * - the ORDER of the consume and the write. "One Return per offer" is a
 *   property of consuming first, and a composer that wrote first and consumed
 *   afterwards would pass a double-tap test on any single-threaded runtime
 *   while being wrong about the thing it claims. So the two are recorded on
 *   one trace and the trace is asserted, not just the write count.
 *
 * ## Why the composer is rendered alone
 *
 * The offer must not depend on the answer pane's waiting body being on screen
 * — that body comes and goes with an idle redraw, and the whole premise of
 * this ticket is a session that went idle. Rendering the composer by itself,
 * with no pane around it, is that requirement stated as a fixture: there IS no
 * waiting body in this file, and the button appears anyway.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The activity channel dials a WebSocket at import time and re-arms a 2s
// reconnect timer whenever that socket closes — which under fake timers would
// put a timer of its own into the table the retry deadline is being advanced
// through. A socket that never closes keeps the table to this test's timers.
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

/** Every ticket call the composer made, in the order it made them. */
const calls = vi.hoisted(() => ({
  begin: [] as Array<[string, number]>,
  arm: [] as Array<[string, number]>,
  clear: [] as Array<[string, number | undefined]>,
  consume: [] as boolean[],
}));

/** The consume and the writes on one tape, so their ORDER can be asserted. */
const trace = vi.hoisted(() => ({ steps: [] as string[] }));

/** The ticket's activity subscription, counted — see the header. */
const watches = vi.hoisted(() => ({ opened: 0, closed: 0 }));

vi.mock("../useTerminalActivityChannel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../useTerminalActivityChannel")>();
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

vi.mock("../answerRetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../answerRetry")>();
  return {
    ...actual,
    beginRetryTicket: (sessionId: string) => {
      const generation = actual.beginRetryTicket(sessionId);
      calls.begin.push([sessionId, generation]);
      return generation;
    },
    armRetryOffer: (sessionId: string, generation: number) => {
      calls.arm.push([sessionId, generation]);
      actual.armRetryOffer(sessionId, generation);
    },
    clearRetryTicket: (sessionId: string, generation?: number) => {
      calls.clear.push([sessionId, generation]);
      actual.clearRetryTicket(sessionId, generation);
    },
    consumeRetryOffer: (sessionId: string) => {
      const spent = actual.consumeRetryOffer(sessionId);
      calls.consume.push(spent);
      trace.steps.push(`consume:${spent}`);
      return spent;
    },
  };
});

import { AnswerComposer } from "../AnswerComposer";
import {
  RETRY_OFFER_MS,
  __resetAnswerRetryForTests,
  armRetryOffer,
  beginRetryTicket,
  clearRetryTicket,
  isRetryOffered,
} from "../answerRetry";
import { __resetComposerDraftsForTests } from "../composerDrafts";
import { SUBMIT_RETURN_MS, __resetPtySubmitForTests } from "../ptySubmit";
import type { ConnectionState } from "../terminalInstances";
import { _applyEventForTests, _resetForTests } from "../useTerminalActivityChannel";

/** A cell whose socket the pool would be willing to rebuild. */
let connectionState: ConnectionState = "connected";

// The pool is somebody else's subject and jsdom has no socket under any of it.
// What is replaced is exactly the entry points this gesture reaches.
vi.mock("../terminalInstances", () => ({
  sendDismiss: () => {},
  reconnectOnActivate: () => {},
  getConnectionState: () => connectionState,
  hasExited: () => false,
  reconnectSession: () => {},
  onConnectionChange: () => () => {},
}));

const SESSION = "cell-a";

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** jsdom has no `matchMedia`, and the composer's grip asks it for the viewport. */
function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

const onSubmitted = vi.fn();

/** A `send` that records every frame on the shared trace beside the consume. */
function tracingSend(accepts: (data: string) => boolean) {
  return vi.fn((data: string) => {
    const ok = accepts(data);
    trace.steps.push(`write:${JSON.stringify(data)}:${ok}`);
    return ok;
  });
}

function renderComposer(send: (data: string) => boolean) {
  return render(<AnswerComposer sessionId={SESSION} send={send} onSubmitted={onSubmitted} />);
}

const field = (): HTMLTextAreaElement =>
  screen.getByTestId(`answer-pane-composer-${SESSION}`) as HTMLTextAreaElement;

/** The retry control, or `null` while no offer stands. */
const retryButton = (): HTMLElement | null =>
  screen.queryByTestId(`answer-pane-retry-enter-${SESSION}`);

const noticeText = (): string =>
  screen.queryByTestId(`answer-pane-send-failed-${SESSION}`)?.textContent ?? "";

/** Types a reply and presses the key that sends it. */
function submit(text: string): void {
  fireEvent.change(field(), { target: { value: text } });
  fireEvent.keyDown(field(), { key: "Enter" });
}

const tick = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

/** An activity broadcast for the cell, as the server sends it. */
let at = 0;
const activity = (state: "idle" | "busy" | "attention"): void => {
  at += 1;
  act(() => {
    _applyEventForTests({ sessionId: SESSION, state, at });
  });
};

/**
 * A submit carried all the way to a standing offer: the body, the submitting
 * return a gap later, and the deadline two seconds after that with the session
 * still idle.
 */
function submitAndWaitForOffer(text: string): void {
  submit(text);
  tick(SUBMIT_RETURN_MS);
  tick(RETRY_OFFER_MS);
}

beforeEach(() => {
  at = 0;
  calls.begin = [];
  calls.arm = [];
  calls.clear = [];
  calls.consume = [];
  trace.steps = [];
  watches.opened = 0;
  watches.closed = 0;
  connectionState = "connected";
  onSubmitted.mockClear();
  _resetForTests();
  __resetAnswerRetryForTests();
  __resetPtySubmitForTests();
  __resetComposerDraftsForTests();
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  installMatchMedia();
});

afterEach(() => {
  _resetForTests();
  __resetAnswerRetryForTests();
  __resetPtySubmitForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the composer opens a ticket per send", () => {
  it("opens a retry ticket for every submit", () => {
    const send = tracingSend(() => true);
    renderComposer(send);

    submitAndWaitForOffer("first reply");
    expect(retryButton()).not.toBeNull();

    // Spent, and the next send gets a ticket of its own rather than inheriting
    // this one: the offer belongs to a SEND, not to the session.
    act(() => {
      retryButton()?.click();
    });
    expect(retryButton()).toBeNull();

    submitAndWaitForOffer("second reply");
    expect(retryButton()).not.toBeNull();

    expect(calls.begin.map(([sessionId]) => sessionId)).toEqual([SESSION, SESSION]);
    // Two tickets, two generations — and each arm carries the one its OWN
    // submit was handed, never the other's. This equality is the seam the file
    // exists for: a composer that arms with a number it made up, or with the
    // session's latest, passes every behavioural assertion above.
    expect(calls.arm).toEqual(calls.begin);
  });

  it("arms the offer only when the submitting return is delivered", () => {
    // The body lands and the return does not, which the user is already told
    // in words: an offer here would invite a second press of a key whose
    // refusal is on screen.
    const send = tracingSend((data) => data !== "\r");
    renderComposer(send);

    submit("did this run?");
    tick(SUBMIT_RETURN_MS);
    tick(RETRY_OFFER_MS * 2);

    expect(calls.begin.map(([sessionId]) => sessionId)).toEqual([SESSION]);
    expect(calls.arm).toEqual([]);
    expect(retryButton()).toBeNull();
    expect(noticeText()).toMatch(/not submitted/i);
    // And the ticket is CLEARED on this half too, not merely left unarmed. The
    // two are indistinguishable on screen — a ticket that was never armed has
    // no deadline timer, so no offer can appear either way — which is how a
    // reviewer narrowed `onFailed` to the body stage alone with all nine tests
    // here green. What the counted watch says out loud is the part the screen
    // cannot: an unarmed ticket still holds an open activity subscription, and
    // a return-stage refusal that walks away from it leaks that subscription
    // until the next submit or the session's destruction.
    expect(watches).toEqual({ opened: 1, closed: 1 });
  });

  it("a refused submit clears the ticket", () => {
    // No terminal in this browser, so there is nothing to repair and the
    // refusal is final and immediate.
    connectionState = "unattached";
    const send = tracingSend(() => false);
    renderComposer(send);

    submit("nowhere to go");

    // Cleared with the generation this submit was handed, not bare: a failure
    // report from a submit the user has already moved past must not take the
    // ticket their newer send just opened. Compared against `begin` rather
    // than against a literal, and only after `begin` is known to have
    // happened — two empty arrays are equal, and that equality would say
    // nothing at all.
    expect(calls.begin).toHaveLength(1);
    expect(calls.clear).toEqual(calls.begin);

    tick(SUBMIT_RETURN_MS + RETRY_OFFER_MS * 2);

    expect(retryButton()).toBeNull();
    expect(calls.arm).toEqual([]);
    // The ticket is gone, subscription and all, rather than merely unoffered.
    expect(watches).toEqual({ opened: 1, closed: 1 });
  });
});

describe("the offer on screen", () => {
  it("shows Retry Enter while the offer stands and hides it otherwise", () => {
    const send = tracingSend(() => true);
    renderComposer(send);

    submit("did this run?");
    tick(SUBMIT_RETURN_MS);
    // Armed, and not yet due: nothing is offered before the deadline.
    expect(retryButton()).toBeNull();

    tick(RETRY_OFFER_MS);

    // A real accessible name, carried by the button's own text rather than by
    // an `aria-label` standing in for an icon — this control has words on it.
    const button = screen.getByRole("button", { name: "Retry Enter" });
    expect(button).toBe(retryButton());

    // Any sign of life from the session withdraws it: the offer's whole claim
    // is that the Return never landed.
    activity("busy");

    expect(retryButton()).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry Enter" })).toBeNull();
  });
});

describe("spending the offer", () => {
  it("sends exactly one carriage return and never the draft again", () => {
    const send = tracingSend(() => true);
    renderComposer(send);

    submitAndWaitForOffer("the whole reply");
    const before = send.mock.calls.length;

    act(() => {
      retryButton()?.click();
    });

    // One write, and it is the bare keypress. The body is already in the TUI's
    // prompt — this is not a resubmit, and a second copy of the reply would be
    // the double-send the offer exists to be the safe alternative to.
    expect(send.mock.calls.slice(before)).toEqual([["\r"]]);
    expect(send.mock.calls.filter(([data]) => data === "the whole reply")).toHaveLength(1);
  });

  it("consumes the ticket before writing, so a double tap sends once", () => {
    const send = tracingSend(() => true);
    renderComposer(send);

    submitAndWaitForOffer("the whole reply");
    trace.steps = [];

    // Both activations inside ONE act, so React has not re-rendered between
    // them and the button is still in the document for the second — which is
    // what a double click, or a keyboard activation racing a pointer one,
    // actually looks like. Clicking after a flush would dispatch on a detached
    // node and prove nothing.
    const button = retryButton();
    act(() => {
      button?.click();
      button?.click();
    });

    expect(calls.consume).toEqual([true, false]);
    // The tape says the order as well as the count: a composer that wrote
    // first and consumed afterwards would still write once on a single-threaded
    // runtime, and would be wrong about why.
    expect(trace.steps).toEqual(["consume:true", 'write:"\\r":true', "consume:false"]);
  });

  it("a refused retry shows the send error and does not offer again", () => {
    // The submitting return lands; the retry's does not — the socket went
    // between the two.
    let returns = 0;
    const send = tracingSend((data) => {
      if (data !== "\r") return true;
      returns += 1;
      return returns === 1;
    });
    renderComposer(send);

    submitAndWaitForOffer("did this run?");
    const before = send.mock.calls.length;

    act(() => {
      retryButton()?.click();
    });

    expect(noticeText()).toMatch(/not submitted/i);
    // One attempt, and it is spent: a refused write does not hand the ticket
    // back, and nothing here schedules another.
    expect(send.mock.calls.slice(before)).toEqual([["\r"]]);
    expect(retryButton()).toBeNull();

    tick(RETRY_OFFER_MS * 2);
    activity("idle");
    expect(retryButton()).toBeNull();

    // And the ticket went WHOLE. A consume that only lowered an `offered` flag
    // answers `false` from here on and passes every assertion above while the
    // ticket and its activity subscription leak for the life of the tab.
    expect(watches).toEqual({ opened: 1, closed: 1 });
    expect(isRetryOffered(SESSION)).toBe(false);
  });

  it("a successful retry restarts the answer wait", () => {
    const send = tracingSend(() => true);
    renderComposer(send);

    submitAndWaitForOffer("did this run?");
    // The delivery already restarted it once, for the draft itself.
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    // ...and the draft was spent by that delivery, so there is nothing in the
    // field for the retry to resend even by accident.
    expect(field().value).toBe("");

    act(() => {
      retryButton()?.click();
    });

    // The reply is still owed an answer — the Return has just been pressed on
    // it a second time — so the pane goes back to waiting for one.
    expect(onSubmitted).toHaveBeenCalledTimes(2);
    expect(field().value).toBe("");
    expect(noticeText()).toBe("");
  });
});

/**
 * The store's optional generation, which no composer path reaches.
 *
 * Every call the composer makes carries the generation its own submit was
 * handed — deliberately, and the tests above pin it. That leaves
 * `clearRetryTicket`'s bare form with no caller at all in this feature, and a
 * reviewer duly made that branch a no-op with the whole store suite green. It
 * is part of the published contract (`clearRetryTicket(sessionId, generation?)`)
 * and the lifecycle work ahead of this is where a caller with no generation to
 * quote would come from, so it is pinned here rather than left as a shape in
 * the signature that nothing proves.
 */
describe("a clear with no generation", () => {
  it("takes whatever ticket the session is holding", () => {
    const generation = beginRetryTicket(SESSION);
    armRetryOffer(SESSION, generation);
    expect(watches).toEqual({ opened: 1, closed: 0 });

    clearRetryTicket(SESSION);

    expect(watches).toEqual({ opened: 1, closed: 1 });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(RETRY_OFFER_MS * 2);
    expect(isRetryOffered(SESSION)).toBe(false);
  });
});
