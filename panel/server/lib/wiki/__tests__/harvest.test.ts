import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

import { addBacklink, clearCandidates, harvestStatus, listCandidates } from "../harvest";

let root = "";

function write(rel: string, text: string) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** A project with a PROJECT.md and an open-questions.md holding the given candidate lines. */
function project(name: string, candidates: string[], base = "projects") {
  write(`${base}/${name}/PROJECT.md`, "# p\n");
  write(
    `${base}/${name}/wiki/open-questions.md`,
    ["# Open questions", "", "## Gaps", "- 2026-10-20 — gap one", "", "## Knowledge candidates", ...candidates, ""].join(
      "\n",
    ),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wiki-harvest-"));
  mkdirSync(join(root, "projects"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("harvest", () => {
  it("candidates spans projects and skips knowledge and archived", () => {
    project("alpha", ["- 2026-10-20 — vitest pools share state (from [[wiki/sources/progress-a]])"]);
    project("lab", ["- 2026-10-21 — uv caches wheels (from [[wiki/sources/article-uv]])"]);
    write("projects/lab/PROJECT.md", "---\nkind: research\n---\n# lab\n");
    project("knowledge", ["- 2026-10-21 — knowledge's own line"]);
    project("old", ["- 2026-10-21 — archived line"], "projects/archived");
    project("gone", ["- 2026-10-21 — registry-archived line"]);
    write(".projects.local.md", "| Project | Type |\n| --- | --- |\n| alpha | private |\n\n## Archived Projects\n\n| gone | private |\n");
    write("projects/nowiki/PROJECT.md", "# no wiki\n");

    const { items } = listCandidates(root);
    expect(items.map((i) => i.project).sort()).toEqual(["alpha", "lab"]);
    const alpha = items.find((i) => i.project === "alpha")!;
    expect(alpha).toMatchObject({
      text: "vitest pools share state",
      date: "2026-10-20",
      source: "wiki/sources/progress-a",
    });
    expect(alpha.id).toMatch(/^alpha#[0-9a-f]+$/);
  });

  it("candidates keeps lines without a source", () => {
    project("alpha", ["- 2026-10-20 — a bare finding"]);
    const { items } = listCandidates(root);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ project: "alpha", text: "a bare finding", date: "2026-10-20", source: null });
  });

  it("clear-candidates removes only the given lines", () => {
    project("alpha", [
      "- 2026-10-20 — one (from [[wiki/sources/a]])",
      "- 2026-10-20 — two (from [[wiki/sources/b]])",
      "- 2026-10-20 — three",
    ]);
    project("beta", ["- 2026-10-21 — four"]);
    const before = read("projects/alpha/wiki/open-questions.md");
    const betaBefore = read("projects/beta/wiki/open-questions.md");
    const { items } = listCandidates(root);
    const drop = items.filter((i) => i.text === "two" || i.text === "three").map((i) => i.id);

    expect(clearCandidates(root, drop)).toEqual({ removed: 2 });
    expect(read("projects/alpha/wiki/open-questions.md")).toBe(
      before.replace("- 2026-10-20 — two (from [[wiki/sources/b]])\n", "").replace("- 2026-10-20 — three\n", ""),
    );
    expect(read("projects/beta/wiki/open-questions.md")).toBe(betaBefore);
    expect(listCandidates(root).items.map((i) => i.text).sort()).toEqual(["four", "one"]);
  });

  it("backlink is idempotent", () => {
    write("projects/alpha/PROJECT.md", "# p\n");
    write("projects/alpha/wiki/sources/a.md", "---\ntype: source\n---\nbody\n\n## Knowledge\n- [[knowledge:wiki/concepts/x]]\n");
    expect(addBacklink(root, "alpha", "wiki/sources/a.md", "wiki/concepts/vitest")).toEqual({ added: true });
    const once = read("projects/alpha/wiki/sources/a.md");
    expect(once).toBe(
      "---\ntype: source\n---\nbody\n\n## Knowledge\n- [[knowledge:wiki/concepts/x]]\n- [[knowledge:wiki/concepts/vitest]]\n",
    );
    expect(addBacklink(root, "alpha", "wiki/sources/a", "wiki/concepts/vitest")).toEqual({ added: false });
    expect(read("projects/alpha/wiki/sources/a.md")).toBe(once);
  });

  it("backlink creates the Knowledge section", () => {
    write("projects/alpha/PROJECT.md", "# p\n");
    write("projects/alpha/wiki/sources/a.md", "---\ntype: source\n---\nbody\n\n## Knowledge candidates\nnot this one");
    expect(addBacklink(root, "alpha", "wiki/sources/a.md", "wiki/entities/uv")).toEqual({ added: true });
    expect(read("projects/alpha/wiki/sources/a.md")).toBe(
      "---\ntype: source\n---\nbody\n\n## Knowledge candidates\nnot this one\n\n## Knowledge\n- [[knowledge:wiki/entities/uv]]\n",
    );
  });

  it("harvest-status reports never", () => {
    project("alpha", ["- 2026-10-20 — one"]);
    const today = new Date(2026, 9, 22);
    expect(harvestStatus(root, today)).toEqual({ lastRun: null, daysAgo: null, waiting: 1 });
    write("projects/knowledge/PROJECT.md", "---\nkind: knowledge\n---\n");
    write("projects/knowledge/wiki/log.md", "# Log\n\n## 2026-10-20 14:05 ingest (explicit)\n- sources: x\n");
    expect(harvestStatus(root, today)).toEqual({ lastRun: null, daysAgo: null, waiting: 1 });
  });

  it("harvest-status counts days and waiting items", () => {
    project("alpha", ["- 2026-10-20 — one", "- 2026-10-20 — two"]);
    project("beta", ["- 2026-10-21 — three (from [[wiki/sources/b]])"]);
    write("projects/knowledge/PROJECT.md", "---\nkind: knowledge\n---\n");
    write(
      "projects/knowledge/wiki/log.md",
      "# Log\n\n## [2026-10-01] harvest\n- picked: a\n\n## [2026-10-12] harvest\n- picked: b\n\n## 2026-10-15 09:00 ingest (explicit)\n",
    );
    expect(harvestStatus(root, new Date(2026, 9, 22))).toEqual({ lastRun: "2026-10-12", daysAgo: 10, waiting: 3 });
  });
});
