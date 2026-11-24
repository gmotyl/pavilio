import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import MarkdownRenderer from "../MarkdownRenderer";

vi.mock("../MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

// Fixtures use the exact header the pavilio-pr-explain skill writes:
// `@@ <path> L<a>–<b> @@` (en dash), a gap as `@@ <path> L<c> @@`, and
// `(before)` / `(unchanged)` after the path.
function renderMd(content: string) {
  return render(
    <MemoryRouter>
      <MarkdownRenderer content={content} />
    </MemoryRouter>,
  );
}

function fence(lang: string, lines: string[]): string {
  return ["```" + lang, ...lines, "```", ""].join("\n");
}

/** Each rendered diff line as [gutter number, line text]; null when the block has no gutter. */
function gutter(container: HTMLElement): Array<[string, string]> | null {
  const lines = container.querySelectorAll("pre code .diff-line");
  if (lines.length === 0) return null;
  return [...lines].map((l) => [l.getAttribute("data-line") ?? "", (l.textContent ?? "").replace(/\n$/, "")]);
}

describe("MarkdownRenderer story diff line numbers", () => {
  it("numbers context and added lines from the header start; removed lines and the header get none", () => {
    const { container } = renderMd(
      fence("diff", [
        "@@ src/pages/Login.tsx L11–25 @@",
        " <div>",
        '   <img src={woozleLogo} alt="Woozle" className="h-[84px]" />',
        "-  Login to Woozle Research",
        "+  Log in to Woozle Research",
      ]),
    );
    expect(gutter(container)).toEqual([
      ["", "@@ src/pages/Login.tsx L11–25 @@"],
      ["11", " <div>"],
      ["12", '   <img src={woozleLogo} alt="Woozle" className="h-[84px]" />'],
      ["", "-  Login to Woozle Research"],
      ["13", "+  Log in to Woozle Research"],
    ]);
  });

  it("keeps counting across interleaved removed and added lines (hyphen range accepted)", () => {
    const { container } = renderMd(
      fence("diff", ["@@ a.ts L40-46 @@", " a", "-b", "-c", "+B", "+C", " d", "-e", "+E", " f"]),
    );
    expect(gutter(container)!.map(([n]) => n)).toEqual(["", "40", "", "", "41", "42", "43", "", "44", "45"]);
  });

  it("numbers a bare empty line between context lines as context", () => {
    const { container } = renderMd(fence("diff", ["@@ a.ts L20–22 @@", " a", "", " b"]));
    expect(gutter(container)).toEqual([
      ["", "@@ a.ts L20–22 @@"],
      ["20", " a"],
      ["21", ""],
      ["22", " b"],
    ]);
  });

  it("restarts numbering at a gap header inside the block", () => {
    const { container } = renderMd(
      fence("diff", ["@@ a.ts L10–11 @@", " a", "+b", "@@ a.ts L80 @@", " c", "-d", "+e"]),
    );
    expect(gutter(container)!.map(([n]) => n)).toEqual(["", "10", "11", "", "80", "", "81"]);
  });

  it("a (before) block numbers base lines: context and removed, not added", () => {
    const { container } = renderMd(fence("diff", ["@@ a.ts (before) L5–7 @@", " a", "-b", "+B", " c"]));
    expect(gutter(container)!.map(([n]) => n)).toEqual(["", "5", "6", "", "7"]);
  });

  it("an (unchanged) block is numbered like any other", () => {
    const { container } = renderMd(fence("diff", ["@@ lib/x.ts (unchanged) L3–4 @@", " a", " b"]));
    expect(gutter(container)!.map(([n]) => n)).toEqual(["", "3", "4"]);
  });

  it("keeps the diff colouring on numbered lines", () => {
    const { container } = renderMd(fence("diff", ["@@ a.ts L1–2 @@", "-x", "+y"]));
    expect(container.querySelector(".diff-line .hljs-deletion")?.textContent).toBe("-x");
    expect(container.querySelector(".diff-line .hljs-addition")?.textContent).toBe("+y");
  });

  it("the gutter numbers are not part of the code's text", () => {
    const { container } = renderMd(fence("diff", ["@@ a.ts L11–12 @@", " a", "+b"]));
    expect(container.querySelector("pre code")!.textContent).toBe("@@ a.ts L11–12 @@\n a\n+b\n");
  });

  it("a diff block without the story header gets no gutter", () => {
    const md = fence("diff", ["@@ -1,2 +1,2 @@", " a", "-b", "+c"]);
    const { container } = renderMd(md);
    expect(gutter(container)).toBeNull();
    expect(container.querySelector("pre code")!.textContent).toBe("@@ -1,2 +1,2 @@\n a\n-b\n+c\n");
  });

  it("a non-diff block with a header-like first line renders unchanged", () => {
    const { container } = renderMd(fence("ts", ["@@ a.ts L1–2 @@", "const a = 1;"]));
    expect(gutter(container)).toBeNull();
    expect(container.querySelector("pre code")!.className).toContain("language-ts");
    expect(container.querySelector("pre code")!.textContent).toBe("@@ a.ts L1–2 @@\nconst a = 1;\n");
  });
});
