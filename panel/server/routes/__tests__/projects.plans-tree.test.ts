import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  existsSync,
  realpathSync,
} from "fs";
import { spawnSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { configMock, makeApp } from "../../test-kit";
import { gitSafeEnv } from "../../lib/gitEnv";

let tmpRoot = "";
let projectsDir = "";

vi.mock("../../config", () => configMock(() => projectsDir));
vi.mock("../../lib/discovery", async () => {
  const actual = await vi.importActual<typeof import("../../lib/discovery")>("../../lib/discovery");
  return { ...actual, discoverProjects: () => [] };
});

// Wrapped (not replaced) so tests can assert which repos run worktree discovery.
vi.mock("../../lib/worktrees", async () => {
  const actual = await vi.importActual<typeof import("../../lib/worktrees")>("../../lib/worktrees");
  return { ...actual, listRepoWorktrees: vi.fn(actual.listRepoWorktrees) };
});

import projectsRouter from "../projects";
import { listRepoWorktrees } from "../../lib/worktrees";

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
  vi.mocked(listRepoWorktrees).mockClear();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/projects/:name/plans-tree", () => {
  it("always returns the project source (even when empty)", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    expect(res.status).toBe(200);
    const project = res.body.sources.find((s: { id: string }) => s.id === "project");
    expect(project).toBeTruthy();
    expect(project.files).toHaveLength(0);
  });

  it("lists project plans with relativeToProjectsDir set", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    seedFile(join(projectsDir, "alokai", "plans", "2026-01-01-foo.md"), "# foo");
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    const project = res.body.sources.find((s: { id: string }) => s.id === "project");
    expect(project.files).toHaveLength(1);
    expect(project.files[0].filename).toBe("2026-01-01-foo.md");
    expect(project.files[0].relativeToProjectsDir).toBe("alokai/plans/2026-01-01-foo.md");
  });

  it("exposes plans/archived as a separate 'project:archived' source, not in project", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    seedFile(join(projectsDir, "alokai", "plans", "2026-01-01-active.md"), "# active");
    seedFile(join(projectsDir, "alokai", "plans", "archived", "2026-01-01-old-design.md"), "# old");
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
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
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    expect(res.body.sources.find((s: { id: string }) => s.id === "project:archived")).toBeUndefined();
  });

  it("returns 404 for unknown project", async () => {
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/ghost/plans-tree");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:name/plans/read", () => {
  it("reads a project plan file", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const target = join(projectsDir, "alokai", "plans", "foo.md");
    seedFile(target, "# foo body");
    const res = await request(makeApp(projectsRouter, "/api/projects")).get(
      `/api/projects/alokai/plans/read?path=${encodeURIComponent(target)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("# foo body");
  });

  it("reads an archived plan file (nested under plans/)", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const target = join(projectsDir, "alokai", "plans", "archived", "2026-01-01-old-design.md");
    seedFile(target, "# archived body");
    const res = await request(makeApp(projectsRouter, "/api/projects")).get(
      `/api/projects/alokai/plans/read?path=${encodeURIComponent(target)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("# archived body");
  });

  it("rejects a path outside the allowlist with 403", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const res = await request(makeApp(projectsRouter, "/api/projects")).get(
      `/api/projects/alokai/plans/read?path=${encodeURIComponent("/etc/passwd")}`,
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when path is missing", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans/read");
    expect(res.status).toBe(400);
  });

  it("rejects a symlink inside an allowed dir with 403 (no symlink follow)", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const secret = join(tmpRoot, "secret.md");
    writeFileSync(secret, "top secret");
    const link = join(projectsDir, "alokai", "plans", "link.md");
    mkdirSync(join(link, ".."), { recursive: true });
    symlinkSync(secret, link);
    const res = await request(makeApp(projectsRouter, "/api/projects")).get(
      `/api/projects/alokai/plans/read?path=${encodeURIComponent(link)}`,
    );
    expect(res.status).toBe(403);
  });
});

