import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { configMock, makeApp } from "../../test-kit";

let tmpRoot = "";
let projectsDir = "";

vi.mock("../../config", () => configMock(() => projectsDir));

import projectsRouter, { type WikiTree, type WikiPageInfo } from "../projects";

function seed(rel: string, content = "x") {
  const abs = join(projectsDir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

const page = (fm: Record<string, string | string[]>, body = "") =>
  "---\n" +
  Object.entries(fm)
    .map(([k, v]) => (Array.isArray(v) ? `${k}: [${v.join(", ")}]` : `${k}: ${v}`))
    .join("\n") +
  "\n---\n" +
  body;

function seedWiki() {
  seed("alpha/PROJECT.md", "# alpha");
  const w = "alpha/wiki/";
  seed(w + "index.md", page({ type: "index" }, "[[wiki/concepts/caching]] [[wiki/entities/ann]]"));
  seed(w + "log.md", "log");
  seed(w + "raw/blob.md", "raw");
  seed(w + "overview.md", page({ type: "overview", description: "The big picture" }, "# Overview\n"));
  seed(
    w + "entities/ann.md",
    page({ type: "entity", kind: "person", description: "Ann", updated: "2026-10-19" }, "# Ann Lee\n"),
  );
  seed(w + "entities/bob.md", page({ type: "entity", kind: "person" }, "# Bob\n"));
  seed(w + "entities/pavilio.md", page({ type: "entity", kind: "repository" }, "# pavilio\n"));
  seed(
    w + "concepts/caching.md",
    page(
      { type: "concept", description: "How we cache", created: "2026-10-01", updated: "2026-10-18", sources: ["\"[[wiki/sources/doc-spec]]\""] },
      "# Caching\nSee [[wiki/entities/ann]].\n",
    ),
  );
  seed(w + "repos/pavilio/index.md", page({ type: "index" }, "# pavilio code"));
  seed(w + "repos/pavilio/ARCHITECTURE.md", page({ type: "repo", concepts: ["caching"] }, "# Architecture\n"));
  seed(w + "repos/pavilio/server.md", page({ type: "repo" }, "# Server\n[[wiki/concepts/caching]]"));
  seed(
    w + "open-questions.md",
    page({ type: "questions" }, "# Open questions\n\n- one?\n  - nested detail\n* two?\n\n```\n- fenced\n```\n- three?\n"),
  );
  seed(w + "notes/n1.md", page({ type: "note" }, "# Note one\n"));
  seed(w + "questions/q1.md", page({ type: "question" }, "# Why?\n[[wiki/concepts/caching]]"));
  seed(
    w + "sources/meeting-2026-10-19-sync.md",
    page({ type: "source", entities: ["ann", "bob"], concepts: ["caching"] }, "# Sync\n"),
  );
  seed(w + "sources/meeting-2026-10-18-kickoff.md", page({ type: "source", entities: ["ann"] }, "# Kickoff\n"));
  seed(w + "sources/doc-spec.md", page({ type: "source" }, "# Spec\n"));
  seed(w + "sources/article/hn-post.md", page({ type: "source", concepts: ["caching"] }, "# HN post\n"));
}

const paths = (pages: WikiPageInfo[]) => pages.map((p) => p.path);

function findPage(tree: WikiTree, path: string): WikiPageInfo | undefined {
  const all: WikiPageInfo[] = [
    ...(tree.overview ? [tree.overview] : []),
    ...tree.entities.kinds.flatMap((k) => k.pages),
    ...tree.concepts.pages,
    ...tree.repos.repos.flatMap((r) => r.pages),
    ...(tree.interaction.openQuestions ? [tree.interaction.openQuestions] : []),
    ...tree.interaction.notes,
    ...tree.interaction.questions,
    ...tree.sources.kinds.flatMap((k) => k.pages),
    ...tree.other,
  ];
  return all.find((p) => p.path === path);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-wiki-test-"));
  projectsDir = join(tmpRoot, "workspace", "projects");
  mkdirSync(projectsDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/projects (wiki)", () => {
  it("discovery reports hasWiki", async () => {
    seedWiki();
    seed("beta/PROJECT.md", "# beta");
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects");
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.map((p: { name: string; hasWiki: boolean }) => [p.name, p.hasWiki]));
    expect(byName).toEqual({ alpha: true, beta: false });
  });

  it("a plain file named wiki is not a wiki", async () => {
    seed("gamma/PROJECT.md", "# gamma");
    seed("gamma/wiki", "not a dir");
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects");
    expect(res.body.find((p: { name: string }) => p.name === "gamma").hasWiki).toBe(false);
  });
});

describe("GET /api/projects/:name/wiki", () => {
  it("returns the wiki tree with counts", async () => {
    seedWiki();
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alpha/wiki");
    expect(res.status).toBe(200);
    const tree = res.body as WikiTree;
    expect(tree.project).toBe("alpha");

    expect(tree.overview).toMatchObject({
      path: "wiki/overview.md",
      title: "Overview",
      description: "The big picture",
      type: "overview",
    });

    expect(tree.entities.count).toBe(3);
    expect(tree.entities.kinds.map((k) => [k.kind, k.count])).toEqual([
      ["person", 2],
      ["repository", 1],
    ]);
    expect(paths(tree.entities.kinds[0].pages)).toEqual(["wiki/entities/ann.md", "wiki/entities/bob.md"]);
    expect(tree.entities.kinds[0].pages[0]).toMatchObject({ title: "Ann Lee", updated: "2026-10-19", created: null });

    expect(tree.concepts.count).toBe(1);
    expect(tree.concepts.pages[0]).toMatchObject({
      path: "wiki/concepts/caching.md",
      title: "Caching",
      description: "How we cache",
      type: "concept",
      created: "2026-10-01",
      updated: "2026-10-18",
    });

    // Generated index.md pages are navigation, never listed.
    expect(tree.repos.count).toBe(2);
    expect(tree.repos.repos.map((r) => [r.name, r.count])).toEqual([["pavilio", 2]]);
    expect(paths(tree.repos.repos[0].pages)).toEqual([
      "wiki/repos/pavilio/ARCHITECTURE.md",
      "wiki/repos/pavilio/server.md",
    ]);

    expect(tree.interaction.openQuestions?.path).toBe("wiki/open-questions.md");
    expect(paths(tree.interaction.notes)).toEqual(["wiki/notes/n1.md"]);
    expect(paths(tree.interaction.questions)).toEqual(["wiki/questions/q1.md"]);
    expect(tree.interaction.count).toBe(3);
    expect(tree.interaction.openQuestionsCount).toBe(3);

    // Kind from the filename prefix or from a subdir.
    expect(tree.sources.count).toBe(4);
    expect(tree.sources.kinds.map((k) => [k.kind, k.count])).toEqual([
      ["article", 1],
      ["doc", 1],
      ["meeting", 2],
    ]);
    expect(paths(tree.sources.kinds[2].pages)).toEqual([
      "wiki/sources/meeting-2026-10-18-kickoff.md",
      "wiki/sources/meeting-2026-10-19-sync.md",
    ]);

    expect(tree.other).toEqual([]);
    const all = JSON.stringify(tree);
    expect(all).not.toContain("index.md");
    expect(all).not.toContain("log.md");
    expect(all).not.toContain("raw/");
  });

  it("returns backlinks and source pages per page", async () => {
    seedWiki();
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alpha/wiki");
    const tree = res.body as WikiTree;

    const caching = findPage(tree, "wiki/concepts/caching.md")!;
    // Index pages link to everything, so they never count as backlinks.
    expect(caching.backlinks).toEqual(["wiki/questions/q1.md", "wiki/repos/pavilio/server.md"]);
    // Mentions from source-like pages plus the page's own `sources:` list.
    expect(caching.sources).toEqual([
      "wiki/repos/pavilio/ARCHITECTURE.md",
      "wiki/sources/article/hn-post.md",
      "wiki/sources/doc-spec.md",
      "wiki/sources/meeting-2026-10-19-sync.md",
    ]);
    expect(caching.sourceCount).toBe(4);

    const ann = findPage(tree, "wiki/entities/ann.md")!;
    expect(ann.backlinks).toEqual(["wiki/concepts/caching.md"]);
    expect(ann.sources).toEqual([
      "wiki/sources/meeting-2026-10-18-kickoff.md",
      "wiki/sources/meeting-2026-10-19-sync.md",
    ]);
    expect(ann.sourceCount).toBe(2);

    const bob = findPage(tree, "wiki/entities/bob.md")!;
    expect(bob.backlinks).toEqual([]);
    expect(bob.sources).toEqual(["wiki/sources/meeting-2026-10-19-sync.md"]);
  });

  it("reports a null open-questions count without open-questions.md", async () => {
    seed("beta/PROJECT.md", "# beta");
    seed("beta/wiki/overview.md", page({ type: "overview" }, "# O\n"));
    const tree = (await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/beta/wiki")).body as WikiTree;
    expect(tree.interaction.openQuestions).toBeNull();
    expect(tree.interaction.openQuestionsCount).toBeNull();
  });

  it("honours a projectsDir not named projects", async () => {
    projectsDir = join(tmpRoot, "workspace", "store");
    mkdirSync(projectsDir, { recursive: true });
    seedWiki();
    const tree = (await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alpha/wiki")).body as WikiTree;
    expect(findPage(tree, "wiki/concepts/caching.md")!.backlinks).toEqual([
      "wiki/questions/q1.md",
      "wiki/repos/pavilio/server.md",
    ]);
  });

  it("404s without a wiki", async () => {
    seed("beta/PROJECT.md", "# beta");
    const app = makeApp(projectsRouter, "/api/projects");
    expect((await request(app).get("/api/projects/beta/wiki")).status).toBe(404);
    expect((await request(app).get("/api/projects/missing/wiki")).status).toBe(404);
    expect((await request(app).get("/api/projects/..%2F..%2Fetc/wiki")).status).toBe(404);
  });
});
