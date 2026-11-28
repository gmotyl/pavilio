import { describe, expect, it } from "vitest";
import { forgeCopy } from "../forgeCopy";
import { fileBlobUrl, fileRawUrl } from "../ReviewMarkdownFile";

describe("forgeCopy", () => {
  it("forgeCopy numbers and urls per forge", () => {
    const gh = forgeCopy("github");
    const gl = forgeCopy("gitlab");
    expect(gh.name).toBe("GitHub");
    expect(gl.name).toBe("GitLab");
    expect(gh.number(244)).toBe("#244");
    expect(gl.number(244)).toBe("!244");

    const mr = "https://h/g/r/-/merge_requests/1";
    expect(gl.blobUrl(mr, "abc", "a/b.md")).toBe("https://h/g/r/-/blob/abc/a/b.md");
    expect(gl.rawUrl(mr, "abc", "img/a.png")).toBe("https://h/g/r/-/raw/abc/img/a.png");
    expect(gl.blobUrl(`${mr}/`, "abc", "docs/a b#.md")).toBe("https://h/g/r/-/blob/abc/docs/a%20b%23.md");
    // Nested groups keep every segment.
    expect(gl.blobUrl("https://git.example.org/a/b/c/-/merge_requests/9", "f/x", "a.md")).toBe(
      "https://git.example.org/a/b/c/-/blob/f%2Fx/a.md",
    );
    // A URL of another shape resolves nothing.
    expect(gl.blobUrl("https://github.com/o/r/pull/7", "abc", "a.md")).toBe("about:blank");
    expect(gh.blobUrl(mr, "abc", "a.md")).toBe("about:blank");

    // GitHub output is exactly today's.
    const cases: [string, string, string][] = [
      ["https://github.com/o/r/pull/7", "abc", "docs/a b#.md"],
      ["https://github.com/o/r/pull/7/", "feat/x", "img/a.png"],
      ["https://example.com/whatever", "abc", "a.md"],
    ];
    for (const [url, head, path] of cases) {
      expect(gh.blobUrl(url, head, path)).toBe(fileBlobUrl(url, head, path));
      expect(gh.rawUrl(url, head, path)).toBe(fileRawUrl(url, head, path));
    }
    expect(gh.blobUrl("https://github.com/o/r/pull/7", "abc", "docs/a b#.md")).toBe(
      "https://github.com/o/r/blob/abc/docs/a%20b%23.md",
    );
    expect(gh.rawUrl("https://github.com/o/r/pull/7", "abc", "img/a.png")).toBe("https://github.com/o/r/raw/abc/img/a.png");
  });
});
