import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let tmpRoot = "";
let projectsDir = "";

vi.mock("../config", () => ({ getConfig: () => ({ projectsDir }) }));

import skillsRouter, { parseDescription } from "../routes/skills";

type Skill = { name: string; description: string; path: string };

function makeApp() {
  const app = express();
  app.use("/api/skills", skillsRouter);
  return app;
}

function skillsDir(): string {
  return join(tmpRoot, "skills");
}

function addSkill(name: string, frontmatter: string | null) {
  mkdirSync(join(skillsDir(), name), { recursive: true });
  const body = frontmatter === null ? "# no frontmatter\n" : `---\n${frontmatter}\n---\n\n# ${name}\n`;
  writeFileSync(join(skillsDir(), name, "SKILL.md"), body);
}

async function list(): Promise<Skill[]> {
  const res = await request(makeApp()).get("/api/skills");
  expect(res.status).toBe(200);
  return (res.body as Skill[]).slice().sort((a, b) => a.name.localeCompare(b.name));
}

describe("GET /api/skills", () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-skills-route-"));
    projectsDir = join(tmpRoot, "projects");
    mkdirSync(projectsDir, { recursive: true });
    mkdirSync(skillsDir(), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("lists every skill with its name, description and relative path", async () => {
    addSkill("memo", "name: memo\ndescription: Capture a quick thought.");
    addSkill("grill", 'name: grill\ndescription: "Stress-test an idea: one question at a time"');
    expect(await list()).toEqual([
      { name: "grill", description: "Stress-test an idea: one question at a time", path: "skills/grill/SKILL.md" },
      { name: "memo", description: "Capture a quick thought.", path: "skills/memo/SKILL.md" },
    ]);
  });

  it("a directory added after the first call appears on the second", async () => {
    addSkill("memo", "description: first");
    expect((await list()).map((s) => s.name)).toEqual(["memo"]);
    addSkill("note", "description: second");
    expect((await list()).map((s) => s.name)).toEqual(["memo", "note"]);
  });

  it("a removed skill stops being listed", async () => {
    addSkill("memo", "description: first");
    addSkill("note", "description: second");
    expect((await list()).map((s) => s.name)).toEqual(["memo", "note"]);
    rmSync(join(skillsDir(), "note"), { recursive: true, force: true });
    expect((await list()).map((s) => s.name)).toEqual(["memo"]);
  });

  it("a skill with no description is listed with an empty one", async () => {
    addSkill("bare", "name: bare");
    addSkill("nofm", null);
    expect(await list()).toEqual([
      { name: "bare", description: "", path: "skills/bare/SKILL.md" },
      { name: "nofm", description: "", path: "skills/nofm/SKILL.md" },
    ]);
  });

  it("a directory without a SKILL.md is skipped", async () => {
    addSkill("memo", "description: yes");
    mkdirSync(join(skillsDir(), "empty"), { recursive: true });
    mkdirSync(join(skillsDir(), "readme-only"), { recursive: true });
    writeFileSync(join(skillsDir(), "readme-only", "README.md"), "x\n");
    writeFileSync(join(skillsDir(), "loose-file.md"), "x\n");
    mkdirSync(join(skillsDir(), ".hidden"), { recursive: true });
    writeFileSync(join(skillsDir(), ".hidden", "SKILL.md"), "---\ndescription: hidden\n---\n");
    expect((await list()).map((s) => s.name)).toEqual(["memo"]);
  });

  it("paths are relative to the workspace root", async () => {
    addSkill("memo", "description: a");
    addSkill("note", "description: b");
    for (const s of await list()) {
      expect(s.path.startsWith("skills/")).toBe(true);
      expect(s.path).toBe(`skills/${s.name}/SKILL.md`);
      expect(s.path).not.toContain(tmpRoot);
    }
  });

  it("follows a symlinked skill directory", async () => {
    const outside = join(tmpRoot, "elsewhere", "linked");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "SKILL.md"), "---\ndescription: via link\n---\n");
    symlinkSync(outside, join(skillsDir(), "linked"));
    // A dangling link must not break the listing.
    symlinkSync(join(tmpRoot, "nowhere"), join(skillsDir(), "dangling"));
    expect(await list()).toEqual([
      { name: "linked", description: "via link", path: "skills/linked/SKILL.md" },
    ]);
  });

  it("a missing skills root answers 200 with an empty list", async () => {
    rmSync(skillsDir(), { recursive: true, force: true });
    expect(await list()).toEqual([]);
  });
});

describe("parseDescription", () => {
  const fm = (s: string) => `---\n${s}\n---\nbody\n`;

  it("reads a plain scalar, keeping inner colons", () => {
    expect(parseDescription(fm("name: x\ndescription: Use it: now."))).toBe("Use it: now.");
  });

  it("unquotes single and double quoted scalars", () => {
    expect(parseDescription(fm("description: 'it''s here'"))).toBe("it's here");
    expect(parseDescription(fm('description: "say \\"hi\\""'))).toBe('say "hi"');
  });

  it("folds a > block scalar", () => {
    expect(parseDescription(fm("description: >\n  one line\n  and more\nname: x"))).toBe("one line and more");
  });

  it("keeps newlines of a | block scalar", () => {
    expect(parseDescription(fm("description: |-\n  first\n  second\nname: x"))).toBe("first\nsecond");
  });

  it("joins a multi-line plain scalar", () => {
    expect(parseDescription(fm("description: starts here\n  continues here\nname: x"))).toBe(
      "starts here continues here",
    );
  });

  it("handles CRLF line endings", () => {
    expect(parseDescription("---\r\ndescription: crlf\r\n---\r\n")).toBe("crlf");
  });

  it("returns empty without frontmatter or key", () => {
    expect(parseDescription("# title\ndescription: not frontmatter\n")).toBe("");
    expect(parseDescription(fm("name: x"))).toBe("");
  });
});
