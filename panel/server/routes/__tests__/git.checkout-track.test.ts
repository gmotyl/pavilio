import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { configMock, makeApp } from "../../test-kit";
import { gitSafeEnv } from "../../lib/gitEnv";

let tmp = "";
let repoDir = "";

vi.mock("../../config", () => configMock(() => join(tmp, "projects")));
vi.mock("../../watcher", () => ({ broadcast: vi.fn() }));

import gitRouter from "../git";
import { broadcast } from "../../watcher";

const app = () => makeApp(gitRouter, "/api/git");

function sh(cmd: string): string {
  return execSync(`git ${cmd}`, { cwd: repoDir, stdio: "pipe", env: gitSafeEnv(), encoding: "utf-8" }).trim();
}

const head = () => sh("rev-parse --abbrev-ref HEAD");
const checkout = (body: Record<string, unknown>) =>
  request(app())
    .post("/api/git/checkout")
    .send({ repo: repoDir, ...body });

/**
 * main: a.txt. Bare origin carries main, feat/a (one commit ahead of the local feat/a)
 * and feat/b (a.txt changed); the local clone has main and feat/a only.
 */
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "git-track-"));
  repoDir = join(tmp, "repo");
  const origin = join(tmp, "origin.git");
  execSync(`git init -q --bare "${origin}"`, { stdio: "pipe", env: gitSafeEnv() });
  execSync(`git init -q "${repoDir}"`, { stdio: "pipe", env: gitSafeEnv() });
  sh("config user.email t@t");
  sh("config user.name t");
  sh("symbolic-ref HEAD refs/heads/main");
  writeFileSync(join(repoDir, "a.txt"), "a\n");
  sh("add a.txt");
  sh("commit -q -m base");
  sh(`remote add origin "${origin}"`);

  sh("checkout -q -b feat/b");
  writeFileSync(join(repoDir, "a.txt"), "bee\n");
  sh("commit -q -am b");
  sh("checkout -q -b feat/a main");
  writeFileSync(join(repoDir, "f.txt"), "1\n");
  sh("add f.txt");
  sh("commit -q -m a1");
  sh("push -q origin main feat/a feat/b");
  writeFileSync(join(repoDir, "f.txt"), "2\n");
  sh("commit -q -am a2");
  sh("push -q origin feat/a");
  sh("reset -q --hard HEAD~1");
  sh("checkout -q main");
  sh("branch -q -D feat/b");
  sh("fetch -q origin");
  vi.mocked(broadcast).mockClear();
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("POST /checkout with track", () => {
  it("track checkout creates a local branch tracking the remote", async () => {
    const res = await checkout({ branch: "origin/feat/b", track: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, branch: "feat/b" });
    expect(head()).toBe("feat/b");
    expect(sh("rev-parse --abbrev-ref @{u}")).toBe("origin/feat/b");
    expect(broadcast).toHaveBeenCalledWith({ type: "git-change" });
  });

  it("track checkout reuses an existing local twin without resetting it", async () => {
    const local = sh("rev-parse feat/a");
    expect(local).not.toBe(sh("rev-parse origin/feat/a"));
    const res = await checkout({ branch: "origin/feat/a", track: true });
    expect(res.status).toBe(200);
    expect(res.body.branch).toBe("feat/a");
    expect(head()).toBe("feat/a");
    expect(sh("rev-parse HEAD")).toBe(local);
  });

  it("track checkout rejects a ref that is not a remote branch", async () => {
    const res = await checkout({ branch: "feat/a", track: true });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "unknown remote branch" });
    expect(head()).toBe("main");
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("track checkout on a dirty conflicting tree answers 409", async () => {
    writeFileSync(join(repoDir, "a.txt"), "dirty\n");
    const res = await checkout({ branch: "origin/feat/b", track: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/a\.txt/);
    expect(head()).toBe("main");
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("track checkout rejects a symbolic remote ref", async () => {
    sh("remote set-head origin main");
    const res = await checkout({ branch: "origin/HEAD", track: true });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "unknown remote branch" });
    expect(head()).toBe("main");
    expect(sh("branch --list HEAD")).toBe("");
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("track checkout is unambiguous when a local ref shares the remote branch's short name", async () => {
    // A local branch literally named origin/feat/b makes the bare `origin/feat/b` ambiguous.
    sh("branch -q origin/feat/b main");
    const res = await checkout({ branch: "origin/feat/b", track: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, branch: "feat/b" });
    expect(sh("symbolic-ref HEAD")).toBe("refs/heads/feat/b");
    expect(sh("rev-parse --symbolic-full-name @{u}")).toBe("refs/remotes/origin/feat/b");
    expect(sh("rev-parse HEAD")).toBe(sh("rev-parse refs/remotes/origin/feat/b"));
  });

  it("checkout reports the plain branch name when a tag shares it", async () => {
    sh("branch -q v1 main");
    sh("tag v1 main");
    for (const body of [{ branch: "v1" }, { branch: "origin/feat/b", track: true }]) {
      const res = await checkout(body);
      expect(res.status).toBe(200);
      expect(res.body.branch).toBe(body.track ? "feat/b" : "v1");
    }
    sh("tag feat/b main");
    sh("checkout -q main");
    const res = await checkout({ branch: "origin/feat/b", track: true });
    expect(res.status).toBe(200);
    expect(res.body.branch).toBe("feat/b");
  });

  it("checkout reports HEAD when it detaches", async () => {
    sh("tag t1 main");
    const res = await checkout({ branch: "t1" });
    expect(res.status).toBe(200);
    expect(res.body.branch).toBe("HEAD");
  });

  it("track checkout keeps the leading-dash guard", async () => {
    for (const track of [true, undefined]) {
      const res = await checkout({ branch: "--orphan=x", track });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid branch/);
    }
    expect(head()).toBe("main");
    expect(sh("branch --list x")).toBe("");
  });
});

describe("GET /branch", () => {
  const branch = () => request(app()).get(`/api/git/branch?repo=${encodeURIComponent(repoDir)}`);

  it("branch reports the plain name when a tag shares it", async () => {
    sh("tag main main");
    const res = await branch();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ branch: "main" });
  });

  it("branch reports HEAD when detached", async () => {
    sh("checkout -q --detach main");
    const res = await branch();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ branch: "HEAD" });
  });
});

describe("POST /checkout outside a git repo", () => {
  it("tracking checkout on an existing non-git directory answers the same error as plain checkout", async () => {
    const plain = join(tmp, "not-a-repo");
    mkdirSync(plain);
    // GIT_CEILING_DIRECTORIES keeps git from discovering an enclosing repo.
    vi.stubEnv("GIT_CEILING_DIRECTORIES", tmp);
    try {
      const send = (body: Record<string, unknown>) => request(app()).post("/api/git/checkout").send({ repo: plain, ...body });
      const flat = await send({ branch: "origin/feat/b" });
      const tracked = await send({ branch: "origin/feat/b", track: true });
      expect(flat.status).toBe(409);
      expect(flat.body.error).toMatch(/not a git repository/i);
      expect(tracked.status).toBe(flat.status);
      expect(tracked.body.error).toMatch(/not a git repository/i);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
