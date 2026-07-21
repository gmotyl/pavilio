import { describe, it, expect } from "vitest";
import { buildFileTree, countFiles } from "../file-tree";

describe("buildFileTree", () => {
  it("builds a tree from flat file list", () => {
    const files = [
      { status: "M", path: "src/app.ts" },
      { status: "A", path: "src/utils/helper.ts" },
      { status: "D", path: "README.md" },
    ];
    const root = buildFileTree(files);
    expect(root.children.length).toBe(2); // "src" dir and "README.md" file
    const readme = root.children.find((c) => c.name === "README.md");
    expect(readme?.file?.status).toBe("D");
  });

  it("collapses single-child directories", () => {
    const files = [{ status: "M", path: "a/b/c/file.ts" }];
    const root = buildFileTree(files);
    expect(root.children.length).toBe(1);
    expect(root.children[0].name).toBe("a/b/c");
    expect(root.children[0].children[0].file?.path).toBe("a/b/c/file.ts");
  });

  it("does not collapse directories with multiple children", () => {
    const files = [
      { status: "M", path: "src/a.ts" },
      { status: "M", path: "src/b.ts" },
    ];
    const root = buildFileTree(files);
    expect(root.children.length).toBe(1);
    expect(root.children[0].name).toBe("src");
    expect(root.children[0].children.length).toBe(2);
  });

  it("returns empty tree for empty input", () => {
    const root = buildFileTree([]);
    expect(root.children.length).toBe(0);
  });

  it("never creates a nameless node for a trailing-slash dir entry", () => {
    // git status --porcelain without -uall reports an untracked dir as "?? dir/"
    const files = [
      { status: "??", path: "src/db/" },
      { status: "M", path: "src/index.ts" },
    ];
    const root = buildFileTree(files);
    const src = root.children.find((c) => c.name === "src");
    const names = (src?.children ?? []).map((c) => c.name);
    expect(names).not.toContain("");
    const db = src?.children.find((c) => c.name === "db");
    expect(db?.file?.status).toBe("??");
    expect(db?.path).toBe("src/db");
  });
});

describe("countFiles", () => {
  it("counts files in nested tree", () => {
    const files = [
      { status: "M", path: "a/b.ts" },
      { status: "M", path: "a/c.ts" },
      { status: "M", path: "d.ts" },
    ];
    const root = buildFileTree(files);
    expect(countFiles(root)).toBe(3);
  });

  it("returns 0 for empty tree", () => {
    const root = buildFileTree([]);
    expect(countFiles(root)).toBe(0);
  });
});
