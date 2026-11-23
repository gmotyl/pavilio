import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

import {
  addBacklink,
  clearCandidates,
  groupWikiName,
  harvestStatus,
  knowledgeTargets,
  listCandidates,
} from "../harvest";

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
    expect(items[0]).toEqual({
      id: items[0].id,
      project: "alpha",
      text: "a bare finding",
      details: [],
      date: "2026-10-20",
      source: null,
      scope: "generic",
      group: null,
    });
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

  it("candidates are top-level bullets and clear-candidates drops their sub-lines", () => {
    project("alpha", [
      "- 2026-10-20 — parent one",
      "  - a nested detail of one",
      "    continuation of the detail",
      "- 2026-10-20 — parent two",
      "  * nested under two",
    ]);
    const before = read("projects/alpha/wiki/open-questions.md");
    const { items } = listCandidates(root);
    expect(items.map((i) => i.text)).toEqual(["parent one", "parent two"]);

    const one = items.find((i) => i.text === "parent one")!;
    expect(clearCandidates(root, [one.id])).toEqual({ removed: 1 });
    expect(read("projects/alpha/wiki/open-questions.md")).toBe(
      before.replace(
        "- 2026-10-20 — parent one\n  - a nested detail of one\n    continuation of the detail\n",
        "",
      ),
    );
  });

  it("candidates carry their indented details, dedented, with the id of the top line alone", () => {
    project("alpha", [
      "- 2026-10-20 — parent one",
      "  - a nested detail of one",
      "    continuation of the detail",
      "- 2026-10-20 — parent two",
    ]);
    const { items } = listCandidates(root);
    const one = items.find((i) => i.text === "parent one")!;
    expect(one.details).toEqual(["- a nested detail of one", "  continuation of the detail"]);
    expect(items.find((i) => i.text === "parent two")!.details).toEqual([]);

    // Editing a detail keeps the id: it hashes the top-level line only.
    write(
      "projects/alpha/wiki/open-questions.md",
      read("projects/alpha/wiki/open-questions.md").replace("a nested detail of one", "an edited detail"),
    );
    expect(listCandidates(root).items.find((i) => i.text === "parent one")!.id).toBe(one.id);
  });

  it("identical candidate lines get distinct ids and clear one at a time", () => {
    project("alpha", ["- 2026-10-20 — same", "- 2026-10-20 — other", "- 2026-10-20 — same"]);
    const { items } = listCandidates(root);
    const same = items.filter((i) => i.text === "same");
    expect(same).toHaveLength(2);
    expect(same[0].id).not.toBe(same[1].id);

    expect(clearCandidates(root, [same[1].id])).toEqual({ removed: 1 });
    expect(listCandidates(root).items.map((i) => i.text)).toEqual(["same", "other"]);
    expect(listCandidates(root).items[0].id).toBe(same[0].id);
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

  it("addBacklink writes a group-wiki target", () => {
    write("projects/alpha/PROJECT.md", "# p\n");
    write("projects/alpha/wiki/sources/a.md", "body\n\n## Knowledge\n- [[knowledge:wiki/concepts/vat]]\n");
    expect(addBacklink(root, "alpha", "wiki/sources/a.md", "metro-wiki:wiki/concepts/vat")).toEqual({ added: true });
    const once = read("projects/alpha/wiki/sources/a.md");
    expect(once).toBe(
      "body\n\n## Knowledge\n- [[knowledge:wiki/concepts/vat]]\n- [[metro-wiki:wiki/concepts/vat]]\n",
    );
    expect(addBacklink(root, "alpha", "wiki/sources/a", "[[metro-wiki:wiki/concepts/vat.md]]")).toEqual({
      added: false,
    });
    expect(read("projects/alpha/wiki/sources/a.md")).toBe(once);
    for (const bad of ["../x:wiki/concepts/vat", "a/b:wiki/concepts/vat", ":wiki/concepts/vat", "metro-wiki:"]) {
      expect(() => addBacklink(root, "alpha", "wiki/sources/a.md", bad)).toThrow();
    }
    expect(read("projects/alpha/wiki/sources/a.md")).toBe(once);
  });

  it("addBacklink keeps knowledge default for bare targets", () => {
    write("projects/alpha/PROJECT.md", "# p\n");
    write("projects/alpha/wiki/sources/a.md", "body\n\n## Knowledge\n- [[metro-wiki:wiki/concepts/x]]\n");
    expect(addBacklink(root, "alpha", "wiki/sources/a.md", "wiki/concepts/x")).toEqual({ added: true });
    expect(addBacklink(root, "alpha", "wiki/sources/a.md", "knowledge:wiki/concepts/x")).toEqual({ added: false });
    expect(read("projects/alpha/wiki/sources/a.md")).toBe(
      "body\n\n## Knowledge\n- [[metro-wiki:wiki/concepts/x]]\n- [[knowledge:wiki/concepts/x]]\n",
    );
  });

  it("harvestStatus counts group candidates separately", () => {
    project("alpha", ["- 2026-10-20 — one", "- 2026-10-20 — two", "", "## Group candidates", "- g one", "- g two"]);
    project("beta", ["- 2026-10-21 — three"]);
    expect(harvestStatus(root, new Date(2026, 9, 22))).toEqual({
      lastRun: null,
      daysAgo: null,
      waiting: 5,
      waitingGroup: 2,
    });
  });

  it("harvest-status reports never", () => {
    project("alpha", ["- 2026-10-20 — one"]);
    const today = new Date(2026, 9, 22);
    expect(harvestStatus(root, today)).toEqual({ lastRun: null, daysAgo: null, waiting: 1, waitingGroup: 0 });
    write("projects/knowledge/PROJECT.md", "---\nkind: knowledge\n---\n");
    write("projects/knowledge/wiki/log.md", "# Log\n\n## 2026-10-20 14:05 ingest (explicit)\n- sources: x\n");
    expect(harvestStatus(root, today)).toEqual({ lastRun: null, daysAgo: null, waiting: 1, waitingGroup: 0 });
  });

  it("harvest-status counts days and waiting items", () => {
    project("alpha", ["- 2026-10-20 — one", "- 2026-10-20 — two"]);
    project("beta", ["- 2026-10-21 — three (from [[wiki/sources/b]])"]);
    write("projects/knowledge/PROJECT.md", "---\nkind: knowledge\n---\n");
    write(
      "projects/knowledge/wiki/log.md",
      "# Log\n\n## [2026-10-01] harvest\n- picked: a\n\n## [2026-10-12] harvest\n- picked: b\n\n## 2026-10-15 09:00 ingest (explicit)\n",
    );
    expect(harvestStatus(root, new Date(2026, 9, 22))).toEqual({ lastRun: "2026-10-12", daysAgo: 10, waiting: 3, waitingGroup: 0 });
  });

  it("harvest-status clamps a future harvest to zero days", () => {
    write("projects/knowledge/PROJECT.md", "---\nkind: knowledge\n---\n");
    write("projects/knowledge/wiki/log.md", "# Log\n\n## [2026-10-25] harvest\n- picked: a\n");
    expect(harvestStatus(root, new Date(2026, 9, 22))).toEqual({ lastRun: "2026-10-25", daysAgo: 0, waiting: 0, waitingGroup: 0 });
  });

  it("knowledgeTargets maps ungrouped and grouped knowledge projects", () => {
    write("projects/knowledge/PROJECT.md", "---\nkind: knowledge\n---\n");
    expect(knowledgeTargets(root)).toEqual({ global: "knowledge", groups: {} });
    write("projects/metro-wiki/PROJECT.md", "---\nkind: knowledge\ngroup: metro\n---\n");
    write("projects/metro-app/PROJECT.md", "---\ngroup: metro\n---\n");
    expect(knowledgeTargets(root)).toEqual({ global: "knowledge", groups: { metro: "metro-wiki" } });
  });

  it("knowledgeTargets rejects two targets for one group", () => {
    write("projects/metro-wiki/PROJECT.md", "---\nkind: knowledge\ngroup: metro\n---\n");
    write("projects/metro-kb/PROJECT.md", "---\nkind: knowledge\ngroup: metro\n---\n");
    expect(() => knowledgeTargets(root)).toThrow("ambiguous knowledge target: metro-kb, metro-wiki");
    rmSync(join(root, "projects/metro-kb"), { recursive: true });
    write("projects/knowledge/PROJECT.md", "---\nkind: knowledge\n---\n");
    write("projects/other-kb/PROJECT.md", "---\nkind: knowledge\n---\n");
    expect(() => knowledgeTargets(root)).toThrow("ambiguous knowledge target: knowledge, other-kb");
  });

  it("knowledgeTargets skips archived projects", () => {
    write("projects/knowledge/PROJECT.md", "---\nkind: knowledge\n---\n");
    write("projects/metro-wiki/PROJECT.md", "---\nkind: knowledge\ngroup: metro\n---\n");
    write("projects/archived/old-wiki/PROJECT.md", "---\nkind: knowledge\ngroup: metro\n---\n");
    write("projects/gone-wiki/PROJECT.md", "---\nkind: knowledge\ngroup: metro\n---\n");
    write(".projects.local.md", "| Project | Type |\n| --- | --- |\n\n## Archived Projects\n\n| gone-wiki | private |\n");
    expect(knowledgeTargets(root)).toEqual({ global: "knowledge", groups: { metro: "metro-wiki" } });
  });

  it("groupWikiName slugs the group name", () => {
    expect(groupWikiName("Motyl OSS")).toBe("motyl-oss-wiki");
    expect(groupWikiName("metro")).toBe("metro-wiki");
  });

  it("listCandidates skips grouped knowledge projects", () => {
    project("alpha", ["- 2026-10-20 — alpha line"]);
    project("metro-wiki", ["- 2026-10-20 — group wiki line"]);
    write("projects/metro-wiki/PROJECT.md", "---\nkind: knowledge\ngroup: metro\n---\n");
    project("kb", ["- 2026-10-20 — ungrouped knowledge line"]);
    write("projects/kb/PROJECT.md", "---\nkind: knowledge\n---\n");
    expect(listCandidates(root).items.map((i) => i.project)).toEqual(["alpha"]);
  });

  it("listCandidates reads group candidates with scope and group", () => {
    project("metro-app", ["- 2026-10-20 — generic line (from [[wiki/sources/a]])", "- 2026-10-20 — same"]);
    write("projects/metro-app/PROJECT.md", "---\ngroup: metro\n---\n");
    write(
      "projects/metro-app/wiki/open-questions.md",
      read("projects/metro-app/wiki/open-questions.md") +
        ["## Group candidates", "- 2026-10-21 — metro uses one SSO (from [[wiki/sources/b]])", "  - detail", "- 2026-10-20 — same", ""].join("\n"),
    );
    const { items } = listCandidates(root);
    expect(items.map((i) => [i.text, i.scope, i.group])).toEqual([
      ["generic line", "generic", null],
      ["same", "generic", null],
      ["metro uses one SSO", "group", "metro"],
      ["same", "group", "metro"],
    ]);
    const sso = items.find((i) => i.text === "metro uses one SSO")!;
    expect(sso).toMatchObject({ project: "metro-app", date: "2026-10-21", source: "wiki/sources/b", details: ["- detail"] });
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("group item of an ungrouped project has group null", () => {
    project("alpha", []);
    write(
      "projects/alpha/wiki/open-questions.md",
      read("projects/alpha/wiki/open-questions.md") + "## Group candidates\n- 2026-10-21 — was grouped once\n",
    );
    expect(listCandidates(root).items).toMatchObject([{ text: "was grouped once", scope: "group", group: null }]);
  });

  it("clearCandidates removes from both sections", () => {
    project("metro-app", ["- 2026-10-20 — keep generic", "- 2026-10-20 — drop generic", "  - its detail"]);
    write("projects/metro-app/PROJECT.md", "---\ngroup: metro\n---\n");
    write(
      "projects/metro-app/wiki/open-questions.md",
      read("projects/metro-app/wiki/open-questions.md") +
        ["## Group candidates", "- 2026-10-21 — drop group", "  - group detail", "- 2026-10-21 — keep group", ""].join("\n"),
    );
    const items = listCandidates(root).items;
    const drop = items.filter((i) => i.text.startsWith("drop")).map((i) => i.id);
    expect(clearCandidates(root, drop)).toEqual({ removed: 2 });
    const text = read("projects/metro-app/wiki/open-questions.md");
    expect(text).not.toMatch(/drop|detail/);
    expect(listCandidates(root).items.map((i) => [i.text, i.scope])).toEqual([
      ["keep generic", "generic"],
      ["keep group", "group"],
    ]);
  });

  it("knowledge candidate ids are stable when a group section is added", () => {
    const line = "- 2026-10-20 — vitest pools share state (from [[wiki/sources/a]])";
    project("metro-app", [line]);
    write("projects/metro-app/PROJECT.md", "---\ngroup: metro\n---\n");
    const idOf = () =>
      listCandidates(root).items.find((i) => i.scope === "generic" && i.text === "vitest pools share state")!.id;
    const before = idOf();
    const group = ["## Group candidates", "- 2026-10-21 — metro uses one SSO", ""];
    const knowledge = ["## Knowledge candidates", line, ""];
    const head = ["# Open questions", "", "## Gaps", "- 2026-10-20 — gap one", ""];

    // Group section after Knowledge.
    write("projects/metro-app/wiki/open-questions.md", [...head, ...knowledge, ...group].join("\n"));
    expect(listCandidates(root).items.map((i) => i.scope).sort()).toEqual(["generic", "group"]);
    expect(idOf()).toBe(before);

    // Group section before Knowledge.
    write("projects/metro-app/wiki/open-questions.md", [...head, ...group, ...knowledge].join("\n"));
    expect(listCandidates(root).items.map((i) => i.scope).sort()).toEqual(["generic", "group"]);
    expect(idOf()).toBe(before);
  });
});
