/**
 * The desktop composer grows with its content: from its height (the dragged one,
 * or the declared two-row default) up to `max(that height, 10 rows)`, then the
 * field scrolls. Sending returns the row to the dragged height.
 *
 * jsdom does no layout, so `scrollHeight` and the computed styles are stubbed.
 * The stub is realistic in the way that matters: like a browser, a field that
 * is stretched to its row reports a `scrollHeight` of at least its rendered
 * (row-derived) height, so a measurement that reads the field while it is
 * stretched would feed the row's height back into itself and never shrink.
 * Only with `height: auto` / `flex: none` (its natural size) does it report
 * just its content plus padding.
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

/** Field padding (top + bottom), field border, row padding: the chrome. */
const FIELD_PAD = 7;
const FIELD_BORDER = 1;
const ROW_PAD = 3;
const CHROME = 2 * FIELD_PAD + 2 * FIELD_BORDER + 2 * ROW_PAD;

/** The field's content height (lines × line height). */
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
      if (!isField(this)) return 0;
      const natural = scrollHeightPx + 2 * FIELD_PAD;
      if (this.style.height === "auto" || this.style.flex === "none") return natural;
      // Stretched to the row: the rendered client height is the row's height
      // minus the row padding and the field's border.
      const rowEl = this.closest(".answer-pane-composer") as HTMLElement | null;
      const rendered = rowEl ? Number.parseFloat(rowEl.style.height) - 2 * ROW_PAD - 2 * FIELD_BORDER : 0;
      return Math.max(natural, Number.isFinite(rendered) ? rendered : 0);
    },
  });
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    if (element instanceof Element && isField(element)) {
      return {
        lineHeight: `${LH}px`,
        paddingTop: `${FIELD_PAD}px`,
        paddingBottom: `${FIELD_PAD}px`,
        borderTopWidth: `${FIELD_BORDER}px`,
        borderBottomWidth: `${FIELD_BORDER}px`,
      } as unknown as CSSStyleDeclaration;
    }
    if (element instanceof Element && element.classList.contains("answer-pane-composer")) {
      return {
        paddingTop: `${ROW_PAD}px`,
        paddingBottom: `${ROW_PAD}px`,
        borderTopWidth: "0px",
        borderBottomWidth: "0px",
      } as unknown as CSSStyleDeclaration;
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
    // The stubbed chrome makes two rows exactly the declared default.
    expect(2 * LH + CHROME).toBe(base);

    // Typing on one line must not creep the row up keystroke by keystroke.
    type("a", 1);
    type("ab", 1);
    type("abc", 1);
    expect(rowHeight()).toBe(base);

    type("one\ntwo\nthree\nfour", 4);
    const four = rowHeight();
    expect(four).toBe(base + 2 * LH);

    type("x\n".repeat(10), 10);
    const ten = rowHeight();
    expect(ten).toBe(base + 8 * LH);

    type("x\n".repeat(30), 30);
    expect(rowHeight()).toBe(ten);

    // Deleting text shrinks it back.
    type("one\ntwo\nthree\nfour", 4);
    expect(rowHeight()).toBe(four);
    type("", 1);
    expect(rowHeight()).toBe(base);
  });

  it("dragged height is the floor", () => {
    installMatchMedia();
    const chrome = CHROME;
    const five = 5 * LH + chrome;
    writePreference(preferences.answerComposerHeight, five, PROJECT);
    mount();
    expect(rowHeight()).toBe(five);

    type("one line", 1);
    expect(rowHeight()).toBe(five);
  });

  it("dragged height above ten rows is the cap", () => {
    installMatchMedia();
    const chrome = CHROME;
    const tall = 12 * LH + chrome;
    writePreference(preferences.answerComposerHeight, tall, PROJECT);
    mount();

    type("x\n".repeat(30), 30);
    expect(rowHeight()).toBe(tall);
  });

  it("sending returns to dragged height", () => {
    installMatchMedia();
    const chrome = CHROME;
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
