import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { configMock, makeApp } from "../../test-kit";
import { gitSafeEnv } from "../../lib/gitEnv";
import { broadcast } from "../../watcher";

let tmp = "";

vi.mock("../../config", () => configMock(() => join(tmp, "projects")));
vi.mock("../../watcher", () => ({ broadcast: vi.fn() }));

import gitRouter from "../git";

const app = () => makeApp(gitRouter, "/api/git");

const git = (cwd: string, cmd: string) =>
  execSync(`git -c user.email=t@t -c user.name=t ${cmd}`, { cwd, stdio: "pipe", env: gitSafeEnv(), encoding: "utf-8" });

/** A repo with one commit on main. */
function initRepo(dir: string): void {
  execSync(`git init -q "${dir}"`, { stdio: "pipe", env: gitSafeEnv() });
  git(dir, "symbolic-ref HEAD refs/heads/main");
  git(dir, "commit -q --allow-empty -m init");
}

const fetchRepo = (repo: string) => request(app()).post("/api/git/fetch").send({ repo });

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "git-fetch-"));
  vi.mocked(broadcast).mockClear();
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("POST /api/git/fetch", () => {
  it("fetch picks up a branch pushed to origin", async () => {
    const origin = join(tmp, "origin.git");
    const seed = join(tmp, "seed");
    const clone = join(tmp, "clone");
    execSync(`git init -q --bare "${origin}"`, { stdio: "pipe", env: gitSafeEnv() });
    git(origin, "symbolic-ref HEAD refs/heads/main");
    initRepo(seed);
    git(seed, `push -q "${origin}" main`);
    execSync(`git clone -q "${origin}" "${clone}"`, { stdio: "pipe", env: gitSafeEnv() });
    // Pushed after the clone, so only a fetch can show it.
    git(seed, `push -q "${origin}" main:refs/heads/feat/late`);

    const before = (await request(app()).get(`/api/git/branches?repo=${encodeURIComponent(clone)}`)).body;
    expect(before.remote.map((b: { ref: string }) => b.ref)).not.toContain("origin/feat/late");

    const t0 = Date.now();
    const res = await fetchRepo(clone);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.fetchedAt).toBeGreaterThanOrEqual(t0);
    expect(res.body.fetchedAt).toBeLessThanOrEqual(Date.now());
    expect(broadcast).toHaveBeenCalledWith({ type: "git-change" });

    const after = (await request(app()).get(`/api/git/branches?repo=${encodeURIComponent(clone)}`)).body;
    expect(after.remote).toContainEqual({ ref: "origin/feat/late", remote: "origin", name: "feat/late" });
  });

  it("fetch with no remote is ok", async () => {
    const repo = join(tmp, "lonely");
    initRepo(repo);
    const res = await fetchRepo(repo);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.fetchedAt).toBe("number");
  });

  it("fetch from an unreachable remote answers 502 with git's message", async () => {
    const repo = join(tmp, "stranded");
    const gone = join(tmp, "no-such-origin");
    initRepo(repo);
    git(repo, `remote add origin "${gone}"`);
    const res = await fetchRepo(repo);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain(`'${gone}' does not appear to be a git repository`);
    expect(res.body.error).toBe(res.body.error.trim());
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("fetch on a missing repo answers the repo-missing error", async () => {
    const missing = join(tmp, "does-not-exist");
    const res = await fetchRepo(missing);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      code: "repo-missing",
      path: missing,
      error: `Repository not on this machine: ${missing}`,
    });
  });
});
