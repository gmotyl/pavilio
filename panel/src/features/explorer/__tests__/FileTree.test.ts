import { describe, it, expect } from "vitest";
import { activeViewPath, buildTree, fileViewHref, fileViewKey, parseViewPath } from "../FileTree";

describe("buildTree", () => {
  it("groups files by project", () => {
    const files = [
      { relativePath: "my-work/notes/daily.md", project: "my-work", modified: 1 },
      { relativePath: "my-work/PROJECT.md", project: "my-work", modified: 2 },
      { relativePath: "my-pet-project/notes/sync.md", project: "my-pet-project", modified: 3 },
    ];
    const tree = buildTree(files);
    expect(Object.keys(tree)).toEqual(["my-work", "my-pet-project"]);
    expect(tree["my-work"].root).toHaveLength(1);
    expect(tree["my-work"].subfolders.notes).toHaveLength(1);
    expect(tree["my-pet-project"].subfolders.notes).toHaveLength(1);
  });

  it("puts top-level project files in root", () => {
    const files = [
      { relativePath: "my-blog/PROJECT.md", project: "my-blog", modified: 1 },
    ];
    const tree = buildTree(files);
    expect(tree["my-blog"].root).toHaveLength(1);
    expect(tree["my-blog"].root[0].relativePath).toBe("my-blog/PROJECT.md");
  });

  it("handles deeply nested files as subfolder entries", () => {
    const files = [
      { relativePath: "my-work/notes/log/transcript.txt", project: "my-work", modified: 1 },
    ];
    const tree = buildTree(files);
    expect(tree["my-work"].subfolders.notes).toHaveLength(1);
  });

  it("returns empty object for empty input", () => {
    expect(buildTree([])).toEqual({});
  });
});

describe("parseViewPath", () => {
  it("parses /view/project/subfolder", () => {
    expect(parseViewPath("/view/my-work/notes")).toEqual({ project: "my-work", subfolder: "notes" });
  });

  it("parses /view/project only", () => {
    expect(parseViewPath("/view/my-work")).toEqual({ project: "my-work", subfolder: "" });
  });

  it("returns null for non-view paths", () => {
    expect(parseViewPath("/dashboard")).toBeNull();
    expect(parseViewPath("/")).toBeNull();
  });
});

describe("encoded /view/ routes", () => {
  it("parseViewPath decodes project and subfolder", () => {
    expect(parseViewPath("/view/my%20work/my%20notes/a.md")).toEqual({ project: "my work", subfolder: "my notes" });
  });

  it("activeViewPath matches the raw file path behind an encoded URL", () => {
    expect(activeViewPath("/view/p/notes/a%20b%23c.md", null)).toBe("/view/p/notes/a b#c.md");
    expect(activeViewPath("/project/p", "p/notes/x.md")).toBe("/view/p/notes/x.md");
    expect(activeViewPath("/project/p", null)).toBe("/project/p");
  });
});

describe("fileViewHref", () => {
  it("encodes each raw path segment, so a literal %20 survives the round trip", () => {
    const href = fileViewHref("projects", "p/notes/a%20b #.md");
    expect(href).toBe("/view/p/notes/a%2520b%20%23.md");
    expect(fileViewHref("skills", "memo/SKILL.md")).toBe("/view/_root/skills/memo/SKILL.md");
    // The highlight compares the decoded route with the raw key of the same file.
    expect(activeViewPath(href, null)).toBe(fileViewKey("projects", "p/notes/a%20b #.md"));
  });
});