describe("/api/projects/:name/plans/current/:planFile (retired)", () => {
  it("the retired CURRENT.md endpoint answers 404 and writes nothing", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    seedFile(join(projectsDir, "alokai", "plans", "foo.md"), "# foo");
    const currentMd = join(projectsDir, "alokai", "plans", "CURRENT.md");

    const post = await request(makeApp(projectsRouter, "/api/projects")).post("/api/projects/alokai/plans/current/foo.md");
    expect(post.status).toBe(404);
    expect(existsSync(currentMd)).toBe(false);

    // Seed a legacy CURRENT.md so a live DELETE handler would answer 200 and rewrite it.
    writeFileSync(currentMd, "projects/alokai/plans/foo.md\n");
    const del = await request(makeApp(projectsRouter, "/api/projects")).delete("/api/projects/alokai/plans/current/foo.md");
    expect(del.status).toBe(404);
    expect(readFileSync(currentMd, "utf-8")).toBe("projects/alokai/plans/foo.md\n");
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

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
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

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
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

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    const src = res.body.sources.find((s: { id: string }) => s.id === "openspec:repo:pavilio");
    expect(src).toBeTruthy();
    expect(src.missing).toBe(true);
    expect(src.changes).toHaveLength(0);
    expect(src.openspecDir).toBe(
      join(projectsDir, "alokai", "projects", "alokai", "plans", "pavilio", "openspec"),
    );
  });

  it("surfaces a native root that escapes its repository instead of dropping the repo", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const repoPath = join(tmpRoot, "repos", "pavilio");
    // A tree exists next to the repo — the escaping root must neither be read
    // nor make the repo vanish from the tab.
    seedChange(join(tmpRoot, "repos", "sibling", "openspec"), "add-checkout");
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([
        { name: "pavilio", path: repoPath, openspec: { mode: "native", root: "../sibling" } },
      ]),
    );

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    const src = res.body.sources.find((s: { id: string }) => s.id === "openspec:repo:pavilio");
    expect(src).toBeTruthy();
    expect(src.kind).toBe("openspec-error");
    expect(src.configuredRoot).toBe("../sibling");
    expect(src.message).toMatch(/escapes/i);
    // Rejected config = nothing read: no changes are carried on an error source.
    expect(JSON.stringify(res.body)).not.toContain("add-checkout");
  });

  it("keeps an escaping root out of the plans allowlist", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const repoPath = join(tmpRoot, "repos", "pavilio");
    const outside = join(tmpRoot, "repos", "sibling", "openspec", "changes", "x", "proposal.md");
    seedFile(outside, "# outside");
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([
        { name: "pavilio", path: repoPath, openspec: { mode: "native", root: "../sibling" } },
      ]),
    );

    const res = await request(makeApp(projectsRouter, "/api/projects"))
      .get("/api/projects/alokai/plans/read")
      .query({ path: outside });
    expect(res.status).toBe(403);
  });

  it("surfaces an unknown OpenSpec mode as a config error", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([
        { name: "pavilio", path: join(tmpRoot, "repos", "pavilio"), openspec: { mode: "storee" } },
      ]),
    );

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    const src = res.body.sources.find((s: { id: string }) => s.id === "openspec:repo:pavilio");
    expect(src.kind).toBe("openspec-error");
    expect(src.configuredRoot).toBeNull();
    expect(src.message).toMatch(/mode/i);
  });

  it("omits a configured source whose OpenSpec dir exists but holds no changes", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const repoPath = join(tmpRoot, "repos", "pavilio");
    mkdirSync(join(projectsDir, "alokai", "plans", "pavilio", "openspec"), { recursive: true });
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repoPath, openspec: { mode: "store" } }]),
    );

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    expect(res.body.sources.find((s: { id: string }) => s.id === "openspec:repo:pavilio")).toBeUndefined();
  });

  it("never reports the implicit project store as missing", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
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

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
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

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
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
    const tree = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    const project = tree.body.sources.find((s: { id: string }) => s.id === "project");
    expect(project.files.map((f: { filename: string }) => f.filename)).toContain("2026-01-01-foo.md");
    const read = await request(makeApp(projectsRouter, "/api/projects")).get(
      `/api/projects/alokai/plans/read?path=${encodeURIComponent(target)}`,
    );
    expect(read.status).toBe(200);
    expect(read.body.content).toBe("# legacy body");
  });

  it("no longer exposes kilo/claude sources", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    seedFile(join(tmpRoot, "workspace", ".kilo", "plans", "woo.md"), "# woo");
    const repoPath = join(tmpRoot, "repos", "pavilio");
    seedFile(join(repoPath, ".kilo", "plans", "x.md"), "# x");
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repoPath }]),
    );
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    const ids = res.body.sources.map((s: { id: string }) => s.id);
    expect(ids).not.toContain("workspace");
    expect(ids).not.toContain("claude");
    expect(ids).not.toContain("repo:pavilio");
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
    const res = await request(makeApp(projectsRouter, "/api/projects")).get(
      `/api/projects/alokai/plans/read?path=${encodeURIComponent(rogue)}`,
    );
    expect(res.status).toBe(403);

    // Traversal that resolves outside the project store openspec root.
    const traversal = join(projectsDir, "alokai", "plans", "openspec", "..", "..", "..", "..", "etc", "passwd.md");
    const res2 = await request(makeApp(projectsRouter, "/api/projects")).get(
      `/api/projects/alokai/plans/read?path=${encodeURIComponent(traversal)}`,
    );
    expect(res2.status).toBe(403);
  });
});

