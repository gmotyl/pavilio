import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let tmpRoot = "";
let projectsDir = "";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir }),
}));
vi.mock("../../lib/discovery", async () => {
  const actual = await vi.importActual<typeof import("../../lib/discovery")>("../../lib/discovery");
  return { ...actual, discoverProjects: () => [] };
});

import projectsRouter, { isPlanPathAllowed } from "../projects";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", projectsRouter);
  return app;
}

function seedFile(abs: string, content = "x") {
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pavilio-plans-test-"));
  // workspace root = resolve(projectsDir, "..") = <tmpRoot>/workspace
  const workspace = join(tmpRoot, "workspace");
  projectsDir = join(workspace, "projects");
  mkdirSync(projectsDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("isPlanPathAllowed", () => {
  it("accepts a .md file under an allowed dir", () => {
    expect(isPlanPathAllowed("/tmp/x/plans/a.md", ["/tmp/x/plans"])).toBe(true);
  });
  it("rejects the dir itself", () => {
    expect(isPlanPathAllowed("/tmp/x/plans", ["/tmp/x/plans"])).toBe(false);
  });
  it("rejects a non-.md file", () => {
    expect(isPlanPathAllowed("/tmp/x/plans/a.txt", ["/tmp/x/plans"])).toBe(false);
  });
  it("rejects a path outside all dirs", () => {
    expect(isPlanPathAllowed("/etc/passwd", ["/tmp/x/plans"])).toBe(false);
  });
  it("rejects null-byte", () => {
    expect(isPlanPathAllowed("/tmp/x/plans/a.md\0", ["/tmp/x/plans"])).toBe(false);
  });
});

describe("GET /api/projects/:name/plans-tree", () => {
  it("always returns the project source (even when empty)", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const res = await request(makeApp()).get("/api/projects/alokai/plans-tree");
    expect(res.status).toBe(200);
    const project = res.body.sources.find((s: { id: string }) => s.id === "project");
    expect(project).toBeTruthy();
    expect(project.files).toHaveLength(0);
  });

  it("lists project plans with relativeToProjectsDir set", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    seedFile(join(projectsDir, "alokai", "plans", "2026-01-01-foo.md"), "# foo");
    const res = await request(makeApp()).get("/api/projects/alokai/plans-tree");
    const project = res.body.sources.find((s: { id: string }) => s.id === "project");
    expect(project.files).toHaveLength(1);
    expect(project.files[0].filename).toBe("2026-01-01-foo.md");
    expect(project.files[0].relativeToProjectsDir).toBe("alokai/plans/2026-01-01-foo.md");
  });

  it("includes the workspace .kilo/plans source when it has files", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    seedFile(join(tmpRoot, "workspace", ".kilo", "plans", "woo.md"), "# woo");
    const res = await request(makeApp()).get("/api/projects/alokai/plans-tree");
    const ws = res.body.sources.find((s: { id: string }) => s.id === "workspace");
    expect(ws).toBeTruthy();
    expect(ws.files[0].filename).toBe("woo.md");
    expect(ws.files[0].relativeToProjectsDir).toBeNull();
  });

  it("omits the workspace source when it has no files", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const res = await request(makeApp()).get("/api/projects/alokai/plans-tree");
    expect(res.body.sources.find((s: { id: string }) => s.id === "workspace")).toBeUndefined();
  });

  it("includes a per-repo .kilo/plans source from repos.json", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const repoPath = join(tmpRoot, "repos", "pavilio");
    seedFile(join(repoPath, ".kilo", "plans", "checkout.md"), "# checkout");
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repoPath }]),
    );
    const res = await request(makeApp()).get("/api/projects/alokai/plans-tree");
    const repo = res.body.sources.find((s: { id: string }) => s.id === "repo:pavilio");
    expect(repo).toBeTruthy();
    expect(repo.files[0].filename).toBe("checkout.md");
  });

  it("returns 404 for unknown project", async () => {
    const res = await request(makeApp()).get("/api/projects/ghost/plans-tree");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:name/plans/read", () => {
  it("reads a project plan file", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const target = join(projectsDir, "alokai", "plans", "foo.md");
    seedFile(target, "# foo body");
    const res = await request(makeApp()).get(
      `/api/projects/alokai/plans/read?path=${encodeURIComponent(target)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("# foo body");
  });

  it("reads a workspace .kilo/plans file", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const target = join(tmpRoot, "workspace", ".kilo", "plans", "woo.md");
    seedFile(target, "# woo body");
    const res = await request(makeApp()).get(
      `/api/projects/alokai/plans/read?path=${encodeURIComponent(target)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("# woo body");
  });

  it("rejects a path outside the allowlist with 403", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const res = await request(makeApp()).get(
      `/api/projects/alokai/plans/read?path=${encodeURIComponent("/etc/passwd")}`,
    );
    expect(res.status).toBe(403);
  });

  it("rejects a non-.md file inside the plans dir with 403", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const target = join(projectsDir, "alokai", "plans", "secret.txt");
    seedFile(target, "leak");
    const res = await request(makeApp()).get(
      `/api/projects/alokai/plans/read?path=${encodeURIComponent(target)}`,
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when path is missing", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const res = await request(makeApp()).get("/api/projects/alokai/plans/read");
    expect(res.status).toBe(400);
  });
});
