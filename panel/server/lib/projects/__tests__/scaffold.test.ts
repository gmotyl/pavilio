import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { projectKind } from "../kind";
import { scaffoldProject } from "../scaffold";

const REGISTRY = [
  "| Project | Type | Path |",
  "| ------- | ---- | ---- |",
  "| demo | private | `<root>/projects/demo/` |",
  "",
].join("\n");

const WIKI_SKELETON = [
  "wiki/index.md",
  "wiki/overview.md",
  "wiki/log.md",
  "wiki/open-questions.md",
  "wiki/.gitignore",
  "wiki/sources/.gitkeep",
  "wiki/entities/.gitkeep",
  "wiki/concepts/.gitkeep",
];

let root = "";
let projectsDir = "";

const registryFile = () => join(root, ".projects.local.md");
const read = (rel: string) => readFileSync(join(projectsDir, rel), "utf8");

function write(rel: string, text: string) {
  const abs = join(projectsDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scaffold-"));
  projectsDir = join(root, "projects");
  mkdirSync(projectsDir, { recursive: true });
  writeFileSync(registryFile(), REGISTRY);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("scaffoldProject", () => {
  it("scaffolds an ordinary project", () => {
    const result = scaffoldProject({ projectsDir, name: "acme", kind: "project", today: "2026-10-22" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const rel of ["PROJECT.md", "STATUS.md", "progress/.gitkeep", ...WIKI_SKELETON]) {
      expect(result.created).toContain(rel);
      expect(existsSync(join(projectsDir, "acme", rel))).toBe(true);
    }
    expect(result.created).not.toContain("spikes/.gitkeep");
    const card = read("acme/PROJECT.md");
    expect(card.startsWith("---\nkind: project\n---\n")).toBe(true);
    expect(card).toContain("# acme");
    expect(card).toContain("## Overview");
    expect(card).toContain("## Repositories & working rules");
    expect(card).not.toContain("topic:");
    expect(read("acme/wiki/open-questions.md")).toMatch(/## Gaps[\s\S]*## Knowledge candidates/);
    expect(read("acme/wiki/.gitignore")).toContain(".ingest.lock*");
    expect(read("acme/wiki/overview.md")).toContain("type: overview");
    expect(read("acme/wiki/index.md")).toContain("type: index");
    expect(readFileSync(registryFile(), "utf8")).toMatch(/^\| acme \|.*`projects\/acme\/` \|$/m);
    expect(projectKind(projectsDir, "acme")).toBe("project");
  });

  it("scaffolds a research project with topic, spikes and raw", () => {
    const result = scaffoldProject({
      projectsDir,
      name: "tts-voices",
      kind: "research",
      topic: "edge tts voices",
      today: "2026-10-22",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const rel of ["PROJECT.md", "STATUS.md", "progress/.gitkeep", "spikes/.gitkeep", "wiki/raw/.gitkeep", ...WIKI_SKELETON]) {
      expect(result.created).toContain(rel);
    }
    const card = read("tts-voices/PROJECT.md");
    expect(card).toContain("kind: research\n");
    expect(card).toContain('topic: "edge tts voices"\n');
    expect(card).toContain("created: 2026-10-22\n");
    expect(projectKind(projectsDir, "tts-voices")).toBe("research");
  });

  it("scaffolds the knowledge project with wiki only", () => {
    const result = scaffoldProject({ projectsDir, name: "knowledge", kind: "knowledge", today: "2026-10-22" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.created].sort()).toEqual(["PROJECT.md", ...WIKI_SKELETON].sort());
    expect(existsSync(join(projectsDir, "knowledge/STATUS.md"))).toBe(false);
    expect(existsSync(join(projectsDir, "knowledge/progress"))).toBe(false);
    expect(existsSync(join(projectsDir, "knowledge/spikes"))).toBe(false);
    expect(read("knowledge/PROJECT.md")).toContain("kind: knowledge\n");
    expect(readFileSync(registryFile(), "utf8")).toMatch(/^\| knowledge \|/m);
    expect(projectKind(projectsDir, "knowledge")).toBe("knowledge");
  });

  it("refuses an existing project card", () => {
    write("acme/PROJECT.md", "# Acme\n");
    const result = scaffoldProject({ projectsDir, name: "acme", kind: "project", today: "2026-10-22" });
    expect(result).toEqual({ ok: false, ask: true, reason: "exists" });
    expect(existsSync(join(projectsDir, "acme/STATUS.md"))).toBe(false);
    expect(existsSync(join(projectsDir, "acme/wiki"))).toBe(false);
    expect(readFileSync(registryFile(), "utf8")).toBe(REGISTRY);
  });

  it("throws on a non-slug name or a research project without a topic", () => {
    expect(() => scaffoldProject({ projectsDir, name: "Acme Corp", kind: "project", today: "2026-10-22" })).toThrow(
      /invalid project name/,
    );
    expect(() => scaffoldProject({ projectsDir, name: "lab", kind: "research", today: "2026-10-22" })).toThrow(
      /topic is required for research projects/,
    );
    expect(existsSync(join(projectsDir, "lab"))).toBe(false);
  });

  it("refuses a name taken in archived", () => {
    mkdirSync(join(projectsDir, "archived", "old"), { recursive: true });
    const result = scaffoldProject({ projectsDir, name: "old", kind: "project", today: "2026-10-22" });
    expect(result).toEqual({ ok: false, ask: true, reason: "archived" });
    expect(existsSync(join(projectsDir, "old"))).toBe(false);
    expect(readFileSync(registryFile(), "utf8")).toBe(REGISTRY);
  });

  it("fills only missing parts of a cardless folder", () => {
    const status = "# Legacy status\n\nkeep me\n";
    const note = "# kickoff\n";
    const gaps = "---\ntype: open-questions\n---\n# mine\n";
    write("legacy/STATUS.md", status);
    write("legacy/notes/2026-01-01_kickoff.md", note);
    write("legacy/progress/2026-01-02.md", "progress\n");
    write("legacy/wiki/open-questions.md", gaps);
    const result = scaffoldProject({ projectsDir, name: "legacy", kind: "project", today: "2026-10-22" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toContain("PROJECT.md");
    expect(result.created).toContain("wiki/index.md");
    expect(result.created).not.toContain("STATUS.md");
    expect(result.created).not.toContain("wiki/open-questions.md");
    expect(result.created).not.toContain("progress/.gitkeep");
    expect(read("legacy/STATUS.md")).toBe(status);
    expect(read("legacy/notes/2026-01-01_kickoff.md")).toBe(note);
    expect(read("legacy/wiki/open-questions.md")).toBe(gaps);
    expect(existsSync(join(projectsDir, "legacy/progress/.gitkeep"))).toBe(false);
  });

  it("skips the registry when it is missing", () => {
    rmSync(registryFile());
    const result = scaffoldProject({ projectsDir, name: "acme", kind: "project", today: "2026-10-22" });
    expect(result.ok).toBe(true);
    expect(existsSync(join(projectsDir, "acme/PROJECT.md"))).toBe(true);
    expect(existsSync(registryFile())).toBe(false);
  });
});