// --- Legacy flat source visibility vs contributed OpenSpec changes -------------

describe("GET /api/projects/:name/plans-tree — empty legacy flat source", () => {
  // The legacy flat source carries its plan files; type them so callers can read them.
  const findProject = (body: { sources: { id: string; files: { filename: string }[] }[] }) =>
    body.sources.find((s) => s.id === "project");

  it("hides the empty legacy flat source when an OpenSpec source contributed changes", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    seedChange(join(projectsDir, "alokai", "plans", "openspec"), "add-checkout");

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    expect(res.status).toBe(200);
    // The OpenSpec store really did contribute a change …
    const os = res.body.sources.find((s: { id: string }) => s.id === "openspec:project");
    expect(os.changes.length).toBeGreaterThan(0);
    // … so the permanently empty flat node must not be serialized.
    expect(findProject(res.body)).toBeUndefined();
  });

  it("a linked-repo OpenSpec source contributing changes also hides the empty flat source", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    // Deliberately NO plans/openspec store: the ONLY contributor is a repo.
    const repoPath = join(tmpRoot, "repos", "pavilio");
    seedChange(join(repoPath, "openspec"), "add-checkout");
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repoPath, openspec: { mode: "native" } }]),
    );

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    expect(res.status).toBe(200);
    // The project store contributed nothing …
    expect(
      res.body.sources.find((s: { id: string }) => s.id === "openspec:project"),
    ).toBeUndefined();
    // … the linked repo did …
    const repoSrc = res.body.sources.find(
      (s: { id: string }) => s.id === "openspec:repo:pavilio",
    );
    expect(repoSrc.changes.length).toBeGreaterThan(0);
    // … and that alone is enough to drop the empty flat node.
    expect(findProject(res.body)).toBeUndefined();
  });

  it("keeps the empty legacy flat source when no OpenSpec source contributed changes", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    const project = findProject(res.body);
    expect(project).toBeTruthy();
    expect(project!.files).toHaveLength(0);
  });

  it("keeps a non-empty legacy flat source alongside OpenSpec changes", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    seedFile(join(projectsDir, "alokai", "plans", "2026-01-01-foo.md"), "# foo");
    seedChange(join(projectsDir, "alokai", "plans", "openspec"), "add-checkout");

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    const project = findProject(res.body);
    expect(project).toBeTruthy();
    expect(project!.files.map((f: { filename: string }) => f.filename)).toEqual(["2026-01-01-foo.md"]);
  });

  it("still drops an empty non-project legacy source", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    mkdirSync(join(projectsDir, "alokai", "plans", "archived"), { recursive: true });
    seedChange(join(projectsDir, "alokai", "plans", "openspec"), "add-checkout");

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    expect(res.body.sources.find((s: { id: string }) => s.id === "project:archived")).toBeUndefined();
  });

  it("a missing configured OpenSpec source does not count as a contributed change", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([
        {
          name: "pavilio",
          path: join(tmpRoot, "repos", "pavilio"),
          openspec: { mode: "store", root: "nowhere/at/all" },
        },
      ]),
    );

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    const src = res.body.sources.find((s: { id: string }) => s.id === "openspec:repo:pavilio");
    expect(src.missing).toBe(true);
    expect(src.changes).toHaveLength(0);
    // A surfaced-but-missing source contributed nothing, so the flat node stays.
    const project = findProject(res.body);
    expect(project).toBeTruthy();
    expect(project!.files).toHaveLength(0);
  });

  it("a rejected OpenSpec config does not count as a contributed change", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([
        { name: "pavilio", path: join(tmpRoot, "repos", "pavilio"), openspec: { mode: "storee" } },
      ]),
    );

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    const src = res.body.sources.find((s: { id: string }) => s.id === "openspec:repo:pavilio");
    expect(src.kind).toBe("openspec-error");
    const project = findProject(res.body);
    expect(project).toBeTruthy();
    expect(project!.files).toHaveLength(0);
  });

  it("serializes legacy sources before OpenSpec sources", async () => {
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    seedFile(join(projectsDir, "alokai", "plans", "2026-01-01-foo.md"), "# foo");
    seedFile(join(projectsDir, "alokai", "plans", "archived", "2026-01-01-old.md"), "# old");
    seedChange(join(projectsDir, "alokai", "plans", "openspec"), "add-checkout");
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([
        { name: "pavilio", path: join(tmpRoot, "repos", "pavilio"), openspec: { mode: "storee" } },
      ]),
    );

    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    const sources = res.body.sources as { id: string; kind?: string }[];
    expect(sources.map((s) => s.id)).toContain("project");
    expect(sources.map((s) => s.id)).toContain("project:archived");
    expect(sources.map((s) => s.id)).toContain("openspec:project");
    const legacyIdx = sources.flatMap((s, i) => (s.kind === undefined ? [i] : []));
    const openspecIdx = sources.flatMap((s, i) => (s.kind !== undefined ? [i] : []));
    expect(legacyIdx.length).toBeGreaterThan(0);
    expect(openspecIdx.length).toBeGreaterThan(0);
    expect(Math.max(...legacyIdx)).toBeLessThan(Math.min(...openspecIdx));
    // Legacy segment keeps its own order; the error source keeps its place first
    // within the OpenSpec segment.
    expect(sources[openspecIdx[0]].kind).toBe("openspec-error");
  });
});

