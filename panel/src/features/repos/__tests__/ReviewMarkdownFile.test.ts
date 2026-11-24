import { describe, expect, it } from "vitest";
import { fileBlobUrl, isMarkdownPath, markdownFileSource } from "../ReviewMarkdownFile";

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

describe("fileBlobUrl", () => {
  it("points at the file on GitHub at the head, each segment encoded", () => {
    expect(fileBlobUrl("https://github.com/o/r/pull/7", "abc", "docs/a b#.md")).toBe("https://github.com/o/r/blob/abc/docs/a%20b%23.md");
  });

  it("is a base no relative link resolves against for a URL of another shape", () => {
    const base = fileBlobUrl("https://example.com/whatever", "abc", "a.md");
    expect(base).toBe("about:blank");
    expect(() => new URL("setup.md", base)).toThrow();
    expect(new URL("https://x.dev/", base).href).toBe("https://x.dev/");
  });
});
