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

  it("matches only on a whole-segment boundary, not mid-segment", () => {
    // "bba/x.md" ends with "a/x.md" as text but not as a path — accepting it
    // would slice the projects dir out of the middle of a directory name.
    expect(workspaceRelativePath("/w/bba/x.md", "a/x.md")).toBe("/w/bba/x.md");
  });

  it("falls back when there is no projects-directory name to recover", () => {
    // The file sits at the filesystem root, so the head is empty and there is
    // no directory name to prefix the relative path with.
    expect(workspaceRelativePath("/x.html", "x.html")).toBe("/x.html");
    // A double slash reaches the same guard, and unlike the root-level case it
    // tells the two branches apart: without the guard this would return
    // "/x.html" and silently drop a path segment.
    expect(workspaceRelativePath("/w//x.html", "x.html")).toBe("/w//x.html");
  });
});
