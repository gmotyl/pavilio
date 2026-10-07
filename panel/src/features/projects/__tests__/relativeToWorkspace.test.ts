import { describe, it, expect } from "vitest";
import { relativeToWorkspace } from "../relativeToWorkspace";

describe("relativeToWorkspace", () => {
  it("copy path copies the workspace-relative path", () => {
    expect(
      relativeToWorkspace(
        "/root/git/prv/projects/projects/metro/notes/a.md",
        "/root/git/prv/projects",
      ),
    ).toBe("projects/metro/notes/a.md");
  });

  it("linked repo file copies a ../ path", () => {
    expect(
      relativeToWorkspace(
        "/h/git/alokai/clients/carolina-herrera/openspec/changes/x/tasks.md",
        "/h/git/prv/projects",
      ),
    ).toBe("../../alokai/clients/carolina-herrera/openspec/changes/x/tasks.md");
  });

  it("projects dir name is not hardcoded", () => {
    // The projects directory is configurable; whatever it is called, its name
    // comes out of the absolute path, not out of a literal "projects".
    expect(relativeToWorkspace("/w/notes/p/memo/a.md", "/w")).toBe(
      "notes/p/memo/a.md",
    );
  });

  it("normalises backslashes on both sides", () => {
    expect(
      relativeToWorkspace("C:\\w\\notes\\p\\memo\\a.md", "C:\\w"),
    ).toBe("notes/p/memo/a.md");
    expect(relativeToWorkspace("C:/w/notes/a.md", "C:\\w\\")).toBe(
      "notes/a.md",
    );
  });

  it("ignores a trailing slash, doubled slashes and dot segments like path.relative", () => {
    expect(relativeToWorkspace("/w//notes/./a.md", "/w/")).toBe("notes/a.md");
    expect(relativeToWorkspace("/w/x/../notes/a.md", "/w")).toBe("notes/a.md");
  });

  it("matches only whole segments, not a shared name prefix", () => {
    // "/w/projects-old" is a sibling of "/w/projects", not inside it.
    expect(relativeToWorkspace("/w/projects-old/a.md", "/w/projects")).toBe(
      "../projects-old/a.md",
    );
  });

  it("returns an empty string for the root itself, as path.relative does", () => {
    expect(relativeToWorkspace("/w", "/w")).toBe("");
  });
});
