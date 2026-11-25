import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import MarkdownRenderer from "../MarkdownRenderer";
import { copyToClipboard } from "../../../lib/clipboard";

vi.mock("../../../lib/clipboard", () => ({
  copyToClipboard: vi.fn(),
}));

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

  it("a (before) directory in the path is not the marker: the block numbers head lines", () => {
    const { container } = renderMd(fence("diff", ["@@ src/(before)/file.ts L5–7 @@", " a", "-b", "+B", " c"]));
    expect(gutter(container)!.map(([n]) => n)).toEqual(["", "5", "", "6", "7"]);
  });

  it("(before) followed by another marker still numbers base lines", () => {
    const { container } = renderMd(
      fence("diff", ["@@ src/(before)/file.ts (before) (unchanged) L5–7 @@", " a", "-b", "+B", " c"]),
    );
    expect(gutter(container)!.map(([n]) => n)).toEqual(["", "5", "6", "", "7"]);
  });

  it("an (unchanged) block is numbered like any other", () => {
    const { container } = renderMd(fence("diff", ["@@ lib/x.ts (unchanged) L3–4 @@", " a", " b"]));
    expect(gutter(container)!.map(([n]) => n)).toEqual(["", "3", "4"]);
  });

  it("keeps the diff colouring on numbered lines of an unknown language", () => {
    const { container } = renderMd(fence("diff", ["@@ a.unknownext L1–2 @@", "-x", "+y"]));
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

describe("MarkdownRenderer story diff syntax colours", () => {
  /** The rendered story rows of the first block. */
  function rows(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>("pre code .story-line")];
  }

  it("tsx story block renders token spans with a sign column", () => {
    const { container } = renderMd(
      fence("diff", [
        "@@ panel/src/x.tsx L40–41 @@",
        "+  const [portChanges, setPortChanges] = useState(0);",
        "+  const firstPortRef = useRef(true);",
      ]),
    );
    const [first, second] = rows(container);
    expect(rows(container)).toHaveLength(2);
    expect(first.getAttribute("data-line")).toBe("40");
    expect(second.getAttribute("data-line")).toBe("41");
    for (const row of [first, second]) {
      expect(row.classList.contains("story-line-added")).toBe(true);
      expect(row.querySelector(".story-line-sign")?.textContent).toBe("+");
      expect(row.querySelector(".story-line-code .hljs-keyword")?.textContent).toBe("const");
      // Whole-line diff colouring is gone: the tint is the row's.
      expect(row.querySelector(".hljs-addition")).toBeNull();
    }
    expect(first.querySelector(".story-line-code .hljs-number")?.textContent).toBe("0");
    expect(second.querySelector(".story-line-code .hljs-literal")?.textContent).toBe("true");
    // The code cell holds the line without its prefix.
    expect(first.querySelector(".story-line-code")?.textContent).toBe("  const [portChanges, setPortChanges] = useState(0);");
    // The header row stays as before, and the code's text is still the fenced text.
    expect(container.querySelector("pre code")!.textContent).toBe(
      "@@ panel/src/x.tsx L40–41 @@\n+  const [portChanges, setPortChanges] = useState(0);\n+  const firstPortRef = useRef(true);\n",
    );
  });

  it("removed and context rows get their sign and tint", () => {
    const { container } = renderMd(
      fence("diff", ["@@ src/a.ts L10–11 base L20 @@", " const a = 1;", "-let b = 2;", "+const b = 2;", ""]),
    );
    const [context, removed, added, blank] = rows(container);
    expect(context.querySelector(".story-line-sign")?.textContent).toBe(" ");
    expect(context.classList.contains("story-line-added")).toBe(false);
    expect(context.classList.contains("story-line-removed")).toBe(false);
    expect(context.getAttribute("data-line")).toBe("10");
    expect(context.getAttribute("data-base")).toBe("20");
    expect(removed.querySelector(".story-line-sign")?.textContent).toBe("-");
    expect(removed.classList.contains("story-line-removed")).toBe(true);
    expect(removed.getAttribute("data-line")).toBe("");
    expect(removed.getAttribute("data-base")).toBe("21");
    expect(removed.querySelector(".story-line-code .hljs-keyword")?.textContent).toBe("let");
    expect(added.classList.contains("story-line-added")).toBe(true);
    expect(added.getAttribute("data-base")).toBe("");
    // A bare empty context line keeps a blank sign cell.
    expect(blank.querySelector(".story-line-sign")?.textContent).toBe("");
    expect(blank.classList.contains("story-line-added") || blank.classList.contains("story-line-removed")).toBe(false);
  });

  it("unknown language keeps whole-line diff colouring", () => {
    for (const header of ["@@ notes/x.unknownext L1–2 @@", "@@ Makefile L1–2 @@"]) {
      const { container, unmount } = renderMd(fence("diff", [header, "-x = 1", "+x = 2"]));
      expect(rows(container)).toHaveLength(0);
      expect(container.querySelector(".story-line-sign")).toBeNull();
      expect(container.querySelector(".diff-line .hljs-deletion")?.textContent).toBe("-x = 1");
      expect(container.querySelector(".diff-line .hljs-addition")?.textContent).toBe("+x = 2");
      unmount();
    }
    // No story header: rehype-highlight's own diff grammar, no rows at all.
    const { container } = renderMd(fence("diff", ["@@ -1,2 +1,2 @@", "-const a = 1;", "+const a = 2;"]));
    expect(rows(container)).toHaveLength(0);
    expect(container.querySelector(".diff-line")).toBeNull();
    expect(container.querySelector(".hljs-deletion")?.textContent).toBe("-const a = 1;");
  });

  it("copy still yields the original block text", async () => {
    const copy = vi.mocked(copyToClipboard);
    copy.mockReset();
    copy.mockResolvedValue(true);
    const lines = ["@@ panel/src/x.tsx L40–42 @@", " const a = 1;", "-let b = 2;", "+const b = 2;"];
    renderMd(fence("diff", lines));
    fireEvent.click(screen.getByLabelText("Copy code"));
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
    expect(copy).toHaveBeenCalledWith(lines.join("\n"));
  });
});
