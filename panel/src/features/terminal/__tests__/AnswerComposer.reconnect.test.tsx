/**
 * The composer on a socket that is not there: a reply that waits for the
 * reconnect, the retry ticket a send opens, and the pending row that says so.
 *
 * One file, one `describe` per former file (`AnswerComposer.reconnectWait`,
 * `.retryEnter`, `.pendingRow`); each section keeps its own fixtures and
 * hooks, and its original header sits above it.
 *
 * Module mocks are file-wide, so they are listed once here. The pool is the
 * composer's stub of it, shared by the family (`answerPane.mocks.tsx`): the
 * handshake is answered by hand through `pool`. The activity channel and the
 * retry store are WRAPPED, not replaced, for the retry section (see its
 * header) — every function still does what it does, so the other sections
 * meet the real modules.
 */
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDraft, __resetComposerDraftsForTests } from "../composerDrafts";
import { __resetPtySubmitForTests, SUBMIT_RETURN_MS } from "../ptySubmit";
import type { ConnectionState } from "../terminalInstances";
import { installMatchMedia, StubResizeObserver } from "../../../test-utils";
import { onSubmitted, pool, renderComposer } from "./answerPane.harness";
import {
  RETRY_OFFER_MS,
  __resetAnswerRetryForTests,
  armRetryOffer,
  beginRetryTicket,
  clearRetryTicket,
  isRetryOffered,
} from "../answerRetry";
import { _applyEventForTests, _resetForTests } from "../useTerminalActivityChannel";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The pool is somebody else's subject, and jsdom has no socket under any of
// this. What is replaced is exactly the four entry points this gesture reaches
// — the composer's own focus repair and dismiss, and the three `ptySubmit`
// asks the pool for — so the handshake can be answered by hand.
vi.mock("../terminalInstances", async () => (await import("./answerPane.mocks")).terminalInstancesMock());

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

/**
 * A reply survives the wait for a reconnect.
 *
 * ## The regression this exists for
 *
 * `submitToPty` now rebuilds a dead socket and offers a refused body to the
 * replacement once, which means the verdict on a submit can arrive up to
 * `RECONNECT_WAIT_MS` — three seconds — after the user pressed Enter. The
 * composer was still clearing its field BEFORE the submit and putting the text
 * back from `onFailed`, which was written when that callback was synchronous.
 * Against a pooled-but-disconnected cell that left two defects:
 *
 * - for three seconds the reply was gone from the screen with no failure
 *   notice and nothing saying a send was in flight — the user had an empty box
 *   and no reason to believe anything had happened;
 * - and a user who used those three seconds to type a NEW reply had it
 *   overwritten when the late restore ran. That is data loss, and it is the
 *   half no amount of squinting at the empty box would have caught.
 *
 * The rule the design already carried is the fix: the draft is kept until the
 * frame is DELIVERED. So the clear moved into `onDelivered`, which on a live
 * socket still runs inside the same event handler — nothing about the happy
 * path feels slower — and on the reconnect path runs when the retry lands.
 *
 * ## Why the session here is pooled and disconnected
 *
 * `sendOnDeadSocket.test.tsx` is the other half of this subject and every
 * session in it is UNATTACHED: there is no socket to rebuild, so the refusal
 * is reported synchronously and the wait this file is about never happens.
 * The pool is mocked here instead, so the cell has an instance, the reconnect
 * path is taken, and the handshake's verdict is delivered by hand — which is
 * the only way a three-second window can be stood still in and looked at.
 */
