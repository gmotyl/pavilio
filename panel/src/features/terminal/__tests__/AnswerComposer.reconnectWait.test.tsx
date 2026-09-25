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
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOBILE_QUERY } from "../../../lib/breakpoints";
import { AnswerComposer } from "../AnswerComposer";
import { getDraft, __resetComposerDraftsForTests } from "../composerDrafts";
import { __resetPtySubmitForTests } from "../ptySubmit";
import type { ConnectionState } from "../terminalInstances";

/** Connection-state subscribers, by session — the retry's wake-up signal. */
const listeners = new Map<string, Set<(state: ConnectionState) => void>>();

/** A cell with an instance in the pool whose socket is down: repairable. */
let connectionState: ConnectionState = "disconnected";

// The pool is somebody else's subject, and jsdom has no socket under any of
// this. What is replaced is exactly the four entry points this gesture reaches
// — the composer's own focus repair and dismiss, and the three `ptySubmit`
// asks the pool for — so the handshake can be answered by hand.
vi.mock("../terminalInstances", () => ({
  sendDismiss: () => {},
  reconnectOnActivate: () => {},
  getConnectionState: () => connectionState,
  hasExited: () => false,
  reconnectSession: () => {},
  onConnectionChange: (sessionId: string, cb: (state: ConnectionState) => void) => {
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

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** jsdom has no `matchMedia`, and the composer's grip asks it for the viewport. */
function installMatchMedia(mobile: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: mobile && query === MOBILE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

/** What the pool emits when the replacement socket finishes its handshake. */
function socketCameBack(): void {
  act(() => {
    for (const cb of listeners.get(SESSION) ?? []) cb("connected");
  });
}

/** What the pool emits when the replacement socket fails to open. */
function socketStayedDown(): void {
  act(() => {
    for (const cb of listeners.get(SESSION) ?? []) cb("disconnected");
  });
}

const onSubmitted = vi.fn();

function renderComposer(send: (data: string) => boolean) {
  return render(
    <AnswerComposer sessionId={SESSION} send={send} onSubmitted={onSubmitted} />,
  );
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
  listeners.clear();
  connectionState = "disconnected";
  onSubmitted.mockClear();
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  installMatchMedia(false);
});

afterEach(() => {
  __resetPtySubmitForTests();
  vi.unstubAllGlobals();
});

describe("a reply survives the wait for a reconnect", () => {
  it("a delivered send clears the composer immediately", () => {
    connectionState = "connected";
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
