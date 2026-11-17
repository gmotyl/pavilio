/**
 * The desktop composer grows with its content: from its height (the dragged one,
 * or the declared two-row default) up to `max(that height, 10 rows)`, then the
 * field scrolls. Sending returns the row to the dragged height.
 *
 * jsdom does no layout, so `scrollHeight` and the field's `line-height` are
 * stubbed the same way `AnswerComposer.send.test.tsx`'s autogrow section does.
 * Assertions are relational: the row's height against the stored height and
 * against each other, not against a stylesheet literal.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import { AnswerComposer } from "../AnswerComposer";
import { __resetComposerDraftsForTests } from "../composerDrafts";
import { __resetPtySubmitForTests } from "../ptySubmit";
import { refreshSessions } from "../sessionStore";
import { installMatchMedia, StubResizeObserver } from "../../../test-utils";

const SESSION = "cell-a";
const PROJECT = "alpha";
const LH = 20;

const isField = (element: Element): boolean => element.classList.contains("answer-pane-composer-field");

let scrollHeightPx = 2 * LH;
let savedScrollHeight: PropertyDescriptor | undefined;
const REAL_GET_COMPUTED_STYLE = window.getComputedStyle.bind(window);

const field = (): HTMLTextAreaElement => screen.getByTestId(`answer-pane-composer-${SESSION}`) as HTMLTextAreaElement;
const row = (): HTMLElement => field().closest(".answer-pane-composer") as HTMLElement;
const rowHeight = (): number => Number.parseFloat(row().style.height);

function type(value: string, rows: number): void {
  scrollHeightPx = rows * LH;
  fireEvent.change(field(), { target: { value } });
}

function mount(send: (data: string) => boolean = () => true) {
  return render(<AnswerComposer sessionId={SESSION} send={send} onSubmitted={vi.fn()} />);
}

beforeEach(async () => {
  __resetPtySubmitForTests();
  __resetComposerDraftsForTests();
  scrollHeightPx = 2 * LH;
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve([
            { id: SESSION, name: SESSION, project: PROJECT, cwd: "/x", pid: 1, createdAt: "2026-01-01T00:00:00.000Z" },
          ]),
      } as unknown as Response),
    ),
  );
  await refreshSessions();
  savedScrollHeight = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      return isField(this) ? scrollHeightPx : 0;
    },
  });
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    if (element instanceof Element && isField(element)) {
      return { lineHeight: `${LH}px` } as unknown as CSSStyleDeclaration;
    }
    return REAL_GET_COMPUTED_STYLE(element, pseudo ?? undefined);
  });
});

afterEach(() => {
  __resetPtySubmitForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (savedScrollHeight) Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", savedScrollHeight);
  else delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>).scrollHeight;
});

describe("desktop composer growth", () => {
  it("desktop composer grows to ten rows then scrolls", () => {
    installMatchMedia();
    mount();
    const base = rowHeight();
    expect(base).toBe(preferences.answerComposerHeight.default);

    type("one\ntwo\nthree\nfour", 4);
    const four = rowHeight();
    expect(four).toBe(base + 2 * LH);

    type("x\n".repeat(10), 10);
    const ten = rowHeight();
    expect(ten).toBe(base + 8 * LH);

    type("x\n".repeat(30), 30);
    expect(rowHeight()).toBe(ten);
  });

  it("dragged height is the floor", () => {
    installMatchMedia();
    const chrome = preferences.answerComposerHeight.default - 2 * LH;
    const five = 5 * LH + chrome;
    writePreference(preferences.answerComposerHeight, five, PROJECT);
    mount();
    expect(rowHeight()).toBe(five);

    type("one line", 1);
    expect(rowHeight()).toBe(five);
  });

  it("dragged height above ten rows is the cap", () => {
    installMatchMedia();
    const chrome = preferences.answerComposerHeight.default - 2 * LH;
    const tall = 12 * LH + chrome;
    writePreference(preferences.answerComposerHeight, tall, PROJECT);
    mount();

    type("x\n".repeat(30), 30);
    expect(rowHeight()).toBe(tall);
  });

  it("sending returns to dragged height", () => {
    installMatchMedia();
    const chrome = preferences.answerComposerHeight.default - 2 * LH;
    const three = 3 * LH + chrome;
    writePreference(preferences.answerComposerHeight, three, PROJECT);
    const send = vi.fn((_data: string) => true);
    mount(send);

    type("a reply grown tall", 8);
    expect(rowHeight()).toBeGreaterThan(three);

    scrollHeightPx = 2 * LH;
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(send.mock.calls[0]?.[0]).toBe("a reply grown tall");
    expect(field().value).toBe("");
    expect(rowHeight()).toBe(three);
  });

  it("mobile growth unchanged", () => {
    installMatchMedia({ mobile: true });
    mount();
    type("x\n".repeat(30), 30);
    expect(field().style.height).toBe(`${6 * LH}px`);
    expect(row().style.height).toBe("");
  });
});
