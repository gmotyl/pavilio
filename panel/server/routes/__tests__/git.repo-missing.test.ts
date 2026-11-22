import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { configMock, makeApp } from "../../test-kit";
import { gitSafeEnv } from "../../lib/gitEnv";

let projectsDir = "";

vi.mock("../../config", () => configMock(() => projectsDir));
vi.mock("../../watcher", () => ({ broadcast: vi.fn() }));

import gitRouter from "../git";

const app = () => makeApp(gitRouter, "/api/git");

function initRepo(dir: string, branch: string) {
  const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: "pipe", env: gitSafeEnv() });
  run("git init -q");
  run(`git symbolic-ref HEAD refs/heads/${branch}`);
  run("git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init");
}

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "git-repo-missing-"));
  const workspace = join(tmp, "workspace");
  mkdirSync(join(workspace, "projects"), { recursive: true });
  initRepo(workspace, "ws-main");
  projectsDir = join(workspace, "projects");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

function expectRepoMissing(
  res: request.Response,
  path: string,
): void {
  expect(res.status).toBe(404);
  expect(res.body.code).toBe("repo-missing");
  expect(res.body.path).toBe(path);
  expect(res.body.error).toBe(`Repository not on this machine: ${path}`);
  const raw = JSON.stringify(res.body);
  expect(raw).not.toContain("ENOENT");
  expect(raw).not.toContain("spawnSync");
}

describe("git routes and a repo missing on this machine", () => {
  it("status on a missing repo answers 404 repo-missing with the expanded path", async () => {
    vi.stubEnv("HOME", tmp);
    const res = await request(app()).get(
      `/api/git/status?repo=${encodeURIComponent("~/nope/repo")}`,
    );
    expectRepoMissing(res, join(tmp, "nope/repo"));
  });

  it("every git route answers repo-missing for a missing repo", async () => {
    const missing = join(tmp, "does-not-exist");
    const q = encodeURIComponent(missing);
    const cases: Array<[string, () => request.Test]> = [
      ["status", () => request(app()).get(`/api/git/status?repo=${q}`)],
      ["diff", () => request(app()).get(`/api/git/diff?file=a.txt&repo=${q}`)],
      [
        "diff (sha)",
        () => request(app()).get(`/api/git/diff?file=a.txt&sha=abc&repo=${q}`),
      ],
      ["log", () => request(app()).get(`/api/git/log?repo=${q}`)],
      [
        "commit-files",
        () => request(app()).get(`/api/git/commit-files?sha=abc&repo=${q}`),
      ],
      ["branch", () => request(app()).get(`/api/git/branch?repo=${q}`)],
      ["branches", () => request(app()).get(`/api/git/branches?repo=${q}`)],
      [
        "branch-diff-files",
        () =>
          request(app()).get(`/api/git/branch-diff-files?base=main&repo=${q}`),
      ],
      [
        "branch-diff",
        () =>
          request(app()).get(
            `/api/git/branch-diff?file=a.txt&base=main&repo=${q}`,
          ),
      ],
      ["grep", () => request(app()).get(`/api/git/grep?q=foo&repo=${q}`)],
      ["worktrees", () => request(app()).get(`/api/git/worktrees?repo=${q}`)],
      [
        "suggest-message",
        () => request(app()).get(`/api/git/suggest-message?repo=${q}`),
      ],
      [
        "stage",
        () =>
          request(app())
            .post("/api/git/stage")
            .send({ files: ["a.txt"], repo: missing }),
      ],
      [
        "commit",
        () =>
          request(app())
            .post("/api/git/commit")
            .send({ message: "m", repo: missing }),
      ],
      [
        "push",
        () => request(app()).post("/api/git/push").send({ repo: missing }),
      ],
      [
        "checkout",
        () =>
          request(app())
            .post("/api/git/checkout")
            .send({ branch: "main", repo: missing }),
      ],
    ];

    for (const [name, send] of cases) {
      const res = await send();
      try {
        expectRepoMissing(res, missing);
      } catch (e) {
        throw new Error(
          `${name}: ${res.status} ${JSON.stringify(res.body)}\n${(e as Error).message}`,
        );
      }
    }

    // A route's own required param is still checked before the repo dir.
    const noBase = await request(app()).get(
      `/api/git/branch-diff-files?repo=${q}`,
    );
    expect(noBase.status).toBe(400);
    expect(noBase.body).toEqual({ error: "base parameter required" });
  });

  it("a bare ~ repo runs in the home directory", async () => {
    const home = join(tmp, "home");
    mkdirSync(home);
    initRepo(home, "home-branch");
    vi.stubEnv("HOME", home);
    const res = await request(app()).get(`/api/git/branch?repo=~`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ branch: "home-branch" });
  });

  it("a git failure in an existing directory still answers 500 without a code", async () => {
    const plain = join(tmp, "not-a-repo");
    mkdirSync(plain);
    // GIT_CEILING_DIRECTORIES keeps git from discovering an enclosing repo.
    vi.stubEnv("GIT_CEILING_DIRECTORIES", tmp);
    const res = await request(app()).get(
      `/api/git/log?repo=${encodeURIComponent(plain)}`,
    );
    expect(res.status).toBe(500);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.code).toBeUndefined();
  });

  it("omitting repo still targets the workspace repository", async () => {
    const res = await request(app()).get(`/api/git/branch`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ branch: "ws-main" });
  });
});
