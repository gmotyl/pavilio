/**
 * The composer rendered on its own, for what happens inside the field: the
 * typed `/` that opens the skill picker, the `/ skills` chip, the shortcut
 * chips, and a pasted screenshot.
 *
 * One file, one `describe` per former file (`AnswerComposer.slashTrigger`,
 * `.commandChip`, `.shortcuts`, `.paste`); each section keeps its own fixtures
 * and hooks, and its original header sits above it.
 *
 * The pool is the composer's stub of it, shared by the family
 * (`answerPane.mocks.tsx`), so the connection state the shortcut chips are
 * disabled by can be set by hand through `pool`. Every other section's writes
 * land, so it is never asked there.
 */
import { fireEvent, screen, waitFor, within, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillEntry } from "../commandSource";
import { __resetPtySubmitForTests } from "../ptySubmit";
import { installMatchMedia, StubResizeObserver } from "../../../test-utils";
import { onSubmitted, renderComposer, pool } from "./answerPane.harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { preferences, type ComposerShortcut } from "../../../preferences/declarations";
import {
  __resetPreferenceStoreForTests,
  clearPreference,
  writePreference,
} from "../../../preferences/store";
import { __resetComposerDraftsForTests, getDraft } from "../composerDrafts";
import AlertHost from "../../alerts/AlertHost";
import { __resetAlertsForTests, getAlertsSnapshot } from "../../alerts/store";
import { AnswerComposer } from "../AnswerComposer";

vi.mock("../terminalInstances", async () => (await import("./answerPane.mocks")).terminalInstancesMock());

/**
 * The typed `/` that opens the skill picker: at any word start in the draft,
 * never inside a word and never from a paste — and, once the picker is open,
 * Enter and Tab belong to it while there is something to pick.
 *
 * Set up as the "command chip" section: the composer on its own,
 * with one `fetch` stub answering the skills list.
 */
describe("slash trigger", () => {
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

  const fetchFn = vi.fn((_url: string) =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SKILLS) }),
  );

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
      renderComposer(send);

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
      renderComposer(send);

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
      renderComposer(send);

      await user.click(field());
      await user.keyboard("see src/");

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(field().value).toBe("see src/");
    });

    it("a slash typed right before a word stays text", async () => {
      const user = userEvent.setup();
      renderComposer(send);

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
      renderComposer(send);

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
      renderComposer(send);

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
      renderComposer(send);

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
      renderComposer(send);

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
      renderComposer(send);

      await user.click(field());
      // Ending on the slash, so the caret sits right after it with nothing
      // following — everything but the one-character check would let it open.
      await user.paste("a /");

      expect(field().value).toBe("a /");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });
});

/**
 * The `/ skills` chip, which puts a skill in at the caret, and the portable
 * in-place expansion a known skill gets at send.
 *
 * The composer is rendered on its own, as in the "paste" section:
 * nothing above the field takes part in either behaviour. One `fetch` stub
 * answers both endpoints the composer reaches here — the skills list (the
 * composer's own known-names load, and the picker's) and the image upload.
 */
describe("command chip", () => {
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

  const fetchFn = vi.fn((url: string) => {
    const body = String(url).includes("/api/skills") ? SKILLS : { path: SAVED };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });

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
      renderComposer(send);
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
      renderComposer(send);

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
      renderComposer(send);
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
      renderComposer(send);

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
      renderComposer(send);

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
      renderComposer(send);
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
      renderComposer(send);
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
      renderComposer(send);

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
        renderComposer(send);
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
        renderComposer(send);
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
        renderComposer(send);

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
});

/**
 * The composer shortcut chips: one chip per `preferences.composerShortcuts`
 * entry, in the chip row between the `/ skills` chip and any pasted-image
 * chips. A press sends the shortcut's text and then Enter through the same
 * `submitToPty` path as the send button, verbatim, and never touches the draft.
 *
 * The pool is mocked the way `AnswerComposer.reconnect.test.tsx` ("pending row") mocks it, so
 * the connection state the chips are disabled by can be set by hand.
 */
