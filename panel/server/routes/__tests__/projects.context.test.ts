import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { configMock, makeApp, withProjectsDir } from "../../test-kit";

const projects = withProjectsDir("pavilio-context-test-");

vi.mock("../../config", () => configMock(() => projects.dir()));
vi.mock("../../lib/discovery", async () => {
  const actual = await vi.importActual<typeof import("../../lib/discovery")>("../../lib/discovery");
  return { ...actual, discoverProjects: () => [] };
});

import projectsRouter, { buildContextAllowlist } from "../projects";

function seedFile(rel: string, content = "x") {
  const abs = join(projects.root(), rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}
function seedDir(rel: string) {
  mkdirSync(join(projects.root(), rel), { recursive: true });
}

describe("GET /api/projects/:name/context", () => {
  it("aggregates project-local CONTEXT.md and ADRs", async () => {
    seedFile("projects/alokai/PROJECT.md");
    seedFile("projects/alokai/CONTEXT.md", "# alokai context");
    seedDir("projects/alokai/adr");
    seedFile("projects/alokai/adr/0001-foo-bar.md", "# adr 1");
    seedFile("projects/alokai/adr/0002-baz.md", "# adr 2");

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/context");
    expect(res.status).toBe(200);
    expect(res.body.contexts).toHaveLength(1);
    expect(res.body.contexts[0].source).toBe("project");
    expect(res.body.contexts[0].filename).toBe("CONTEXT.md");
    expect(res.body.adrs).toHaveLength(2);
    expect(res.body.adrs[0].adrNumber).toBe(1);
    expect(res.body.adrs[0].slug).toBe("foo-bar");
    expect(res.body.adrs[1].adrNumber).toBe(2);
  });

  it("aggregates linked-repo CONTEXT.md and ADRs", async () => {
    seedFile("projects/alokai/PROJECT.md");
    const repoPath = join(projects.root(), "repos", "pavilio");
    mkdirSync(repoPath, { recursive: true });
    writeFileSync(join(repoPath, "CONTEXT.md"), "# pavilio");
    mkdirSync(join(repoPath, "docs", "adr"), { recursive: true });
    writeFileSync(join(repoPath, "docs", "adr", "0001-notes-vs-repo.md"), "# adr");

    writeFileSync(
      join(projects.dir(), "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repoPath }]),
    );

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/context");
    expect(res.status).toBe(200);
    const contextSources = res.body.contexts.map((c: { source: string }) => c.source);
    expect(contextSources).toContain("repo:pavilio");
    const adrSources = res.body.adrs.map((a: { source: string }) => a.source);
    expect(adrSources).toContain("repo:pavilio");
  });

  it("includes relativeToProjectsDir for project-source files and null for repo-source", async () => {
    seedFile("projects/alokai/PROJECT.md");
    seedFile("projects/alokai/CONTEXT.md");
    seedDir("projects/alokai/adr");
    seedFile("projects/alokai/adr/0001-x.md");
    const repoPath = join(projects.root(), "repos", "pavilio");
    mkdirSync(repoPath, { recursive: true });
    writeFileSync(join(repoPath, "CONTEXT.md"), "");
    writeFileSync(
      join(projects.dir(), "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repoPath }]),
    );

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/context");
    expect(res.status).toBe(200);
    const projectCtx = res.body.contexts.find((c: { source: string }) => c.source === "project");
    expect(projectCtx.relativeToProjectsDir).toBe("alokai/CONTEXT.md");
    const repoCtx = res.body.contexts.find((c: { source: string }) => c.source === "repo:pavilio");
    expect(repoCtx.relativeToProjectsDir).toBeNull();
    const projectAdr = res.body.adrs.find((a: { source: string }) => a.source === "project");
    expect(projectAdr.relativeToProjectsDir).toBe("alokai/adr/0001-x.md");
  });

  it("prefers docs/adr over adr when both exist", async () => {
    seedFile("projects/alokai/PROJECT.md");
    seedDir("projects/alokai/adr");
    seedFile("projects/alokai/adr/0001-old.md");
    seedDir("projects/alokai/docs/adr");
    seedFile("projects/alokai/docs/adr/0001-new.md");

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/context");
    expect(res.body.adrs).toHaveLength(1);
    expect(res.body.adrs[0].filename).toBe("0001-new.md");
  });

  it("returns 404 for unknown project", async () => {
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/ghost/context");
    expect(res.status).toBe(404);
  });

  it("blocks project name path traversal", async () => {
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/..%2Fetc/context");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:name/context — OpenSpec living specs", () => {
  it("returns nested OpenSpec living capability specs", async () => {
    seedFile("projects/alokai/PROJECT.md");
    // Native repo living spec.
    const repoPath = join(projects.root(), "repos", "pavilio");
    mkdirSync(join(repoPath, "openspec", "specs", "checkout"), { recursive: true });
    writeFileSync(join(repoPath, "openspec", "specs", "checkout", "spec.md"), "# checkout spec");
    // Project-store living spec.
    mkdirSync(join(projects.dir(), "alokai", "plans", "openspec", "specs", "billing"), { recursive: true });
    writeFileSync(
      join(projects.dir(), "alokai", "plans", "openspec", "specs", "billing", "spec.md"),
      "# billing spec",
    );
    writeFileSync(
      join(projects.dir(), "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repoPath, openspec: { mode: "native" } }]),
    );

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/context");
    expect(res.status).toBe(200);
    const specs = res.body.openspecSpecs as { source: string; capability: string }[];
    const repoSpec = specs.find((s) => s.source === "openspec:repo:pavilio");
    // Non-null: a missing spec throws on .capability and fails the test as before.
    expect(repoSpec!.capability).toBe("checkout");
    const projSpec = specs.find((s) => s.source === "openspec:project");
    expect(projSpec!.capability).toBe("billing");
  });

  it("reads and rejects OpenSpec living specs per configured root", async () => {
    seedFile("projects/alokai/PROJECT.md");
    const repoPath = join(projects.root(), "repos", "pavilio");
    mkdirSync(join(repoPath, "openspec", "specs", "checkout"), { recursive: true });
    writeFileSync(join(repoPath, "openspec", "specs", "checkout", "spec.md"), "# checkout spec");
    writeFileSync(
      join(projects.dir(), "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repoPath, openspec: { mode: "native" } }]),
    );
    const allowed = join(repoPath, "openspec", "specs", "checkout", "spec.md");
    const ok = await request(makeApp(projectsRouter, "/api/projects")).get(
      `/api/projects/alokai/context/read?path=${encodeURIComponent(allowed)}`,
    );
    expect(ok.status).toBe(200);
    expect(ok.body.content).toBe("# checkout spec");
  });

  it("rejects OpenSpec living specs from an unconfigured repo", async () => {
    seedFile("projects/alokai/PROJECT.md");
    const repoPath = join(projects.root(), "repos", "pavilio");
    mkdirSync(join(repoPath, "openspec", "specs", "checkout"), { recursive: true });
    writeFileSync(join(repoPath, "openspec", "specs", "checkout", "spec.md"), "# leak");
    writeFileSync(
      join(projects.dir(), "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repoPath }]),
    );
    const rogue = join(repoPath, "openspec", "specs", "checkout", "spec.md");
    const res = await request(makeApp(projectsRouter, "/api/projects")).get(
      `/api/projects/alokai/context/read?path=${encodeURIComponent(rogue)}`,
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/projects/:name/context/read", () => {
  it("reads a CONTEXT.md inside a linked repo", async () => {
    seedFile("projects/alokai/PROJECT.md");
    const repoPath = join(projects.root(), "repos", "pavilio");
    mkdirSync(repoPath, { recursive: true });
    writeFileSync(join(repoPath, "CONTEXT.md"), "# pavilio");
    writeFileSync(
      join(projects.dir(), "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repoPath }]),
    );

    const res = await request(makeApp(projectsRouter, "/api/projects")).get(
      `/api/projects/alokai/context/read?path=${encodeURIComponent(join(repoPath, "CONTEXT.md"))}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("# pavilio");
  });

  it("rejects a path outside the allowlist with 403", async () => {
    seedFile("projects/alokai/PROJECT.md");
    const res = await request(makeApp(projectsRouter, "/api/projects")).get(
      `/api/projects/alokai/context/read?path=${encodeURIComponent("/etc/passwd")}`,
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when path is missing", async () => {
    seedFile("projects/alokai/PROJECT.md");
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/context/read");
    expect(res.status).toBe(400);
  });
});

describe("buildContextAllowlist", () => {
  it("includes the project dir + each linked repo's path", () => {
    const proj = join(projects.root(), "projects", "alokai");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "repos.json"),
      JSON.stringify([
        { name: "pavilio", path: "/Users/me/git/pavilio" },
        { name: "other", path: "/opt/other" },
      ]),
    );
    const out = buildContextAllowlist(proj);
    expect(out).toContain(proj);
    expect(out).toContain("/Users/me/git/pavilio");
    expect(out).toContain("/opt/other");
  });
});
