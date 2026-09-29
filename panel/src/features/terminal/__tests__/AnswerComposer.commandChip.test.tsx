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
    // just spliced in at the caret — and the field keeps the focus.
    const listbox = await screen.findByRole("listbox");
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(2));
    expect(field().value).toBe("see /");
    expect(field().selectionStart).toBe(5);
    expect(document.activeElement).toBe(field());

    // Typing filters it exactly as it would after a typed slash.
    await user.keyboard("quest");
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
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
});