describe("plans routes — archived project", () => {
  it("lists and reads an archived project's plans and OpenSpec changes", async () => {
    const dir = join(projectsDir, "archived", "delta");
    seedFile(join(dir, "PROJECT.md"));
    seedFile(join(dir, "plans", "2026-01-01-foo.md"), "# foo");
    seedFile(join(dir, "plans", "openspec", "changes", "2026-02-02-bar", "tasks.md"), "# bar");
    const app = makeApp(projectsRouter, "/api/projects");

    const tree = await request(app).get("/api/projects/delta/plans-tree");
    expect(tree.status).toBe(200);
    const project = tree.body.sources.find((s: { id: string }) => s.id === "project");
    expect(project.files.map((f: { relativeToProjectsDir: string }) => f.relativeToProjectsDir)).toEqual([
      "archived/delta/plans/2026-01-01-foo.md",
    ]);
    expect(tree.body.sources.some((s: { kind?: string }) => s.kind === "openspec")).toBe(true);

    const read = await request(app).get(
      `/api/projects/delta/plans/read?path=${encodeURIComponent(join(dir, "plans", "2026-01-01-foo.md"))}`,
    );
    expect(read.status).toBe(200);
    expect(read.body.content).toBe("# foo");
  });

  it("a live project wins over an archived one of the same name", async () => {
    seedFile(join(projectsDir, "delta", "PROJECT.md"));
    seedFile(join(projectsDir, "delta", "plans", "live.md"), "# live");
    seedFile(join(projectsDir, "archived", "delta", "PROJECT.md"));
    seedFile(join(projectsDir, "archived", "delta", "plans", "old.md"), "# old");
    const app = makeApp(projectsRouter, "/api/projects");
    const tree = await request(app).get("/api/projects/delta/plans-tree");
    const project = tree.body.sources.find((s: { id: string }) => s.id === "project");
    expect(project.files.map((f: { filename: string }) => f.filename)).toEqual(["live.md"]);
    const read = await request(app).get(
      `/api/projects/delta/plans/read?path=${encodeURIComponent(join(projectsDir, "archived", "delta", "plans", "old.md"))}`,
    );
    expect(read.status).toBe(403);
  });
});

// --- Native OpenSpec changes from linked worktrees ------------------------------

// Fixture git calls strip GIT_DIR & co: when the suite runs from a hook in a
// linked worktree those would otherwise retarget the real repository.
function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@test", ...args], {
    cwd,
    encoding: "utf-8",
    env: gitSafeEnv(),
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

