/**
 * The `/ skills` chip, and the portable expansion a picked skill gets at send.
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
];

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
  it("the field is not rewritten by the expansion", async () => {
    const user = userEvent.setup();
    renderComposer();
    await skillsLoaded();

    await user.click(field());
    // `/` opens the picker; the space after the name closes it again, so the
    // Enter below sends rather than picks.
    await user.keyboard("/pavilio-grill my idea");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");

    await expectSubmitted(
      "Read and follow the instructions in skills/pavilio-grill/SKILL.md exactly. ARGUMENTS: my idea",
    );
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
    // just put at the START of the draft (only a leading `/<name>` is a
    // command), with a space so the text already typed is not the query. The
    // caret sits right after the slash, and the field keeps the focus.
    const listbox = await screen.findByRole("listbox");
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(2));
    expect(field().value).toBe("/ see ");
    expect(field().selectionStart).toBe(1);
    expect(document.activeElement).toBe(field());

    // Typing filters it exactly as it would after a typed slash.
    await user.keyboard("quest");
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
  });

  it("the chip on a draft that already starts with a /token opens the picker on it", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(field());
    // The space closes the picker the typed `/` opened.
    await user.keyboard("/quest more");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.click(chip());

    // No second slash: the leading token is the query, the caret at its end.
    const listbox = await screen.findByRole("listbox");
    expect(field().value).toBe("/quest more");
    expect(field().selectionStart).toBe("/quest".length);
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
    expect(within(listbox).getByRole("option").textContent).toContain("pavilio-question");
  });

  it("a skill picked from the chip in front of text is sent as the instruction", async () => {
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

    // The pick replaced the query; what was typed before is now the argument.
    expect(field().value).toBe("/pavilio-grill see");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");

    await expectSubmitted(
      "Read and follow the instructions in skills/pavilio-grill/SKILL.md exactly. ARGUMENTS: see",
    );
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

    await expectSubmitted(
      "Read and follow the instructions in skills/pavilio-question/SKILL.md exactly. ARGUMENTS:",
    );
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

      await expectSubmitted(`${GRILL} ARGUMENTS: see`);
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
      await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(2));
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      await user.keyboard("{Backspace}");

      // Typed in full, never picked: the space closes the picker unpicked.
      await user.keyboard("/pavilio-grill my idea");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      await user.keyboard("{Enter}");

      await expectSubmitted(`${GRILL} ARGUMENTS: my idea`);
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
      await expectSubmitted(`${GRILL} ARGUMENTS: see`);
    });
  });
});
