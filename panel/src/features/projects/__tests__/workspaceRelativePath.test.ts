import { describe, it, expect } from "vitest";
import { workspaceRelativePath } from "../workspaceRelativePath";

describe("workspaceRelativePath", () => {
  it("derives the workspace-relative path from absolute and index-relative paths", () => {
    expect(
      workspaceRelativePath(
        "/root/git/prv/projects/projects/pavilio/mockups/x.html",
        "pavilio/mockups/x.html",
      ),
    ).toBe("projects/pavilio/mockups/x.html");
  });

  it("uses the real projects-directory name rather than assuming 'projects'", () => {
    expect(workspaceRelativePath("/w/notes/p/memo/a.md", "p/memo/a.md")).toBe(
      "notes/p/memo/a.md",
    );
  });

  it("falls back to the absolute path when the two paths are inconsistent", () => {
    expect(workspaceRelativePath("/w/notes/p/memo/a.md", "other/b.md")).toBe(
      "/w/notes/p/memo/a.md",
    );
  });

  it("falls back to the absolute path when an argument is empty", () => {
    expect(workspaceRelativePath("/w/notes/p/memo/a.md", "")).toBe(
      "/w/notes/p/memo/a.md",
    );
    expect(workspaceRelativePath("", "p/memo/a.md")).toBe("");
  });

  it("returns POSIX separators", () => {
    expect(
      workspaceRelativePath("C:\\w\\notes\\p\\memo\\a.md", "p/memo/a.md"),
    ).toBe("notes/p/memo/a.md");
  });
});
