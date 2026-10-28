import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownRenderer from "../MarkdownRenderer";
import { copyToClipboard } from "../../../lib/clipboard";

// Same seam as the code-block copy test: only *what text* reaches the
// clipboard helper is under test here.
vi.mock("../../../lib/clipboard", () => ({
  copyToClipboard: vi.fn(),
}));

const copy = vi.mocked(copyToClipboard);

function renderMd(content: string) {
  return render(
    <MemoryRouter>
      <MarkdownRenderer content={content} />
    </MemoryRouter>,
  );
}

async function copiedFrom(button: HTMLElement): Promise<string> {
  fireEvent.click(button);
  await waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
  return copy.mock.calls[0]![0] as string;
}

beforeEach(() => {
  copy.mockReset();
  copy.mockResolvedValue(true);
});

describe("MarkdownRenderer blockquote copy", () => {
  it("every blockquote gets a copy button next to it", () => {
    const { container } = renderMd("Intro.\n\n> one\n\nMiddle.\n\n> two\n");

    const buttons = screen.getAllByLabelText("Copy quote");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.closest(".quote-block")?.querySelector("blockquote")).toBeTruthy();
    }
    expect(container.querySelectorAll(".quote-block")).toHaveLength(2);
  });

  it("copies the quote's Markdown without the > markers", async () => {
    renderMd(
      [
        "Proposed message:",
        "",
        '> *"Hey @Martin, quick question about `NODE_OPTIONS`.*',
        ">",
        "> *Second paragraph.\"*",
        "",
        "Trailing note.",
      ].join("\n"),
    );

    expect(await copiedFrom(screen.getByLabelText("Copy quote"))).toBe(
      '*"Hey @Martin, quick question about `NODE_OPTIONS`.*\n\n*Second paragraph."*',
    );
  });

  it("a quote inside a list item loses its indentation and markers", async () => {
    renderMd("- item\n\n  > first line\n  > second line\n");

    expect(await copiedFrom(screen.getByLabelText("Copy quote"))).toBe("first line\nsecond line");
  });

  it("a nested quote keeps its own inner markers in the outer copy", async () => {
    renderMd("> outer\n>\n> > inner\n");

    // The outer button follows its blockquote, so it comes after the inner one.
    const buttons = screen.getAllByLabelText("Copy quote");
    expect(buttons).toHaveLength(2);
    expect(await copiedFrom(buttons[1]!)).toBe("outer\n\n> inner");
  });

  it("a raw HTML blockquote copies its text, not its tags", async () => {
    renderMd("<blockquote>plain <b>words</b></blockquote>\n");

    expect(await copiedFrom(screen.getByLabelText("Copy quote"))).toBe("plain words");
  });
});
