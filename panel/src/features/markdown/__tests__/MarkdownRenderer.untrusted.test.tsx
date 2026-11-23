import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownRenderer from "../MarkdownRenderer";

const navigate = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("../MermaidDiagram", () => ({
  default: () => null,
}));

/** A GitHub PR page: where GitHub itself resolves the body's relative links. */
const PR_URL = "https://github.com/gmotyl/pavilio/pull/236";

function renderUntrusted(content: string) {
  return render(
    <MemoryRouter>
      <MarkdownRenderer content={content} untrusted={{ linkBase: PR_URL }} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigate.mockReset();
});

describe("MarkdownRenderer untrusted mode (third-party markdown, e.g. a PR body)", () => {
  it("renders no raw HTML: no active elements, no event handlers", () => {
    const { container } = renderUntrusted(
      [
        "Intro",
        "",
        '<img src="x" onerror="window.__pwned = 1">',
        "",
        "<script>window.__pwned = 2</script>",
        "",
        '<iframe src="https://example.com"></iframe>',
        "",
        '<a href="/settings" data-wikilink="pavilio/x.md">raw</a>',
      ].join("\n"),
    );
    expect(container.querySelector("img, script, iframe, [onerror]")).toBeNull();
    expect(screen.queryByRole("link", { name: "raw" })).toBeNull();
    expect(container).toHaveTextContent("Intro");
  });

  it("drops HTML comments (PR template prompts)", () => {
    const { container } = renderUntrusted("Before\n\n<!-- Describe your change -->\n\nAfter");
    expect(container).not.toHaveTextContent("Describe your change");
    expect(container).toHaveTextContent("Before");
    expect(container).toHaveTextContent("After");
  });

  it("resolves a root-relative link against GitHub and opens it outside the panel", () => {
    renderUntrusted("[issue](/gmotyl/pavilio/issues/42)");
    const link = screen.getByRole("link", { name: "issue" });
    expect(link).toHaveAttribute("href", "https://github.com/gmotyl/pavilio/issues/42");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    fireEvent.click(link);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("resolves relative links and images against the PR page", () => {
    renderUntrusted("[spec](docs/spec.md)\n\n![shot](shot.png)");
    expect(screen.getByRole("link", { name: "spec" })).toHaveAttribute(
      "href",
      "https://github.com/gmotyl/pavilio/pull/docs/spec.md",
    );
    expect(screen.getByRole("img", { name: "shot" })).toHaveAttribute(
      "src",
      "https://github.com/gmotyl/pavilio/pull/shot.png",
    );
  });

  it("keeps absolute links and drops script URLs", () => {
    renderUntrusted("[ext](https://example.com/a)\n\n[bad](javascript:alert(1))");
    expect(screen.getByRole("link", { name: "ext" })).toHaveAttribute("href", "https://example.com/a");
    const bad = screen.getByText("bad").closest("a");
    expect(bad?.getAttribute("href") ?? "").not.toContain("javascript");
  });

  it("does not turn [[…]] into workspace wikilinks", () => {
    const { container } = renderUntrusted("See [[pavilio/PROJECT]]");
    expect(container.querySelector("[data-wikilink]")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
