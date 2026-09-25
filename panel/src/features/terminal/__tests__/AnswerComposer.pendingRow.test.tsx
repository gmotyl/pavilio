/**
 * The composer's pending row: legible, announced, and outliving more than one
 * send.
 *
 * `AnswerComposer.reconnectWait.test.tsx` established WHEN the row appears —
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
import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnswerComposer } from "../AnswerComposer";
import { __resetComposerDraftsForTests } from "../composerDrafts";
import { __resetPtySubmitForTests, SUBMIT_RETURN_MS } from "../ptySubmit";
import type { ConnectionState } from "../terminalInstances";

/** Connection-state subscribers, by session — the retry's wake-up signal. */
const listeners = new Map<string, Set<(state: ConnectionState) => void>>();

/** A cell with an instance in the pool whose socket is down: repairable. */
let connectionState: ConnectionState = "disconnected";

// The pool is somebody else's subject, and jsdom has no socket under any of
// this. What is replaced is exactly the entry points this gesture reaches, so
// the handshake can be answered by hand.
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
    for (const cb of [...(listeners.get(SESSION) ?? [])]) cb(state);
  });
}

const onSubmitted = vi.fn();

function renderComposer(send: (data: string) => boolean) {
  return render(<AnswerComposer sessionId={SESSION} send={send} onSubmitted={onSubmitted} />);
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

beforeEach(() => {
  __resetPtySubmitForTests();
  __resetComposerDraftsForTests();
  listeners.clear();
  connectionState = "disconnected";
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
