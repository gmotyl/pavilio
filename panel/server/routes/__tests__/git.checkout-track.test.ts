import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
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
