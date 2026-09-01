import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync } from "fs";
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

  it("exposes plans/archived as a separate 'project:archived' source, not in project", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    seedFile(join(projectsDir, "alokai", "plans", "2026-01-01-active.md"), "# active");
    seedFile(join(projectsDir, "alokai", "plans", "archived", "2026-01-01-old-design.md"), "# old");
    const res = await request(makeApp()).get("/api/projects/alokai/plans-tree");
    const project = res.body.sources.find((s: { id: string }) => s.id === "project");
    const archived = res.body.sources.find((s: { id: string }) => s.id === "project:archived");
    // The active plan stays in the project source; the subdir file is not double-listed there.
    expect(project.files.map((f: { filename: string }) => f.filename)).toEqual(["2026-01-01-active.md"]);
    expect(archived).toBeTruthy();
    expect(archived.label).toBe("Archived");
    expect(archived.files.map((f: { filename: string }) => f.filename)).toEqual(["2026-01-01-old-design.md"]);
  });

  it("omits the archived source when there are no archived plans", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    seedFile(join(projectsDir, "alokai", "plans", "2026-01-01-active.md"), "# active");
    const res = await request(makeApp()).get("/api/projects/alokai/plans-tree");
    expect(res.body.sources.find((s: { id: string }) => s.id === "project:archived")).toBeUndefined();
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

  it("reads an archived plan file (nested under plans/)", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const target = join(projectsDir, "alokai", "plans", "archived", "2026-01-01-old-design.md");
    seedFile(target, "# archived body");
    const res = await request(makeApp()).get(
      `/api/projects/alokai/plans/read?path=${encodeURIComponent(target)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("# archived body");
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

  it("rejects a symlink inside an allowed dir with 403 (no symlink follow)", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const secret = join(tmpRoot, "secret.md");
    writeFileSync(secret, "top secret");
    const link = join(projectsDir, "alokai", "plans", "link.md");
    mkdirSync(join(link, ".."), { recursive: true });
    symlinkSync(secret, link);
    const res = await request(makeApp()).get(
      `/api/projects/alokai/plans/read?path=${encodeURIComponent(link)}`,
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/projects/:name/plans/current/:planFile", () => {
  it("appends a project plan line to CURRENT.md", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    seedFile(join(projectsDir, "alokai", "plans", "foo.md"), "# foo");
    const res = await request(makeApp()).post("/api/projects/alokai/plans/current/foo.md");
    expect(res.status).toBe(200);
    const current = readFileSync(join(projectsDir, "alokai", "plans", "CURRENT.md"), "utf-8");
    expect(current).toContain("projects/alokai/plans/foo.md");
  });

  it("is idempotent — does not duplicate an already-active plan", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    seedFile(join(projectsDir, "alokai", "plans", "foo.md"), "# foo");
    await request(makeApp()).post("/api/projects/alokai/plans/current/foo.md");
    await request(makeApp()).post("/api/projects/alokai/plans/current/foo.md");
    const current = readFileSync(join(projectsDir, "alokai", "plans", "CURRENT.md"), "utf-8");
    expect(current.match(/foo\.md/g)).toHaveLength(1);
  });

  it("returns 404 when the plan file does not exist", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const res = await request(makeApp()).post("/api/projects/alokai/plans/current/ghost.md");
    expect(res.status).toBe(404);
  });

  it("strips path traversal in the plan name (basename only)", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    // basename → "passwd.md", looked up only inside the project's plans dir → 404
    const res = await request(makeApp()).post(
      `/api/projects/alokai/plans/current/${encodeURIComponent("../../etc/passwd.md")}`,
    );
    expect(res.status).toBe(404);
  });
});

// --- OpenSpec-aware plan sources (Task 2) --------------------------------------

/** Seed a full change dir with proposal/design/tasks + a delta spec. */
function seedChange(openspecDir: string, changeId: string) {
  seedFile(join(openspecDir, "changes", changeId, "proposal.md"), "# proposal");
  seedFile(join(openspecDir, "changes", changeId, "design.md"), "# design");
  seedFile(join(openspecDir, "changes", changeId, "tasks.md"), "# tasks");
  seedFile(join(openspecDir, "changes", changeId, "specs", "checkout", "spec.md"), "# delta");
}

describe("GET /api/projects/:name/plans-tree — OpenSpec sources", () => {
  it("lists active and archived native OpenSpec change artifacts", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const repoPath = join(tmpRoot, "repos", "pavilio");
    const openspecDir = join(repoPath, "openspec");
    seedChange(openspecDir, "add-checkout");
    seedFile(join(openspecDir, "changes", "archive", "2026-08-01-old-thing", "proposal.md"), "# old");
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repoPath, openspec: { mode: "native" } }]),
    );

    const res = await request(makeApp()).get("/api/projects/alokai/plans-tree");
    expect(res.status).toBe(200);
    const src = res.body.sources.find((s: { id: string }) => s.id === "openspec:repo:pavilio");
    expect(src).toBeTruthy();
    expect(src.kind).toBe("openspec");
    expect(src.mode).toBe("native");

    const active = src.changes.find((c: { changeId: string }) => c.changeId === "add-checkout");
    expect(active.status).toBe("active");
    const kinds = active.artifacts.map((a: { kind: string }) => a.kind).sort();
    expect(kinds).toEqual(["design", "proposal", "spec", "tasks"]);
    const delta = active.artifacts.find((a: { kind: string }) => a.kind === "spec");
    expect(delta.capability).toBe("checkout");

    const archived = src.changes.find((c: { changeId: string }) => c.changeId === "2026-08-01-old-thing");
    expect(archived.status).toBe("archived");
    expect(archived.archiveDate).toBe("2026-08-01");
  });

  it("lists a store OpenSpec tree with the same logical shape", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const repoPath = join(tmpRoot, "repos", "pavilio");
    // Store mode: tree mirrored under the project, NOT inside the repo.
    const storeOpenspec = join(projectsDir, "alokai", "plans", "pavilio", "openspec");
    seedChange(storeOpenspec, "add-checkout");
    // Intentionally leave the repo without any openspec/ dir to prove no repo read.
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repoPath, openspec: { mode: "store" } }]),
    );

    const res = await request(makeApp()).get("/api/projects/alokai/plans-tree");
    const src = res.body.sources.find((s: { id: string }) => s.id === "openspec:repo:pavilio");
    expect(src).toBeTruthy();
    expect(src.mode).toBe("store");
    expect(existsSync(join(repoPath, "openspec"))).toBe(false);
    const change = src.changes.find((c: { changeId: string }) => c.changeId === "add-checkout");
    expect(change.status).toBe("active");
    expect(change.artifacts.map((a: { kind: string }) => a.kind).sort()).toEqual([
      "design",
      "proposal",
      "spec",
      "tasks",
    ]);
  });

  it("surfaces a configured repo source whose OpenSpec dir does not exist", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const repoPath = join(tmpRoot, "repos", "pavilio");
    // The change lives under plans/pavilio/, but the config points elsewhere —
    // the classic workspace-relative `root` typo. Nothing to list, and the
    // source must still be surfaced so the typo is visible.
    seedChange(join(projectsDir, "alokai", "plans", "pavilio", "openspec"), "add-checkout");
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([
        {
          name: "pavilio",
          path: repoPath,
          openspec: { mode: "store", root: "projects/alokai/plans/pavilio" },
        },
      ]),
    );

    const res = await request(makeApp()).get("/api/projects/alokai/plans-tree");
    const src = res.body.sources.find((s: { id: string }) => s.id === "openspec:repo:pavilio");
    expect(src).toBeTruthy();
    expect(src.missing).toBe(true);
    expect(src.changes).toHaveLength(0);
    expect(src.openspecDir).toBe(
      join(projectsDir, "alokai", "projects", "alokai", "plans", "pavilio", "openspec"),
    );
  });

  it("omits a configured source whose OpenSpec dir exists but holds no changes", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const repoPath = join(tmpRoot, "repos", "pavilio");
    mkdirSync(join(projectsDir, "alokai", "plans", "pavilio", "openspec"), { recursive: true });
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repoPath, openspec: { mode: "store" } }]),
    );

    const res = await request(makeApp()).get("/api/projects/alokai/plans-tree");
    expect(res.body.sources.find((s: { id: string }) => s.id === "openspec:repo:pavilio")).toBeUndefined();
  });

  it("never reports the implicit project store as missing", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const res = await request(makeApp()).get("/api/projects/alokai/plans-tree");
    // plans/openspec/ was never created and was never configured — not a typo.
    expect(res.body.sources.find((s: { id: string }) => s.id === "openspec:project")).toBeUndefined();
  });

  it("carries the same change id across repository sources", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const repoPath = join(tmpRoot, "repos", "pavilio");
    // Same change id in the project store and in a native repo.
    seedFile(join(projectsDir, "alokai", "plans", "openspec", "changes", "add-foo", "proposal.md"), "# a");
    seedFile(join(repoPath, "openspec", "changes", "add-foo", "proposal.md"), "# b");
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repoPath, openspec: { mode: "native" } }]),
    );

    const res = await request(makeApp()).get("/api/projects/alokai/plans-tree");
    const projectSrc = res.body.sources.find((s: { id: string }) => s.id === "openspec:project");
    const repoSrc = res.body.sources.find((s: { id: string }) => s.id === "openspec:repo:pavilio");
    const projChange = projectSrc.changes.find((c: { changeId: string }) => c.changeId === "add-foo");
    const repoChange = repoSrc.changes.find((c: { changeId: string }) => c.changeId === "add-foo");
    expect(projChange.changeId).toBe("add-foo");
    expect(repoChange.changeId).toBe("add-foo");
    expect(projChange.source).toBe("openspec:project");
    expect(repoChange.source).toBe("openspec:repo:pavilio");
  });

  it("marks changes active vs archived by directory", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const openspecDir = join(projectsDir, "alokai", "plans", "openspec");
    seedFile(join(openspecDir, "changes", "live-change", "proposal.md"), "# live");
    seedFile(join(openspecDir, "changes", "archive", "2026-08-01-done-change", "proposal.md"), "# done");

    const res = await request(makeApp()).get("/api/projects/alokai/plans-tree");
    const src = res.body.sources.find((s: { id: string }) => s.id === "openspec:project");
    const live = src.changes.find((c: { changeId: string }) => c.changeId === "live-change");
    const done = src.changes.find((c: { changeId: string }) => c.changeId === "2026-08-01-done-change");
    expect(live.status).toBe("active");
    expect(done.status).toBe("archived");
  });

  it("keeps legacy flat project plans readable", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const target = join(projectsDir, "alokai", "plans", "2026-01-01-foo.md");
    seedFile(target, "# legacy body");
    const tree = await request(makeApp()).get("/api/projects/alokai/plans-tree");
    const project = tree.body.sources.find((s: { id: string }) => s.id === "project");
    expect(project.files.map((f: { filename: string }) => f.filename)).toContain("2026-01-01-foo.md");
    const read = await request(makeApp()).get(
      `/api/projects/alokai/plans/read?path=${encodeURIComponent(target)}`,
    );
    expect(read.status).toBe(200);
    expect(read.body.content).toBe("# legacy body");
  });

  it("no longer exposes kilo/claude sources or the move endpoint", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    seedFile(join(tmpRoot, "workspace", ".kilo", "plans", "woo.md"), "# woo");
    const repoPath = join(tmpRoot, "repos", "pavilio");
    seedFile(join(repoPath, ".kilo", "plans", "x.md"), "# x");
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repoPath }]),
    );
    const res = await request(makeApp()).get("/api/projects/alokai/plans-tree");
    const ids = res.body.sources.map((s: { id: string }) => s.id);
    expect(ids).not.toContain("workspace");
    expect(ids).not.toContain("claude");
    expect(ids).not.toContain("repo:pavilio");

    const move = await request(makeApp())
      .post("/api/projects/alokai/plans/move")
      .send({ from: join(tmpRoot, "workspace", ".kilo", "plans", "woo.md"), toId: "project" });
    expect(move.status).toBe(404);
  });

  it("rejects OpenSpec-shaped traversal outside configured roots", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const repoPath = join(tmpRoot, "repos", "pavilio");
    // Repo has an openspec tree but is NOT configured for OpenSpec.
    const rogue = join(repoPath, "openspec", "changes", "sneaky", "proposal.md");
    seedFile(rogue, "# leak");
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repoPath }]),
    );
    const res = await request(makeApp()).get(
      `/api/projects/alokai/plans/read?path=${encodeURIComponent(rogue)}`,
    );
    expect(res.status).toBe(403);

    // Traversal that resolves outside the project store openspec root.
    const traversal = join(projectsDir, "alokai", "plans", "openspec", "..", "..", "..", "..", "etc", "passwd.md");
    const res2 = await request(makeApp()).get(
      `/api/projects/alokai/plans/read?path=${encodeURIComponent(traversal)}`,
    );
    expect(res2.status).toBe(403);
  });
});