describe("reconnect wait", () => {
  const SESSION = "cell-a";

  /**
   * Hand a connection verdict to everything subscribed for the cell.
   *
   * Over a COPY of the set, because that is what production does:
   * `emitConnectionState` iterates `[...listeners]`. A listener added DURING an
   * emit is therefore visited by a naive mock and never by the real thing — and
   * this emit is precisely where one is added, because a queued submit
   * subscribes from inside the settle of the submit ahead of it. A double more
   * forgiving than production masks exactly the re-entrancy these tests exist to
   * find.
   */
  function emit(state: ConnectionState): void {
    act(() => {
      for (const cb of [...(pool.listeners.get(SESSION) ?? [])]) cb(state);
    });
  }

  /** What the pool emits when the replacement socket finishes its handshake. */
  function socketCameBack(): void {
    emit("connected");
  }

  /** What the pool emits when the replacement socket fails to open. */
  function socketStayedDown(): void {
    emit("disconnected");
  }

  const field = (): HTMLTextAreaElement =>
    screen.getByTestId(`answer-pane-composer-${SESSION}`) as HTMLTextAreaElement;

  /**
   * The pane's one notice row — the same element for both verdicts. A pending
   * send and a refused one are the same fact at two moments, so reusing the row
   * is what keeps the composer from growing a second surface that says almost
   * the same thing one line further down.
   */
  const notice = (): HTMLElement | null =>
    screen.queryByTestId(`answer-pane-send-failed-${SESSION}`);

  const noticeText = (): string => notice()?.textContent ?? "";

  /** Types a reply and presses the key that sends it. */
  function submit(text: string): void {
    fireEvent.change(field(), { target: { value: text } });
    fireEvent.keyDown(field(), { key: "Enter" });
  }

  beforeEach(() => {
    __resetPtySubmitForTests();
    __resetComposerDraftsForTests();
    pool.listeners.clear();
    pool.connectionState = "disconnected";
    onSubmitted.mockClear();
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    installMatchMedia();
  });

  afterEach(() => {
    __resetPtySubmitForTests();
    vi.unstubAllGlobals();
  });

  describe("a reply survives the wait for a reconnect", () => {
    it("a delivered send clears the composer immediately", () => {
      pool.connectionState = "connected";
      const send = vi.fn((_data: string) => true);
      renderComposer(send);

      submit("ship it");

      // Synchronously, inside the same event handler the Enter ran in: the
      // delivery callback fires where the write does, so moving the clear into
      // it costs the happy path nothing. A field that emptied a tick later
      // would show the user their own text flashing back at them.
      expect(field().value).toBe("");
      expect(getDraft(SESSION)).toBe("");
      expect(notice()).toBeNull();
    });

    it("a send awaiting a reconnect keeps the text on screen", () => {
      const send = vi.fn((_data: string) => false);
      renderComposer(send);

      submit("my carefully written reply");

      // The verdict is up to three seconds away. Until it lands nothing is
      // known, so nothing is consumed: the reply stays in the field and in the
      // store the field is rebuilt from, exactly where the user left it.
      expect(field().value).toBe("my carefully written reply");
      expect(getDraft(SESSION)).toBe("my carefully written reply");
      // And nothing is claimed either. A failure notice now would be a verdict
      // on a reconnect that has not answered.
      expect(noticeText()).not.toMatch(/not sent/i);
    });

    it("a send awaiting a reconnect shows a pending indication", () => {
      const send = vi.fn((_data: string) => false);
      renderComposer(send);

      submit("did this go?");

      // Three seconds of a full box and a send that visibly did nothing is
      // indistinguishable from an Enter that was swallowed. The row says a send
      // is in flight, in the place the verdict will replace it.
      expect(noticeText()).toMatch(/sending/i);
    });

    it("a delivered retry clears the composer", () => {
      let open = false;
      const send = vi.fn((_data: string) => open);
      renderComposer(send);

      submit("ship it");
      expect(field().value).toBe("ship it");

      open = true;
      socketCameBack();

      // The frame is on the far side now, so the draft is spent — and the
      // pending row goes with it, because the wait it described is over.
      expect(field().value).toBe("");
      expect(getDraft(SESSION)).toBe("");
      expect(notice()).toBeNull();
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });

    it("a failed retry keeps the text and shows the failure", () => {
      const send = vi.fn((_data: string) => false);
      renderComposer(send);

      submit("did this go?");
      socketStayedDown();

      // Exactly where a refusal leaves the user today: the reply is still
      // theirs, and the pane says it did not go. The design's own invariant —
      // a failed reconnect costs the user nothing but the wait.
      expect(field().value).toBe("did this go?");
      expect(getDraft(SESSION)).toBe("did this go?");
      expect(noticeText()).toMatch(/not sent/i);
      expect(onSubmitted).not.toHaveBeenCalled();
    });

    it("text typed during the wait survives a delivered retry", () => {
      let open = false;
      const send = vi.fn((_data: string) => open);
      renderComposer(send);

      submit("first reply");

      // The user does not sit and watch the three seconds. The field still held
      // their reply, so they carried on in it — which used to be the worst case
      // of all: the late callback wrote the OLD text over the new one.
      fireEvent.change(field(), { target: { value: "a whole new thought" } });

      open = true;
      socketCameBack();

      // The frame that went is the one that was submitted, and what is in the
      // field is what the user typed after it. The clear is conditional on the
      // field still holding the submitted text, so a field that has moved on is
      // left alone.
      expect(send.mock.calls).toEqual([["first reply"], ["first reply"]]);
      expect(field().value).toBe("a whole new thought");
      expect(getDraft(SESSION)).toBe("a whole new thought");
    });

    it("text typed during the wait survives a failed retry", () => {
      const send = vi.fn((_data: string) => false);
      renderComposer(send);

      submit("first reply");
      fireEvent.change(field(), { target: { value: "a whole new thought" } });

      socketStayedDown();

      // The C2 case, and the one that was live data loss: the refusal's own
      // restore wrote the submitted text back over what the user had typed in
      // the three seconds since. Nothing is restored now because nothing was
      // ever taken away, so a late verdict has nothing to put back.
      expect(field().value).toBe("a whole new thought");
      expect(getDraft(SESSION)).toBe("a whole new thought");
      // The news is still delivered — it is about a reply that did not go, and
      // the user needs to know that whatever is in the field now.
      expect(noticeText()).toMatch(/not sent/i);
    });
  });
});

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
describe("retry", () => {
  const SESSION = "cell-a";

  /** A `send` that records every frame on the shared trace beside the consume. */
  function tracingSend(accepts: (data: string) => boolean) {
    return vi.fn((data: string) => {
      const ok = accepts(data);
      trace.steps.push(`write:${JSON.stringify(data)}:${ok}`);
      return ok;
    });
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
    pool.connectionState = "connected";
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
      pool.connectionState = "unattached";
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
});

/**
 * The composer's pending row: legible, announced, and outliving more than one
 * send.
 *
 * the "reconnect wait" section established WHEN the row appears —
 * the three-second reconnect wait is the window it exists for. This file is
 * the three things about it that a reviewer had to probe for, because reading
 * the code told you the opposite of what it did.
 *
 * ## The contrast failure
 *
 * The pending ink was `--text-tertiary` (`#6d6b67`) inline, on the row's own
 * `#17171d`. That measures **3.36:1**, against WCAG AA's 4.5:1 for normal
 * text — and this row is 10px JetBrains Mono, which is as far from the
 * "large text" exemption as type gets. `--text-secondary` (`#9d9b97`) measures
 * **6.43:1** on the same ground, and is still visibly quieter than the
 * refusal's `--red`.
 *
 * The ratio is computed here rather than asserted as a number somebody once
 * measured: a token nudged a shade darker, or a row given a lighter
 * background, has to fail this file rather than pass it because the
 * arithmetic lived in a comment.
 *
 * The Retry Enter control is measured here for the same reason and by the same
 * arithmetic, which is why it is in this file rather than beside its own
 * behavioural tests: it is the same 10px JetBrains Mono on the same strip, and
 * it is the WORSE case of the two. Its ground is `--accent-dim`, a 15% tint —
 * so the colour its ink is actually read against appears nowhere in the
 * stylesheet, and BOTH the tint and the surface under it can move a ratio
 * nobody can see. A composited pair is exactly the pair a reviewer has no way
 * to check by eye.
 *
 * ## The role that did not take effect
 *
 * The row flips `role="status"` to `role="alert"` between the wait and the
 * verdict, and the comment above it says why: the verdict is news the user
 * cannot get any other way, and the wait is a progress note that will be
 * replaced within three seconds. But live-region politeness is computed when
 * the region is ATTACHED, and the row was one reused DOM node — the same
 * element, re-labelled in place. An in-place role change is not reliably
 * re-evaluated, so the verdict was likely announced politely: exactly the
 * distinction the comment wanted, silently not made. A `key` that changes
 * between the two states makes React remount the element, which attaches a
 * fresh region with the role it is meant to have.
 *
 * ## The row that vanished under a second send
 *
 * The state behind the row used to be a boolean, with a comment claiming "at
 * most one submit can be unsettled here at a time". `submit()` has no guard,
 * so that was simply untrue: a second Enter on a flapping socket enqueues a
 * second submit, the first settles and clears the flag, and the second spends
 * its whole three-second wait with no row at all — which is precisely the
 * symptom the row was added to remove. A counter survives until the LAST
 * outstanding submit settles.
 */
describe("pending row", () => {
  const SESSION = "cell-a";

  /**
   * Hand a connection verdict to everything subscribed for the cell.
   *
   * Over a COPY of the set, because that is what production does:
   * `emitConnectionState` iterates `[...listeners]`. A listener added DURING an
   * emit is visited by a naive mock and never by the real thing — and a queued
   * submit subscribes from inside the settle of the submit ahead of it, which is
   * the whole shape of the two-submits test below.
   */
  function emit(state: ConnectionState): void {
    act(() => {
      for (const cb of [...(pool.listeners.get(SESSION) ?? [])]) cb(state);
    });
  }

  const field = (): HTMLTextAreaElement =>
    screen.getByTestId(`answer-pane-composer-${SESSION}`) as HTMLTextAreaElement;

  /** The pane's one notice row — the same testid for both verdicts. */
  const notice = (): HTMLElement | null =>
    screen.queryByTestId(`answer-pane-send-failed-${SESSION}`);

  const noticeText = (): string => notice()?.textContent ?? "";

  /** Types a reply and presses the key that sends it. */
  function submit(text: string): void {
    fireEvent.change(field(), { target: { value: text } });
    fireEvent.keyDown(field(), { key: "Enter" });
  }

  // Walked at test time, exactly as `SpeechControlBar.test.tsx` walks it:
  // `src/features/terminal/__tests__` → `src/index.css`. Comments are stripped
  // first — the stylesheet documents every rule, and a comment sitting in front
  // of one would otherwise be read as part of its selector list.
  const css = readFileSync(join(__dirname, "..", "..", "..", "index.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  /** The declarations the stylesheet makes for one exact selector, in cascade order. */
  function declarationsOf(selector: string): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const [, selectorList, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!selectorList.split(",").some((one) => one.trim() === selector)) continue;
      for (const declaration of body.split(";")) {
        const at = declaration.indexOf(":");
        if (at === -1) continue;
        merged[declaration.slice(0, at).trim()] = declaration.slice(at + 1).trim();
      }
    }
    return merged;
  }

  /** A design token's value, read off the one `:root` block that defines it. */
  function tokenValue(name: string): string {
    const found = css.match(new RegExp(`${name}:\\s*([^;]+);`));
    if (!found) throw new Error(`no such token in index.css: ${name}`);
    return found[1].trim();
  }

  /** WCAG 2.x relative luminance of a `#rrggbb`. */
  function luminance(hex: string): number {
    const channel = (at: number): number => {
      const c = parseInt(hex.slice(at, at + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  }

  /** WCAG 2.x contrast ratio between two `#rrggbb` colours. */
  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  /**
   * An `rgba(...)` laid over an opaque `#rrggbb`, as the compositor lays it.
   *
   * Needed because a translucent background is not a colour anything can be
   * measured against: WCAG ratios are defined on what the eye receives, which
   * here is the strip's own ground seen through the tint. Doing the blend in the
   * test is what makes a nudge to EITHER — the tint's alpha, the accent, the
   * pane's surface — land as a failure instead of as a shade nobody notices.
   */
  function over(rgba: string, backdrop: string): string {
    const inside = rgba.match(/rgba?\(([^)]+)\)/);
    if (!inside) throw new Error(`not an rgb/rgba colour: ${rgba}`);
    const [r, g, b, alpha = 1] = inside[1].split(",").map((part) => Number(part.trim()));
    const blend = (front: number, at: number): string =>
      Math.round(front * alpha + parseInt(backdrop.slice(at, at + 2), 16) * (1 - alpha))
        .toString(16)
        .padStart(2, "0");
    return `#${blend(r, 1)}${blend(g, 3)}${blend(b, 5)}`;
  }

  beforeEach(() => {
    __resetPtySubmitForTests();
    __resetComposerDraftsForTests();
    pool.listeners.clear();
    pool.connectionState = "disconnected";
    onSubmitted.mockClear();
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    installMatchMedia();
  });

  afterEach(() => {
    __resetPtySubmitForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("the pending row is legible", () => {
    it("is painted from the stylesheet, not from an inline style", () => {
      const send = vi.fn((_data: string) => false);
      renderComposer(send);

      submit("did this go?");

      // The row's own colour is `--red`, which is right for a refusal and a lie
      // about a send that is merely in progress — so the pending state needs a
      // colour of its own. It belongs in the stylesheet beside the rule it
      // overrides, where the next person changing either can see both.
      expect(notice()?.getAttribute("data-state")).toBe("pending");
      expect(notice()?.getAttribute("style")).toBeNull();
      expect(declarationsOf('.answer-pane-send-failed[data-state="pending"]').color).toBe(
        "var(--text-secondary)",
      );
    });

    it("clears WCAG AA against the row's own background", () => {
      const background = declarationsOf(".answer-pane-send-failed").background;
      const ink = tokenValue("--text-secondary");

      // 10px JetBrains Mono is normal text by every reading of the large-text
      // exemption — 18.66px bold or 24px — so the bar is 4.5:1 and not 3:1.
      // `--text-tertiary`, which this row used to use, measures 3.36:1 here and
      // fails; `--text-secondary` measures 6.43:1.
      expect(contrast(ink, background)).toBeGreaterThanOrEqual(4.5);
      // ...and the failure's own ink has to keep clearing it too: the row is one
      // element with two states, and moving the pending colour must not be taken
      // as a licence to leave the other one unmeasured.
      expect(contrast(tokenValue("--red"), background)).toBeGreaterThanOrEqual(4.5);
    });

    it("clears WCAG AA for the Retry Enter control on its tinted ground", () => {
      const rule = declarationsOf(".answer-pane-retry-enter");
      // Read off the stylesheet by token name and not by literal, so that the
      // blend below is measuring the colours the button will actually wear: a
      // rule repainted with some other pair has to arrive here as a mismatch
      // rather than quietly go on scoring the old one.
      expect(rule.color).toBe("var(--accent)");
      expect(rule.background).toBe("var(--accent-dim)");

      // The button paints no opaque ground of its own — `--accent-dim` is 15%
      // accent, and what shows through is whatever `.answer-pane` painted, which
      // is the same #17171d the notice row above states outright.
      const ground = over(tokenValue("--accent-dim"), declarationsOf(".answer-pane").background);

      // Same bar as the row it sits beside, and for the same reason: 10px
      // JetBrains Mono is normal text, so 4.5:1 and not 3:1. `--accent`
      // (#e5a84b) on that composite measures about 6.9:1 — comfortable, and
      // comfortable only as long as nothing moves either end of it.
      expect(contrast(tokenValue("--accent"), ground)).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe("the verdict is announced rather than re-labelled in place", () => {
    it("remounts the row when the wait becomes a refusal", () => {
      const send = vi.fn((_data: string) => false);
      renderComposer(send);

      submit("did this go?");
      const whileWaiting = notice();
      expect(whileWaiting?.getAttribute("role")).toBe("status");

      socketStayedDown();

      const verdict = notice();
      expect(verdict?.getAttribute("role")).toBe("alert");
      expect(noticeText()).toMatch(/not sent/i);
      // A live region's politeness is computed when the region is ATTACHED, so a
      // role swapped on a node that never left the document is not reliably
      // re-evaluated: the assertive verdict would be announced politely, which
      // is exactly the distinction the row's comment says it wants. The `key`
      // change is what makes React attach a new region.
      expect(verdict).not.toBe(whileWaiting);
    });
  });

  describe("the pending row survives a second send", () => {
    it("stays up until the last outstanding submit settles", () => {
      // A flapping socket: the body is refused, then accepted, then refused
      // again. The submitting RETURN always lands — it is a single byte on a
      // socket that was open a moment ago — so nothing here is a refused return.
      let bodyOpen = false;
      const send = vi.fn((data: string) => (data === "\r" ? true : bodyOpen));
      renderComposer(send);

      submit("first reply");
      expect(noticeText()).toMatch(/sending/i);

      // A second Enter, with the field still holding the reply because nothing
      // has been delivered. `submitToPty` has a submit in flight for this
      // session, so this one is ENQUEUED behind it — no guard anywhere stops the
      // user from doing this, which is the whole point.
      fireEvent.keyDown(field(), { key: "Enter" });

      // The socket comes back, and the first submit's one retry lands on it.
      bodyOpen = true;
      socketCameBack();
      expect(field().value).toBe("");
      expect(onSubmitted).toHaveBeenCalledTimes(1);

      // ...and flaps straight back down. The queued submit gets its turn a
      // return-gap later, is refused, and starts a three-second wait of its own.
      bodyOpen = false;
      act(() => {
        vi.advanceTimersByTime(SUBMIT_RETURN_MS);
      });

      // A boolean cleared by the FIRST submit's delivery leaves this second wait
      // with no row at all: three seconds of an empty box and a send that
      // visibly did nothing, which is indistinguishable from an Enter that was
      // swallowed — the exact symptom the row exists to remove.
      expect(noticeText()).toMatch(/sending/i);
      expect(notice()?.getAttribute("data-state")).toBe("pending");

      // And it comes down when that last submit settles, not before and not
      // after.
      socketStayedDown();
      expect(noticeText()).toMatch(/not sent/i);
    });
  });

  /** What the pool emits when the replacement socket finishes its handshake. */
  function socketCameBack(): void {
    emit("connected");
  }

  /** What the pool emits when the replacement socket fails to open. */
  function socketStayedDown(): void {
    emit("disconnected");
  }
});
