import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

import { buildIndex } from "../index-md";

let wikiDir = "";

function write(rel: string, text: string) {
  const abs = join(wikiDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

const read = (rel: string) => readFileSync(join(wikiDir, rel), "utf8");

function page(fm: Record<string, string>, body = "") {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

function seed() {
  write("overview.md", page({ type: "overview", description: "What this project is" }));
  write("open-questions.md", page({ type: "open-questions", description: "Unresolved" }));
  write("log.md", "- ingested: notes/a.md #abcdef012345\n");
  write("raw/article-x.md", "# raw, untyped on purpose\n");
  write(
    "concepts/speech.md",
    page({ type: "concept", title: "Speech", description: "How answers are spoken" }),
  );
  write("concepts/auto-sync.md", page({ type: "concept", description: "Workspace sync" }, "# Auto sync\n\nBody.\n"));
  write("concepts/bare.md", page({ type: "concept" }, "No heading here.\n"));
  write("entities/greg.md", page({ type: "entity", kind: "person", title: "Greg", description: "Maintainer" }));
  write("entities/pavilio.md", page({ type: "entity", kind: "repository", title: "pavilio", description: "This repo" }));
  write("entities/alokai.md", page({ type: "entity", kind: "organization", title: "Alokai", description: "Employer" }));
  write("entities/ana.md", page({ type: "entity", kind: "person", title: "Ana", description: "Reviewer" }));
  write("sources/notes/2026-10-19-a.md", page({ type: "source", title: "Kickoff", description: "First meeting" }));
  write("repos/pavilio/ARCHITECTURE.md", page({ type: "architecture", title: "Architecture", description: "Panel and skills" }));
  write("repos/pavilio/speech.md", page({ type: "code-note", title: "Speech pipeline", description: "Server relay" }));
}

beforeEach(() => {
  wikiDir = mkdtempSync(join(tmpdir(), "wiki-index-"));
});

afterEach(() => {
  rmSync(wikiDir, { recursive: true, force: true });
});

describe("buildIndex", () => {
  it("root index lists sections only", () => {
    seed();
    const result = buildIndex(wikiDir);

    expect(result).toEqual({
      ok: true,
      written: [
        "concepts/index.md",
        "entities/index.md",
        "index.md",
        "repos/index.md",
        "repos/pavilio/index.md",
        "sources/index.md",
      ],
    });
    const root = read("index.md");
    const items = root.split("\n").filter((l) => l.startsWith("- "));
    expect(items).toEqual([
      "- [[wiki/sources/index|Sources]] — One source page per record (1 page)",
      "- [[wiki/entities/index|Entities]] — People, repositories, services and organizations (4 pages)",
      "- [[wiki/concepts/index|Concepts]] — Domain knowledge (3 pages)",
      "- [[wiki/repos/index|Repos]] — Code-level notes per repository (2 pages)",
    ]);
    // No page, root page or timestamp leaks into the root index.
    expect(root).not.toContain("speech");
    expect(root).not.toContain("overview");
    expect(root).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(root.startsWith("---\ntype: index\n")).toBe(true);
  });

  it("section index lists title and description", () => {
    seed();
    buildIndex(wikiDir);

    const concepts = read("concepts/index.md");
    expect(concepts.split("\n").filter((l) => l.startsWith("- "))).toEqual([
      "- [[wiki/concepts/auto-sync|Auto sync]] — Workspace sync",
      "- [[wiki/concepts/bare|bare]]",
      "- [[wiki/concepts/speech|Speech]] — How answers are spoken",
    ]);
    expect(concepts).not.toContain("concepts/index");

    const sources = read("sources/index.md");
    expect(sources).toContain("## notes\n\n- [[wiki/sources/notes/2026-10-19-a|Kickoff]] — First meeting\n");

    const repos = read("repos/index.md");
    expect(repos.split("\n").filter((l) => l.startsWith("- "))).toEqual([
      "- [[wiki/repos/pavilio/index|pavilio]] — Panel and skills (2 pages)",
    ]);
    const repo = read("repos/pavilio/index.md");
    expect(repo.split("\n").filter((l) => l.startsWith("- "))).toEqual([
      "- [[wiki/repos/pavilio/ARCHITECTURE|Architecture]] — Panel and skills",
      "- [[wiki/repos/pavilio/speech|Speech pipeline]] — Server relay",
    ]);
  });

  it("entities grouped by kind", () => {
    seed();
    write("entities/mystery.md", page({ type: "entity", title: "Mystery", description: "No kind yet" }));
    buildIndex(wikiDir);

    expect(read("entities/index.md")).toContain(
      [
        "## Person",
        "",
        "- [[wiki/entities/ana|Ana]] — Reviewer",
        "- [[wiki/entities/greg|Greg]] — Maintainer",
        "",
        "## Repository",
        "",
        "- [[wiki/entities/pavilio|pavilio]] — This repo",
        "",
        "## Organization",
        "",
        "- [[wiki/entities/alokai|Alokai]] — Employer",
        "",
        "## Other",
        "",
        "- [[wiki/entities/mystery|Mystery]] — No kind yet",
        "",
      ].join("\n"),
    );
  });

  it("is byte-identical across runs", () => {
    seed();
    buildIndex(wikiDir);
    const files = ["index.md", "concepts/index.md", "entities/index.md", "sources/index.md", "repos/index.md", "repos/pavilio/index.md"];
    const first = files.map(read);
    buildIndex(wikiDir);
    expect(files.map(read)).toEqual(first);
  });

  it("fails on an untyped page without writing", () => {
    seed();
    write("concepts/untyped.md", "---\ndescription: forgot the type\n---\nx\n");

    expect(buildIndex(wikiDir)).toEqual({
      ok: false,
      error: "page has no type",
      page: "concepts/untyped.md",
    });
    expect(existsSync(join(wikiDir, "index.md"))).toBe(false);
    expect(existsSync(join(wikiDir, "concepts/index.md"))).toBe(false);
  });
});
