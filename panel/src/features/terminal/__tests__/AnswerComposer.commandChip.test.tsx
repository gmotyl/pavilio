/**
 * The `/ skills` chip, which puts a skill in at the caret, and the portable
 * in-place expansion a known skill gets at send.
 *
 * The composer is rendered on its own, as in `AnswerComposer.paste.test.tsx`:
 * nothing above the field takes part in either behaviour. One `fetch` stub
 * answers both endpoints the composer reaches here — the skills list (the
 * composer's own known-names load, and the picker's) and the image upload.
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

const instruction = (name: string): string =>
  `Read and follow the instructions in skills/${name}/SKILL.md exactly.`;

/** Put the caret at `at` in the focused field, as a click or arrow key would. */
const caretAt = (at: number): void => {
  field().setSelectionRange(at, at);
  fireEvent.select(field());
};

const SAVED = "/tmp/pavilio-pastes/paste-1.png";

/** What the field showed at the moment each frame was written. */
let fieldAtWrite: string[] = [];
const send = vi.fn((_data: string) => {
  fieldAtWrite.push(field().value);
  return true;
});
const onSubmitted = vi.fn();

const fetchFn = vi.fn((url: string) => {
  const body = String(url).includes("/api/skills") ? SKILLS : { path: SAVED };
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
});

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

const chip = (): HTMLElement => screen.getByRole("button", { name: "/ skills" });

/** The composer's own load of the known names has answered. */
async function skillsLoaded(): Promise<void> {
  await waitFor(() => expect(fetchFn).toHaveBeenCalledWith("/api/skills"));
  // Let the resolved response reach the composer's handler.
  await Promise.resolve();
  await Promise.resolve();
}

const expectSubmitted = async (body: string): Promise<void> => {
  await waitFor(() => expect(send.mock.calls).toEqual([[body], ["\r"]]));
};