describe("shortcut chips", () => {
  const SESSION = "cell-a";

  const SKILLS: SkillEntry[] = [
    { name: "pavilio-grill", description: "Stress-test an idea", path: "skills/pavilio-grill/SKILL.md" },
  ];

  const send = vi.fn((_data: string) => true);

  const fetchFn = vi.fn((url: string) => {
    const body = String(url).includes("/api/skills") ? SKILLS : { path: "/tmp/pavilio-pastes/shot.png" };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });

  function withShortcuts(list: ComposerShortcut[]): void {
    writePreference(preferences.composerShortcuts, list);
  }

  const field = (): HTMLTextAreaElement =>
    screen.getByTestId(`answer-pane-composer-${SESSION}`) as HTMLTextAreaElement;

  const shortcut = (index: number): HTMLButtonElement =>
    screen.getByTestId(`answer-pane-shortcut-${index}-${SESSION}`) as HTMLButtonElement;

  /** The composer's own load of the known names has answered. */
  async function skillsLoaded(): Promise<void> {
    await waitFor(() => expect(fetchFn).toHaveBeenCalledWith("/api/skills"));
    await Promise.resolve();
    await Promise.resolve();
  }

  // `src/features/terminal/__tests__` → `src/index.css`, comments stripped so a
  // comment in front of a rule is never read as part of its selector.
  const css = readFileSync(join(__dirname, "..", "..", "..", "index.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  /** The body of every `@media (max-width: 767px)` block, concatenated. */
  function touchBlocks(): string {
    const out: string[] = [];
    const marker = "@media (max-width: 767px)";
    let at = css.indexOf(marker);
    while (at !== -1) {
      const open = css.indexOf("{", at);
      let depth = 1;
      let i = open + 1;
      while (depth > 0 && i < css.length) {
        if (css[i] === "{") depth += 1;
        else if (css[i] === "}") depth -= 1;
        i += 1;
      }
      out.push(css.slice(open + 1, i - 1));
      at = css.indexOf(marker, i);
    }
    return out.join("\n");
  }

  /** The declarations one exact selector gets within `source`, in cascade order. */
  function declarationsOf(source: string, selector: string): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const [, selectorList, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!selectorList.split(",").some((one) => one.trim() === selector)) continue;
      for (const declaration of body.split(";")) {
        const colon = declaration.indexOf(":");
        if (colon === -1) continue;
        merged[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
      }
    }
    return merged;
  }

  beforeEach(() => {
    pool.connectionState = "connected";
    pool.listeners.clear();
    send.mockClear();
    onSubmitted.mockClear();
    fetchFn.mockClear();
    __resetPtySubmitForTests();
    __resetComposerDraftsForTests();
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    vi.stubGlobal("fetch", fetchFn);
    installMatchMedia();
  });

  afterEach(() => {
    clearPreference(preferences.composerShortcuts);
    __resetPreferenceStoreForTests();
    vi.unstubAllGlobals();
  });

  describe("AnswerComposer shortcut chips", () => {
    it("the chip row orders skills, shortcuts, then images", async () => {
      withShortcuts([
        { label: "Yes", text: "yes" },
        { label: "OK", text: "ok" },
        { label: "Go on", text: "go on" },
      ]);
      renderComposer(send);

      await userEvent.setup().click(field());
      const image = new File(["x"], "shot.png", { type: "image/png" });
      fireEvent.paste(field(), {
        clipboardData: {
          items: [{ kind: "file", type: image.type, getAsFile: () => image }],
          getData: () => "",
        },
      });
      const attachment = await screen.findByTestId(`answer-pane-attachment-${SESSION}-0`);

      const row = attachment.parentElement as HTMLElement;
      expect(row).toHaveClass("answer-pane-composer-chips");
      const labels = Array.from(row.children).map((chip) => chip.textContent?.trim());
      expect(labels).toEqual(["/ skills", "Yes", "OK", "Go on", "shot.png"]);

      // Each chip is named by its label, and its tooltip carries what it sends.
      const go = within(row).getByRole("button", { name: "Go on" });
      expect(go).toBe(shortcut(2));
      expect(go.title).toBe("Go on — sends “go on”");
    });

    it("a shortcut sends its text and Enter", async () => {
      withShortcuts([
        { label: "Yes", text: "yes" },
        { label: "OK", text: "ok" },
      ]);
      const user = userEvent.setup();
      renderComposer(send);

      await user.click(screen.getByRole("button", { name: "Yes" }));

      // The body, then the submitting return on a turn of its own — exactly what
      // the send button writes.
      await waitFor(() => expect(send.mock.calls).toEqual([["yes"], ["\r"]]));
      // The same handover the send button makes: the pane is told a reply went.
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });

    it("a shortcut leaves the draft alone", async () => {
      withShortcuts([{ label: "Yes", text: "yes" }]);
      const user = userEvent.setup();
      renderComposer(send);

      await user.click(field());
      await user.keyboard("half a thought");
      await user.click(shortcut(0));

      await waitFor(() => expect(send.mock.calls).toEqual([["yes"], ["\r"]]));
      expect(field().value).toBe("half a thought");
      expect(getDraft(SESSION)).toBe("half a thought");
      // The press never took the focus off the field.
      expect(document.activeElement).toBe(field());
    });

    it("a shortcut leaves an open picker and its token alone", async () => {
      withShortcuts([{ label: "Yes", text: "yes" }]);
      const user = userEvent.setup();
      renderComposer(send);

      await user.click(field());
      await user.keyboard("/gri");
      await screen.findByRole("listbox");
      await user.click(shortcut(0));

      await waitFor(() => expect(send.mock.calls).toEqual([["yes"], ["\r"]]));
      // The picker is about the draft, and the draft did not change.
      expect(field().value).toBe("/gri");
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    it("a shortcut is never expanded as a skill", async () => {
      withShortcuts([{ label: "Grill", text: "/pavilio-grill" }]);
      const user = userEvent.setup();
      renderComposer(send);
      await skillsLoaded();

      await user.click(shortcut(0));

      await waitFor(() => expect(send.mock.calls).toEqual([["/pavilio-grill"], ["\r"]]));
    });

    it("shortcuts are disabled without a connection", async () => {
      pool.connectionState = "disconnected";
      withShortcuts([
        { label: "Yes", text: "yes" },
        { label: "OK", text: "ok" },
      ]);
      const user = userEvent.setup();
      renderComposer(send);

      expect(shortcut(0)).toBeDisabled();
      expect(shortcut(1)).toBeDisabled();
      await user.click(shortcut(0));
      fireEvent.click(shortcut(1));
      expect(send).not.toHaveBeenCalled();
      expect(onSubmitted).not.toHaveBeenCalled();

      // The socket coming back is what enables them again.
      pool.connectionState = "connected";
      for (const cb of [...(pool.listeners.get(SESSION) ?? [])]) cb("connected");
      await waitFor(() => expect(shortcut(0)).toBeEnabled());
    });

    it("an empty list renders no shortcut chips", () => {
      withShortcuts([]);
      renderComposer(send);

      expect(screen.queryByTestId(`answer-pane-shortcut-0-${SESSION}`)).not.toBeInTheDocument();
      const row = screen.getByRole("button", { name: "/ skills" }).parentElement as HTMLElement;
      expect(Array.from(row.children).map((chip) => chip.textContent?.trim())).toEqual(["/ skills"]);
    });

    it("every composer chip is touch-sized on a phone", () => {
      withShortcuts([{ label: "A label twenty-four long", text: "yes" }]);
      renderComposer(send);
      expect(shortcut(0)).toHaveClass("answer-pane-shortcut-chip");
      // The height rule is on every child of the chip row but the floating
      // picker, so the `/ skills` chip and an attachment meet it without a
      // taller neighbour.
      const row = shortcut(0).parentElement;
      expect(row).toHaveClass("answer-pane-composer-chips");
      expect(screen.getByRole("button", { name: "/ skills" }).parentElement).toBe(row);

      // At least 32px tall under the touch viewport's media query.
      const touch = declarationsOf(touchBlocks(), ".answer-pane-composer-chips > :not(.command-picker)");
      expect(parseFloat(touch["min-height"] ?? "0")).toBeGreaterThanOrEqual(32);

      // A long label is cut with an ellipsis rather than widening the row.
      const label = declarationsOf(css, ".answer-pane-shortcut-label");
      expect(label["text-overflow"]).toBe("ellipsis");
      expect(label["overflow"]).toBe("hidden");
      expect(label["white-space"]).toBe("nowrap");
      expect(declarationsOf(css, ".answer-pane-shortcut-chip")["max-width"]).toBeTruthy();
    });
  });
});

/**
 * Pasting a screenshot into the composer.
 *
 * The composer is rendered on its own here, unlike `AnswerComposer.send.test.tsx` ("send")
 * which goes through `AnswerPane`. That file's criteria were about the field's
 * PLACE — Escape stopped by the pane's root, the switch in the meta row, the
 * grip as the pane's bottom edge — and a field rendered alone would have been
 * pinning a component no user meets. None of that applies to a paste: the
 * clipboard reaches the textarea and nothing above it participates. What IS
 * mounted alongside is `AlertHost`, because "the failure is surfaced" is a
 * claim about the panel's real notification surface rather than about a spy.
 */
describe("paste", () => {
  /** What the server answers with — the same shape `uploadPastedImage` reads. */
  const SAVED = "/tmp/pavilio-pastes/paste-1.png";

  /** A live socket: the write landed. `send` reports delivery now, and a stub
   *  that returned nothing would read as a socket that is not OPEN. */
  const send = vi.fn((_data: string) => true);

  /** The pane's handover. Not this file's subject — the pane's own suites pin it. */
  const fetchFn = vi.fn();

  /**
   * The upload requests only. The composer also loads `/api/skills` once on
   * mount (the names its send-time expansion knows), which is not a paste.
   */
  const uploads = (): unknown[][] => fetchFn.mock.calls.filter(([url]) => url !== "/api/skills");

  /**
   * The two writes one submit makes: the body, then the return on its own turn.
   * See `ptySubmit` — the `\r` is no longer part of the body it submits.
   */
  const expectSubmitted = async (body: string): Promise<void> => {
    await waitFor(() => expect(send.mock.calls).toEqual([[body], ["\r"]]));
  };

  function renderWithAlerts() {
    return render(
      <>
        <AnswerComposer sessionId="cell-a" send={send} onSubmitted={onSubmitted} />
        <AlertHost />
      </>,
    );
  }

  const field = (): HTMLTextAreaElement =>
    screen.getByTestId("answer-pane-composer-cell-a") as HTMLTextAreaElement;

  /** The attachment chips standing beside the field, in order. */
  const chips = (): HTMLElement[] => screen.queryAllByTestId(/^answer-pane-attachment-cell-a-/);

  /**
   * A clipboard carrying one image, shaped the way `clipboardData` is read —
   * an `items` list whose entries answer `kind`, `type` and `getAsFile()`.
   */
  function imageClipboard(file: File) {
    return {
      items: [{ kind: "file", type: file.type, getAsFile: () => file }],
      getData: () => "",
    };
  }

  const shot = (): File => new File(["x"], "shot.png", { type: "image/png" });

  /**
   * Types `look at please` and puts the caret back between `at ` and `please`.
   *
   * The caret is the point of the exercise: index 8 is neither end of the field,
   * so a handler that appends the path — or prepends it — writes a different
   * string than a handler that inserts it where the user was.
   */
  async function typeAroundACaret(user: ReturnType<typeof userEvent.setup>) {
    await user.click(field());
    await user.keyboard("look at please");
    field().setSelectionRange(8, 8);
  }

  beforeEach(() => {
    send.mockClear();
    onSubmitted.mockClear();
    __resetPtySubmitForTests();
    fetchFn.mockReset();
    __resetAlertsForTests();
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    vi.stubGlobal("fetch", fetchFn);
    installMatchMedia();
  });

  describe("AnswerComposer paste", () => {
    it("uploads a pasted image and inserts the saved path at the caret", async () => {
      fetchFn.mockResolvedValue({ ok: true, json: async () => ({ path: SAVED }) });
      const user = userEvent.setup();
      renderWithAlerts();
      await typeAroundACaret(user);

      fireEvent.paste(field(), { clipboardData: imageClipboard(shot()) });

      // Where the caret was, not at the end — and with the trailing space the
      // terminal's own paste handler appends, so the next word the user types
      // is not run into the filename.
      await waitFor(() => expect(field().value).toBe(`look at ${SAVED} please`));

      // The same request the terminal's handler makes, down to the session id:
      // the server chowns the saved file to the OS user behind that session.
      expect(uploads()).toHaveLength(1);
      const [url, init] = uploads()[0] as [string, RequestInit];
      expect(url).toBe("/api/terminal/paste-image");
      expect(init.method).toBe("POST");
      const form = init.body as FormData;
      expect(form.get("sessionId")).toBe("cell-a");
      expect(form.get("image")).toBeInstanceOf(File);

      // A paste is not a send: nothing reaches the PTY until Enter.
      expect(send).not.toHaveBeenCalled();
    });

    it("leaves a pasted text clipboard alone", async () => {
      const user = userEvent.setup();
      renderWithAlerts();

      await user.click(field());
      await user.paste("just words");

      // The textarea's own insertion did this — the handler never called
      // `preventDefault` — and no upload was attempted for a clipboard with no
      // image in it.
      expect(field().value).toBe("just words");
      expect(uploads()).toHaveLength(0);
    });

    it("reports a failed upload and changes nothing", async () => {
      fetchFn.mockResolvedValue({ ok: false });
      const user = userEvent.setup();
      renderWithAlerts();
      await typeAroundACaret(user);

      fireEvent.paste(field(), { clipboardData: imageClipboard(shot()) });

      // The panel's own alert, not a console line: a paste that silently did
      // nothing is indistinguishable from a paste that was ignored.
      const alert = await screen.findByTestId("alert");
      expect(alert).toHaveTextContent("Could not save the pasted image");
      expect(getAlertsSnapshot()).toEqual([
        expect.objectContaining({
          kind: "error",
          title: "Could not save the pasted image",
          detail: undefined,
          persistent: false,
        }),
      ]);

      // And the field is exactly as the user left it.
      expect(field().value).toBe("look at please");
      expect(send).not.toHaveBeenCalled();
    });

    it("splices into the text typed while the upload was in flight", async () => {
      // The round trip, held open: the paste handler is inside its `then` for as
      // long as this promise is unresolved, which is the window the user types in.
      let answer!: (response: { ok: boolean; json: () => Promise<unknown> }) => void;
      fetchFn.mockReturnValue(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      const user = userEvent.setup();
      renderWithAlerts();
      await typeAroundACaret(user);

      fireEvent.paste(field(), { clipboardData: imageClipboard(shot()) });

      // Still in flight, and the user has not stopped writing the sentence the
      // screenshot belongs to.
      expect(field().value).toBe("look at please");
      field().setSelectionRange("look at please".length, "look at please".length);
      await user.keyboard(" now");
      expect(field().value).toBe("look at please now");

      answer({ ok: true, json: async () => ({ path: SAVED }) });

      // BOTH halves survive: the path lands at the caret the paste was made at,
      // and the four characters typed after it are still there. The splice reads
      // the field as it is when the upload answers — a handler that closed over
      // the text as it was at paste time would write `look at <path> please` and
      // silently swallow " now".
      await waitFor(() => expect(field().value).toBe(`look at ${SAVED} please now`));
    });

    it("keeps the pasted path when the composer is unmounted and built again", async () => {
      fetchFn.mockResolvedValue({ ok: true, json: async () => ({ path: SAVED }) });
      const user = userEvent.setup();
      const view = renderWithAlerts();
      await typeAroundACaret(user);

      fireEvent.paste(field(), { clipboardData: imageClipboard(shot()) });
      await waitFor(() => expect(field().value).toBe(`look at ${SAVED} please`));

      // The pane is destroyed on Escape and rebuilt on reopen, and the rebuilt
      // field is seeded from the draft store rather than from whatever the last
      // mount held. Every assertion above this one passes just as well against a
      // paste that only ever reached `useState` — and that paste loses the path
      // the moment the user closes the pane without typing another character,
      // which is exactly what "the field still holds that text" forbids.
      view.unmount();
      renderWithAlerts();

      expect(field().value).toBe(`look at ${SAVED} please`);
    });

    /**
     * The attachment chip.
     *
     * design.md draws the chip INSIDE the field, with the path still underneath
     * it as editable text. A `<textarea>` holds text, not elements, so that
     * drawing cannot be built as drawn — and the shipped behaviour it would have
     * to replace is one Greg tested by hand and asked to keep: the raw path is
     * spliced at the caret and stays editable mid-path, so a screenshot saved
     * somewhere else can be pointed at by typing over it.
     *
     * So the chip is honest about being outside the field: it names the file and
     * is DERIVED from the path, which is why it follows the text rather than
     * being a second record of it. Edit the path away and the chip goes with it —
     * there is no longer an attachment of that name in the reply.
     */
    it("names the pasted file in a chip beside the still-editable path", async () => {
      fetchFn.mockResolvedValue({ ok: true, json: async () => ({ path: SAVED }) });
      const user = userEvent.setup();
      renderWithAlerts();
      await typeAroundACaret(user);

      fireEvent.paste(field(), { clipboardData: imageClipboard(shot()) });
      await waitFor(() => expect(field().value).toBe(`look at ${SAVED} please`));

      // The basename, not the path: the chip is the glance, the field is the
      // record.
      expect(chips()).toHaveLength(1);
      expect(chips()[0]).toHaveTextContent("paste-1.png");
      expect(chips()[0]).not.toHaveTextContent("/tmp/pavilio-pastes");

      // The path is still the field's text, and still what reaches the PTY.
      await user.click(field());
      await user.keyboard("{Enter}");
      await expectSubmitted(`look at ${SAVED} please`);
    });

    it("drops the chip when the path it names is edited away", async () => {
      fetchFn.mockResolvedValue({ ok: true, json: async () => ({ path: SAVED }) });
      const user = userEvent.setup();
      renderWithAlerts();
      await typeAroundACaret(user);

      fireEvent.paste(field(), { clipboardData: imageClipboard(shot()) });
      await waitFor(() => expect(field().value).toBe(`look at ${SAVED} please`));
      expect(chips()).toHaveLength(1);

      // The same edit `sends the edited path rather than the inserted one`
      // makes. The chip is derived, so it cannot outlive what it was derived
      // from — a chip still claiming `paste-1.png` over a reply pointing at
      // `crop.png` would be the panel telling the user something untrue.
      field().setSelectionRange(8, 8 + SAVED.length);
      await user.keyboard("/srv/shots/crop.png");

      expect(chips()).toHaveLength(0);
    });

    it("sends the edited path rather than the inserted one", async () => {
      fetchFn.mockResolvedValue({ ok: true, json: async () => ({ path: SAVED }) });
      const user = userEvent.setup();
      renderWithAlerts();
      await typeAroundACaret(user);

      fireEvent.paste(field(), { clipboardData: imageClipboard(shot()) });
      await waitFor(() => expect(field().value).toBe(`look at ${SAVED} please`));

      // Select the path that was just inserted and type over it: what the field
      // holds at Enter is the contract, not what the upload put there.
      field().setSelectionRange(8, 8 + SAVED.length);
      await user.keyboard("/srv/shots/crop.png");
      await user.keyboard("{Enter}");

      await expectSubmitted("look at /srv/shots/crop.png please");
    });
  });
});
