import { describe, expect, it } from "vitest";
import { isMarkdownPath, markdownFileSource } from "../ReviewMarkdownFile";

describe("isMarkdownPath", () => {
  it("takes .md and .markdown in any case, not MDX or other text", () => {
    expect(["README.md", "docs/a.MD", "notes.markdown"].map(isMarkdownPath)).toEqual([true, true, true]);
    expect(["page.mdx", "a.ts", "md", "README.md.bak"].map(isMarkdownPath)).toEqual([false, false, false, false]);
  });
});

describe("markdownFileSource", () => {
  it("drops frontmatter and HTML comments", () => {
    expect(markdownFileSource("---\ntitle: x\n---\n# Hi <!-- no -->\n")).toBe("# Hi \n");
  });

  it("keeps a rule that follows the frontmatter a rule", () => {
    expect(markdownFileSource("---\na: 1\n---\n---\ntext")).toBe("\n---\ntext");
  });
});