beforeEach(() => {
  fieldAtWrite = [];
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

describe("AnswerComposer command chip", () => {
  it("the field keeps the short form after sending", async () => {
    const user = userEvent.setup();
    renderComposer();
    await skillsLoaded();

    await user.click(field());
    // `/` opens the picker; the space after the name closes it again, so the
    // Enter below sends rather than picks.
    await user.keyboard("/pavilio-grill my idea");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");

    await expectSubmitted(`${instruction("pavilio-grill")} my idea`);
    // While the instruction was being written, the field still said what the
    // user typed: the expansion is on the way out only.
    expect(fieldAtWrite[0]).toBe("/pavilio-grill my idea");
  });

  it("the chip opens the picker", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    await user.keyboard("see ");
    await user.click(chip());

    // The same picker a leading `/` opens, filtering on the token the chip
    // just put at the caret. The caret sits right after the slash, and the
    // field keeps the focus.
    const listbox = await screen.findByRole("listbox");
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(3));
    expect(field().value).toBe("see /");
    expect(field().selectionStart).toBe("see /".length);
    expect(document.activeElement).toBe(field());

    // Typing filters it exactly as it would after a typed slash.
    await user.keyboard("quest");
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
  });

  it("the chip inserts at the caret", async () => {
    const user = userEvent.setup();
    renderComposer();
    await skillsLoaded();

    // At the end of the draft: the pick lands there, the caret after the name.
    await user.click(field());
    await user.keyboard("do some stuff use ");
    await user.click(chip());
    let listbox = await screen.findByRole("listbox");
    await user.keyboard("pavilio-no");
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
    await user.keyboard("{Enter}");
    expect(field().value).toBe("do some stuff use /pavilio-note");
    expect(field().selectionStart).toBe("do some stuff use /pavilio-note".length);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // Mid-text: the slash goes in at the caret, not at the start, with a
    // space after it so the text that follows is not swallowed as the query.
    await user.clear(field());
    await user.keyboard("hello world");
    caretAt("hello ".length);
    await user.click(chip());
    listbox = await screen.findByRole("listbox");
    expect(field().value).toBe("hello / world");
    expect(field().selectionStart).toBe("hello /".length);
    await user.keyboard("gri");
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
    await user.keyboard("{Enter}");
    expect(field().value).toBe("hello /pavilio-grill world");
    expect(field().selectionStart).toBe("hello /pavilio-grill".length);
  });

  it("the chip after a word puts a space before the slash", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    await user.keyboard("see");
    await user.click(chip());

    // Glued to `see` it would be a path, not a token.
    await screen.findByRole("listbox");
    expect(field().value).toBe("see /");
    expect(field().selectionStart).toBe("see /".length);
  });

  it("the chip with the caret on a /token opens the picker on it", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    // The space closes the picker the typed `/` opened.
    await user.keyboard("/quest more");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    caretAt("/qu".length);
    await user.click(chip());

    // No second slash: the token under the caret is the query, the caret at
    // its end.
    let listbox = await screen.findByRole("listbox");
    expect(field().value).toBe("/quest more");
    expect(field().selectionStart).toBe("/quest".length);
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
    expect(within(listbox).getByRole("option").textContent).toContain("pavilio-question");
    await user.keyboard("{Escape}");

    // The same for a token mid-draft, with the caret right at its end.
    await user.clear(field());
    await user.keyboard("use /gri now");
    caretAt("use /gri".length);
    await user.click(chip());
    listbox = await screen.findByRole("listbox");
    expect(field().value).toBe("use /gri now");
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
    await user.keyboard("{Enter}");
    expect(field().value).toBe("use /pavilio-grill now");
  });

  it("a skill picked from the chip after text is sent in place", async () => {
    const user = userEvent.setup();
    renderComposer();
    await skillsLoaded();

    await user.click(field());
    await user.keyboard("see");
    await user.click(chip());
    const listbox = await screen.findByRole("listbox");
    await user.keyboard("gri");
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
    await user.keyboard("{Enter}");

    expect(field().value).toBe("see /pavilio-grill");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");

    await expectSubmitted(`see ${instruction("pavilio-grill")}`);
  });

  it("a skill picked from the chip on an empty draft is sent as the instruction", async () => {
    const user = userEvent.setup();
    renderComposer();
    await skillsLoaded();

    await user.click(chip());
    const listbox = await screen.findByRole("listbox");
    expect(field().value).toBe("/");
    await user.keyboard("quest");
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
    await user.keyboard("{Enter}");
    expect(field().value).toBe("/pavilio-question");
    await user.keyboard("{Enter}");

    await expectSubmitted(instruction("pavilio-question"));
  });

  it("the chip shares the row with a pasted-image chip", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    const image = new File(["x"], "shot.png", { type: "image/png" });
    fireEvent.paste(field(), {
      clipboardData: {
        items: [{ kind: "file", type: image.type, getAsFile: () => image }],
        getData: () => "",
      },
    });

    const attachment = await screen.findByTestId("answer-pane-attachment-cell-a-0");
    // One row, both chips: neither displaces the other.
    expect(attachment.parentElement).toBe(chip().parentElement);
    expect(attachment.parentElement).toHaveClass("answer-pane-composer-chips");
  });

  describe("the known skill names at send", () => {
    const skillsResponse = (body: SkillEntry[]) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    const down = () => Promise.reject(new Error("offline"));
    const GRILL = "Read and follow the instructions in skills/pavilio-grill/SKILL.md exactly.";

    it("a picked skill is expanded even when the mount's load failed", async () => {
      // The composer's own load fails; the picker's succeeds.
      fetchFn.mockImplementationOnce(down);
      const user = userEvent.setup();
      renderComposer();
      await skillsLoaded();

      await user.click(field());
      await user.keyboard("/gri");
      const listbox = await screen.findByRole("listbox");
      await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
      await user.keyboard("{Enter}");
      await user.keyboard(" see{Enter}");

      await expectSubmitted(`${GRILL} see`);
    });

    it("the picker's load teaches a name typed by hand later", async () => {
      // The mount's load fails, the picker's first open loads the list, and a
      // second open fails — so only that first open can have taught the name.
      fetchFn
        .mockImplementationOnce(down)
        .mockImplementationOnce(() => skillsResponse(SKILLS))
        .mockImplementationOnce(down);
      const user = userEvent.setup();
      renderComposer();
      await skillsLoaded();

      await user.click(field());
      await user.keyboard("/");
      const listbox = await screen.findByRole("listbox");
      await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(3));
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      await user.keyboard("{Backspace}");

      // Typed in full, never picked: the space closes the picker unpicked.
      await user.keyboard("/pavilio-grill my idea");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      await user.keyboard("{Enter}");

      await expectSubmitted(`${GRILL} my idea`);
    });

    it("a late mount load does not drop a name learned from the picker", async () => {
      // The mount's load is still in flight while the user picks, and then
      // answers with a list that lacks the picked name.
      let answerMount: (body: SkillEntry[]) => void = () => {};
      fetchFn.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerMount = (body) =>
              resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
          }),
      );
      const user = userEvent.setup();
      renderComposer();

      await user.click(field());
      await user.keyboard("/gri");
      const listbox = await screen.findByRole("listbox");
      await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
      await user.keyboard("{Enter}");
      expect(field().value).toBe("/pavilio-grill");

      answerMount([SKILLS[1]]);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      await user.keyboard(" see{Enter}");
      await expectSubmitted(`${GRILL} see`);
    });
  });
});
