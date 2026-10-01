/**
 * The typed `/` that opens the skill picker: at any word start in the draft,
 * never inside a word and never from a paste — and, once the picker is open,
 * Enter and Tab belong to it while there is something to pick.
 *
 * Set up as `AnswerComposer.commandChip.test.tsx`: the composer on its own,
 * with one `fetch` stub answering the skills list.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnswerComposer } from "../AnswerComposer";
import type { SkillEntry } from "../commandSource";
import { __resetPtySubmitForTests } from "../ptySubmit";

const SKILLS: SkillEntry[] = [
  { name: "pavilio-grill", description: "Stress-test an idea", path: "skills/pavilio-grill/SKILL.md" },
  {
    name: "pavilio-question",
    description: "Answer questions from notes",
    path: "skills/pavilio-question/SKILL.md",
  },
  { name: "pavilio-note", description: "Process a meeting transcript", path: "skills/pavilio-note/SKILL.md" },
];

const send = vi.fn((_data: string) => true);
const onSubmitted = vi.fn();

const fetchFn = vi.fn((_url: string) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SKILLS) }),
);

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

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

function renderComposer() {
  return render(<AnswerComposer sessionId="cell-a" send={send} onSubmitted={onSubmitted} />);
}

const field = (): HTMLTextAreaElement =>
  screen.getByTestId("answer-pane-composer-cell-a") as HTMLTextAreaElement;

/** Put the caret at `at` in the focused field, as a click or arrow key would. */
const caretAt = (at: number): void => {
  field().setSelectionRange(at, at);
  fireEvent.select(field());
};

/** The open picker, once its own load has answered and it shows `count` options. */
async function pickerWith(count: number): Promise<HTMLElement> {
  const listbox = await screen.findByRole("listbox");
  await waitFor(() => expect(within(listbox).queryAllByRole("option")).toHaveLength(count));
  return listbox;
}

beforeEach(() => {
  send.mockClear();
  onSubmitted.mockClear();
  fetchFn.mockClear();
  __resetPtySubmitForTests();
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  vi.stubGlobal("fetch", fetchFn);
  installMatchMedia();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AnswerComposer slash trigger", () => {
  it("a slash after a space opens the picker mid-draft", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    await user.keyboard("do some stuff /");
    await screen.findByRole("listbox");
    await user.keyboard("note");
    // `pavilio-question` matches too, on its description; the name match leads.
    const listbox = await pickerWith(2);
    expect(within(listbox).getByRole("option", { selected: true })).toHaveAttribute(
      "data-name",
      "pavilio-note",
    );
    await user.keyboard("{Enter}");

    expect(field().value).toBe("do some stuff /pavilio-note");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("a slash typed mid-draft replaces only its own token on pick", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    await user.keyboard("fix  later");
    caretAt("fix ".length);
    await user.keyboard("/gri");
    await pickerWith(1);
    await user.keyboard("{Enter}");

    expect(field().value).toBe("fix /pavilio-grill later");
    expect(field().selectionStart).toBe("fix /pavilio-grill".length);
    expect(send).not.toHaveBeenCalled();
  });

  it("a slash inside a word stays text", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    await user.keyboard("see src/");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field().value).toBe("see src/");
  });

  it("a slash typed right before a word stays text", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    await user.keyboard("fix note");
    caretAt("fix ".length);
    await user.keyboard("/");

    // The word after the slash would become the query, and a pick would
    // replace it — the user's own text, gone.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field().value).toBe("fix /note");
  });

  it("Enter with no match closes the picker and sends nothing", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    await user.keyboard("/clear");
    await pickerWith(0);
    await screen.findByText("No skill matches.");
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field().value).toBe("/clear");
    expect(send).not.toHaveBeenCalled();

    // With the picker gone, Enter is the send key again.
    await user.keyboard("{Enter}");
    await waitFor(() => expect(send.mock.calls).toEqual([["/clear"], ["\r"]]));
  });

  it("Tab inserts the highlighted skill and keeps focus", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    await user.keyboard("/gri");
    await pickerWith(1);
    const notPrevented = fireEvent.keyDown(field(), { key: "Tab" });

    expect(notPrevented).toBe(false);
    expect(field().value).toBe("/pavilio-grill");
    expect(document.activeElement).toBe(field());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("Tab with no match is left to the browser", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    await user.keyboard("/clear");
    await pickerWith(0);
    await screen.findByText("No skill matches.");

    expect(fireEvent.keyDown(field(), { key: "Tab" })).toBe(true);
    expect(field().value).toBe("/clear");

    // Shift+Tab is never the picker's, even with an entry highlighted.
    await user.clear(field());
    await user.keyboard("/gri");
    await pickerWith(1);
    expect(fireEvent.keyDown(field(), { key: "Tab", shiftKey: true })).toBe(true);
    expect(field().value).toBe("/gri");
    expect(send).not.toHaveBeenCalled();
  });

  it("Escape then Enter sends a literal command", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    await user.keyboard("/compact");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(send.mock.calls).toEqual([["/compact"], ["\r"]]));
  });

  it("a pasted slash does not open the picker", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    // Ending on the slash, so the caret sits right after it with nothing
    // following — everything but the one-character check would let it open.
    await user.paste("a /");

    expect(field().value).toBe("a /");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
