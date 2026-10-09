import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CollapsibleProjectMd, { firstParagraph } from "../CollapsibleProjectMd";

const CONTENT = "# Title\n\nThe peek line.\n\n## More\n\nOnly in the full render.";

function renderMd() {
  return render(
    <MemoryRouter>
      <CollapsibleProjectMd
        content={CONTENT}
        error={null}
        basePath="pavilio/PROJECT.md"
      />
    </MemoryRouter>,
  );
}

const toggle = () => screen.getByRole("button", { name: /PROJECT\.md/ });

describe("CollapsibleProjectMd", () => {
  it("the header toggles the full render and its label", () => {
    renderMd();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(within(toggle()).getByText("Show")).toBeInTheDocument();
    expect(screen.queryByText("Only in the full render.")).toBeNull();

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(within(toggle()).getByText("Hide")).toBeInTheDocument();
    // The real MarkdownRenderer output: headings render as headings.
    expect(screen.getByRole("heading", { name: "More" })).toBeInTheDocument();
    expect(screen.getByText("Only in the full render.")).toBeInTheDocument();
    expect(screen.queryByTestId("project-md-peek")).toBeNull();

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(within(toggle()).getByText("Show")).toBeInTheDocument();
    expect(screen.queryByText("Only in the full render.")).toBeNull();
    expect(screen.getByTestId("project-md-peek")).toHaveTextContent("The peek line.");
  });

  it("the peek is the first paragraph as plain text", () => {
    expect(
      firstParagraph(
        [
          "---",
          "title: x",
          "---",
          "# Heading",
          "> a quote",
          "",
          "| a | b |",
          "|---|---|",
          "",
          "```",
          "code",
          "```",
          "",
          "A __bold__ *and* `code` with ![img](x.png) and [a link](y)",
          "wrapped onto a second line.",
          "",
          "Not this one.",
        ].join("\n"),
      ),
    ).toBe("A bold and code with img and a link wrapped onto a second line.");
    expect(firstParagraph("# Only a heading")).toBe("");
  });
});
