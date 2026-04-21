import { describe, it, expect } from "vitest";
import { buildTree, parseViewPath } from "../FileTree";

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
