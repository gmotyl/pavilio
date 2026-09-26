/**
 * The mobile composer's auto-grow: the field follows `scrollHeight` up to six
 * rows, and desktop's grip-driven height is left entirely alone.
 *
 * jsdom does no real layout, so `scrollHeight` reports `0` for every element
 * forever and `getComputedStyle` never resolves the stylesheet's unitless
 * `line-height: 1.5` into a pixel value the way a real engine does — the two
 * numbers the effect under test actually reads. Both are stubbed here rather
 * than asserted against a real render: `scrollHeight` as a getter on
 * `HTMLTextAreaElement.prototype`, filtered to the composer's own field the
 * same way `AnswerPane.test.tsx` filters its `scrollHeight` stub to the
 * pane's body (`isBody`); `getComputedStyle` as a `vi.spyOn` that answers a
 * fixed `line-height` for that field and falls through to the real
 * implementation for everything else, so nothing else in the tree notices.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOBILE_QUERY } from "../../../lib/breakpoints";
import { AnswerComposer } from "../AnswerComposer";
import { __resetComposerDraftsForTests } from "../composerDrafts";
import { __resetPtySubmitForTests } from "../ptySubmit";
import type { ConnectionState } from "../terminalInstances";

// The pool is somebody else's subject, and jsdom has no socket under any of
// this — see `AnswerComposer.pendingRow.test.tsx` for the fuller version of
// this same mock. Nothing here exercises a reconnect, so the stubs are inert.
vi.mock("../terminalInstances", () => ({
  sendDismiss: () => {},
  reconnectOnActivate: () => {},
  getConnectionState: () => "connected" as ConnectionState,
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

/** jsdom has no `matchMedia`, and the composer's grip hook asks it for the viewport. */
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

const isField = (element: Element): boolean =>
  element.classList.contains("answer-pane-composer-field");

/**
 * What the field's `scrollHeight` reports — the browser's own measurement of
 * how tall the content wants the box to be, which is exactly the number this
 * component's effect reads and jsdom never computes for real. A single
 * module-level knob because exactly one field exists per test.
 */
let scrollHeightPx = 40;

let savedScrollHeight: PropertyDescriptor | undefined;

function installScrollHeightStub(): void {
  savedScrollHeight = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      return isField(this) ? scrollHeightPx : 0;
    },
  });
}

function restoreScrollHeightStub(): void {
  if (savedScrollHeight) {
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", savedScrollHeight);
  } else {
    delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>).scrollHeight;
  }
}

/** The `line-height` the field's `getComputedStyle` answers with, in pixels —
 *  20px, the same fallback the component itself falls back to when a real
 *  stylesheet is not loaded, so a test that never touches this constant still
 *  exercises the same arithmetic the fallback path would. */
const LINE_HEIGHT_PX = 20;

/** Two rows' worth at the stubbed line height — the field's own floor. */
const MOBILE_COMPOSER_MIN_ROWS_PX = 2 * LINE_HEIGHT_PX;

const REAL_GET_COMPUTED_STYLE = window.getComputedStyle.bind(window);

function installGetComputedStyle(): void {
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    if (element instanceof Element && isField(element)) {
      return { lineHeight: `${LINE_HEIGHT_PX}px` } as unknown as CSSStyleDeclaration;
    }
    return REAL_GET_COMPUTED_STYLE(element, pseudo ?? undefined);
  });
}

const onSubmitted = vi.fn();

function renderComposer(send: (data: string) => boolean = vi.fn(() => true)) {
  return render(<AnswerComposer sessionId={SESSION} send={send} onSubmitted={onSubmitted} />);
}

const field = (): HTMLTextAreaElement =>
  screen.getByTestId(`answer-pane-composer-${SESSION}`) as HTMLTextAreaElement;

beforeEach(() => {
  __resetPtySubmitForTests();
  __resetComposerDraftsForTests();
  onSubmitted.mockClear();
  scrollHeightPx = MOBILE_COMPOSER_MIN_ROWS_PX;
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  installScrollHeightStub();
  installGetComputedStyle();
});

afterEach(() => {
  __resetPtySubmitForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreScrollHeightStub();
});

describe("the mobile composer grows with the reply", () => {
  it("on mobile the field grows with scrollHeight", () => {
    installMatchMedia(true);
    renderComposer();

    // A reply that wraps to four rows: the browser would report a taller
    // `scrollHeight`, which is exactly what is stubbed here.
    scrollHeightPx = 4 * LINE_HEIGHT_PX;
    fireEvent.change(field(), { target: { value: "one\ntwo\nthree\nfour" } });

    expect(field().style.height).toBe(`${4 * LINE_HEIGHT_PX}px`);
  });

  it("on mobile the field caps at six rows", () => {
    installMatchMedia(true);
    renderComposer();

    // Far more than six rows' worth — the field must not follow it past the cap.
    scrollHeightPx = 20 * LINE_HEIGHT_PX;
    fireEvent.change(field(), { target: { value: "a very long reply".repeat(20) } });

    expect(field().style.height).toBe(`${6 * LINE_HEIGHT_PX}px`);
  });

  it("sending returns the field to its minimum", () => {
    installMatchMedia(true);
    const send = vi.fn((_data: string) => true);
    renderComposer(send);

    scrollHeightPx = 8 * LINE_HEIGHT_PX;
    fireEvent.change(field(), { target: { value: "a reply grown tall" } });
    expect(field().style.height).toBe(`${6 * LINE_HEIGHT_PX}px`);

    // The moment the field empties, the browser's own `scrollHeight` for an
    // empty two-row field is two rows' worth — this is what "sending returns
    // the field to its minimum" falls out of, not a special case in the
    // component: the effect reruns on the cleared text and measures again.
    scrollHeightPx = MOBILE_COMPOSER_MIN_ROWS_PX;
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(send.mock.calls[0]?.[0]).toBe("a reply grown tall");
    expect(field().value).toBe("");
    expect(field().style.height).toBe(`${MOBILE_COMPOSER_MIN_ROWS_PX}px`);
  });

  it("on desktop the field height is left to the grip", () => {
    installMatchMedia(false);
    renderComposer();

    // Whatever a real browser would report here, the desktop field's own
    // inline height must stay untouched — the row's height on this viewport
    // is the grip's, not `scrollHeight`'s.
    scrollHeightPx = 20 * LINE_HEIGHT_PX;
    fireEvent.change(field(), { target: { value: "a very long reply".repeat(20) } });

    expect(field().style.height).toBe("");
    expect(field().rows).toBe(2);
  });
});