describe("GET /api/projects/:name/plans-tree — worktree sources", () => {
  type Change = { changeId: string; status: string; source: string };
  type Src = { id: string; label: string; changes: Change[] };
  let reposRoot = "";
  let repo = "";

  /** A committed native repo holding active changes `a` and `b`, wired into repos.json. */
  function seedNativeRepo() {
    // realpath so fixture paths match what git reports for worktrees.
    reposRoot = join(realpathSync(tmpRoot), "repos");
    repo = join(reposRoot, "pavilio");
    mkdirSync(repo, { recursive: true });
    git(repo, "init", "--quiet");
    seedFile(join(repo, "openspec", "changes", "a", "proposal.md"), "# a");
    seedFile(join(repo, "openspec", "changes", "b", "proposal.md"), "# b");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "init");
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: repo, openspec: { mode: "native" } }]),
    );
  }

  /** A sibling linked worktree on `branch`, or detached when null. */
  function addWorktree(name: string, branch: string | null): string {
    const wt = join(reposRoot, name);
    if (branch) git(repo, "worktree", "add", "--quiet", "-b", branch, wt);
    else git(repo, "worktree", "add", "--quiet", "--detach", wt);
    return wt;
  }

  async function tree(): Promise<Src[]> {
    const res = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/plans-tree");
    expect(res.status).toBe(200);
    return res.body.sources;
  }

  const worktreeSources = (sources: Src[]) => sources.filter((s) => s.id.startsWith("openspec:repo:pavilio@"));

  it("surfaces a worktree-only change as a worktree source", async () => {
    seedNativeRepo();
    const wt = addWorktree("pavilio-poc-wallet", "poc-wallet");
    seedFile(join(wt, "openspec", "changes", "bp-1987-wallet-poc", "proposal.md"), "# wallet");

    const sources = await tree();
    const src = sources.find((s) => s.id === `openspec:repo:pavilio@${wt}`);
    expect(src).toBeTruthy();
    expect(src!.label).toBe("pavilio @ poc-wallet (OpenSpec)");
    expect(src!.changes.map((c) => [c.changeId, c.status])).toEqual([["bp-1987-wallet-poc", "active"]]);
    // The main checkout source is still there, unchanged.
    const main = sources.find((s) => s.id === "openspec:repo:pavilio");
    expect(main!.changes.map((c) => c.changeId)).toEqual(["a", "b"]);
  });

  it("hides a worktree whose changes match main", async () => {
    seedNativeRepo();
    addWorktree("pavilio-clean", "clean");

    const sources = await tree();
    expect(vi.mocked(listRepoWorktrees)).toHaveBeenCalledWith(repo);
    expect(worktreeSources(sources)).toEqual([]);
  });

  it("lists only the differing change for an edited worktree change", async () => {
    seedNativeRepo();
    const wt = addWorktree("pavilio-edit", "edit");
    seedFile(join(wt, "openspec", "changes", "a", "tasks.md"), "# tasks");

    const sources = await tree();
    const src = sources.find((s) => s.id === `openspec:repo:pavilio@${wt}`);
    expect(src!.changes.map((c) => c.changeId)).toEqual(["a"]);
    const main = sources.find((s) => s.id === "openspec:repo:pavilio");
    const mainA = main!.changes.find((c) => c.changeId === "a");
    expect(mainA).toBeTruthy();
    expect(src!.changes[0].changeId).toBe(mainA!.changeId);
    expect(src!.changes[0].source).toBe(`openspec:repo:pavilio@${wt}`);
  });

  it("omits worktree archive and living specs", async () => {
    seedNativeRepo();
    const wt = addWorktree("pavilio-arch", "arch");
    seedFile(join(wt, "openspec", "changes", "c", "proposal.md"), "# c");
    seedFile(join(wt, "openspec", "changes", "archive", "2026-08-01-old", "proposal.md"), "# old");
    seedFile(join(wt, "openspec", "specs", "checkout", "spec.md"), "# living");

    const sources = await tree();
    const src = sources.find((s) => s.id === `openspec:repo:pavilio@${wt}`);
    expect(src!.changes.map((c) => [c.changeId, c.status])).toEqual([["c", "active"]]);

    const ctx = await request(makeApp(projectsRouter, "/api/projects")).get("/api/projects/alokai/context");
    expect(ctx.status).toBe(200);
    expect(JSON.stringify(ctx.body)).not.toContain(wt);
    const living = join(wt, "openspec", "specs", "checkout", "spec.md");
    const read = await request(makeApp(projectsRouter, "/api/projects"))
      .get("/api/projects/alokai/context/read")
      .query({ path: living });
    expect(read.status).toBe(403);
  });

  it("contributes no source for a worktree whose only differing change has no artifacts", async () => {
    seedNativeRepo();
    const wt = addWorktree("pavilio-scratch", "scratch");
    const stray = join(wt, "openspec", "changes", "g", "notes.md");
    seedFile(stray, "scratch");

    expect(worktreeSources(await tree())).toEqual([]);
    // Not registered as a source at all, so its tree stays out of the read allowlist.
    const read = await request(makeApp(projectsRouter, "/api/projects"))
      .get("/api/projects/alokai/plans/read")
      .query({ path: stray });
    expect(read.status).toBe(403);
  });

  it("labels a detached worktree with its short sha", async () => {
    seedNativeRepo();
    const wt = addWorktree("pavilio-detached", null);
    seedFile(join(wt, "openspec", "changes", "d", "proposal.md"), "# d");
    const sha = git(wt, "rev-parse", "HEAD").trim();

    const src = (await tree()).find((s) => s.id === `openspec:repo:pavilio@${wt}`);
    expect(src!.label).toBe(`pavilio @ ${sha.slice(0, 7)} (OpenSpec)`);
  });

  it("drops the source after the worktree is removed", async () => {
    seedNativeRepo();
    const wt = addWorktree("pavilio-gone", "gone");
    seedFile(join(wt, "openspec", "changes", "e", "proposal.md"), "# e");
    expect(worktreeSources(await tree()).map((s) => s.id)).toEqual([`openspec:repo:pavilio@${wt}`]);

    git(repo, "worktree", "remove", "--force", wt);
    const after = await tree();
    expect(worktreeSources(after)).toEqual([]);
    expect(after.find((s) => s.id === "openspec:repo:pavilio")).toBeTruthy();
  });

  it("serves a plan file from a surfaced worktree", async () => {
    seedNativeRepo();
    const wt = addWorktree("pavilio-serve", "serve");
    const target = join(wt, "openspec", "changes", "f", "proposal.md");
    seedFile(target, "# from the worktree");

    const res = await request(makeApp(projectsRouter, "/api/projects"))
      .get("/api/projects/alokai/plans/read")
      .query({ path: target });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("# from the worktree");
  });

  it("refuses a plan file from an unregistered openspec dir", async () => {
    seedNativeRepo();
    addWorktree("pavilio-real", "real");
    // Looks like a worktree of the repo, but git has never heard of it.
    const stray = join(reposRoot, "pavilio-stray", "openspec", "changes", "x", "proposal.md");
    seedFile(stray, "# stray");

    const res = await request(makeApp(projectsRouter, "/api/projects"))
      .get("/api/projects/alokai/plans/read")
      .query({ path: stray });
    expect(res.status).toBe(403);
  });

  it("skips worktree discovery for store-mode repos", async () => {
    seedNativeRepo();
    const storeRepo = join(reposRoot, "store-repo");
    mkdirSync(storeRepo, { recursive: true });
    seedChange(join(projectsDir, "alokai", "plans", "store-repo", "openspec"), "s");
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([
        { name: "pavilio", path: repo, openspec: { mode: "native" } },
        { name: "store-repo", path: storeRepo, openspec: { mode: "store" } },
      ]),
    );

    await tree();
    const calls = vi.mocked(listRepoWorktrees).mock.calls.map((c) => c[0]);
    // Positive control: the spy is bound and sees the native repo …
    expect(calls).toContain(repo);
    // … but never the store-mode one.
    expect(calls).not.toContain(storeRepo);
  });

  it("keeps the main source when git worktree list fails", async () => {
    // A native repo path that holds an openspec tree but is not a git repository.
    seedFile(join(projectsDir, "alokai", "PROJECT.md"));
    const notGit = join(realpathSync(tmpRoot), "repos", "not-git");
    seedChange(join(notGit, "openspec"), "add-checkout");
    writeFileSync(
      join(projectsDir, "alokai", "repos.json"),
      JSON.stringify([{ name: "pavilio", path: notGit, openspec: { mode: "native" } }]),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const sources = await tree();
      expect(vi.mocked(listRepoWorktrees)).toHaveBeenCalledWith(notGit);
      expect(warn.mock.calls.some((c) => String(c[0]).includes("git worktree list failed"))).toBe(true);
      const main = sources.find((s) => s.id === "openspec:repo:pavilio");
      expect(main!.changes.map((c) => c.changeId)).toEqual(["add-checkout"]);
      expect(worktreeSources(sources)).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});
