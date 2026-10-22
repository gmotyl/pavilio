import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

import { projectKind, projectCardDir } from "../kind";

let projectsDir = "";

function write(rel: string, text: string) {
  const abs = join(projectsDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "project-kind-"));
});

afterEach(() => {
  rmSync(projectsDir, { recursive: true, force: true });
});

describe("projectKind", () => {
  it("projectKind defaults to project without frontmatter", () => {
    write("plain/PROJECT.md", "# Plain\n");
    expect(projectKind(projectsDir, "plain")).toBe("project");
    expect(projectCardDir(projectsDir, "plain")).toBe(join(projectsDir, "plain"));
  });

  it("projectKind reads research and knowledge", () => {
    write("topic/PROJECT.md", "---\nkind: research\n---\n# Topic\n");
    write("knowledge/PROJECT.md", "---\nkind: knowledge\n---\n# Knowledge\n");
    expect(projectKind(projectsDir, "topic")).toBe("research");
    expect(projectKind(projectsDir, "knowledge")).toBe("knowledge");
  });

  it("projectKind falls back to project for unknown kind", () => {
    write("odd/PROJECT.md", "---\nkind: spaceship\n---\n# Odd\n");
    write("broken/PROJECT.md", "---\nkind: [unclosed\n---\n# Broken\n");
    expect(projectKind(projectsDir, "odd")).toBe("project");
    expect(projectKind(projectsDir, "broken")).toBe("project");
  });

  it("projectKind reads an archived project", () => {
    write("archived/old/PROJECT.md", "---\nkind: research\n---\n# Old\n");
    expect(projectKind(projectsDir, "old")).toBe("research");
    expect(projectCardDir(projectsDir, "old")).toBe(join(projectsDir, "archived", "old"));
  });

  it("projectCardDir returns null for a missing project", () => {
    expect(projectCardDir(projectsDir, "ghost")).toBeNull();
    expect(projectKind(projectsDir, "ghost")).toBe("project");
    expect(projectCardDir(projectsDir, "../escape")).toBeNull();
  });
});
