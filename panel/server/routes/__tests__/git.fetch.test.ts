import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { execSync } from "child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { configMock, makeApp } from "../../test-kit";
import { gitSafeEnv } from "../../lib/gitEnv";
import { broadcast } from "../../watcher";

let tmp = "";

vi.mock("../../config", () => configMock(() => join(tmp, "projects")));
vi.mock("../../watcher", () => ({ broadcast: vi.fn() }));

import gitRouter, { _setFetchTimeoutForTests } from "../git";

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

afterEach(() => {
  _setFetchTimeoutForTests();
  rmSync(tmp, { recursive: true, force: true });
});

/** A bare origin with main, a clone of it, and a seed repo that can push more to origin. */
function originAndClone(): { origin: string; seed: string; clone: string } {
  const origin = join(tmp, "origin.git");
  const seed = join(tmp, "seed");
  const clone = join(tmp, "clone");
  execSync(`git init -q --bare "${origin}"`, { stdio: "pipe", env: gitSafeEnv() });
  git(origin, "symbolic-ref HEAD refs/heads/main");
  initRepo(seed);
  git(seed, `push -q "${origin}" main`);
  execSync(`git clone -q "${origin}" "${clone}"`, { stdio: "pipe", env: gitSafeEnv() });
  return { origin, seed, clone };
}

/** An executable shell script at `name` in tmp. */
function script(name: string, body: string): string {
  const p = join(tmp, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

const remoteRefs = async (repo: string) =>
  (await request(app()).get(`/api/git/branches?repo=${encodeURIComponent(repo)}`)).body.remote.map((b: { ref: string }) => b.ref);

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

  it("fetch refreshes every remote, not just origin", async () => {
    const { seed, clone } = originAndClone();
    const upstream = join(tmp, "upstream.git");
    execSync(`git init -q --bare "${upstream}"`, { stdio: "pipe", env: gitSafeEnv() });
    git(seed, `push -q "${upstream}" main`);
    git(clone, `remote add upstream "${upstream}"`);
    // Pushed after the remote was added, so only a fetch of upstream can show it.
    git(seed, `push -q "${upstream}" main:refs/heads/feat/up`);
    expect(await remoteRefs(clone)).not.toContain("upstream/feat/up");

    const res = await fetchRepo(clone);
    expect(res.status).toBe(200);
    expect(await remoteRefs(clone)).toContain("upstream/feat/up");
  });

  it("a fetch that outlives its timeout answers 504 and does not broadcast", async () => {
    const { clone } = originAndClone();
    git(clone, `config remote.origin.uploadpack "${script("hang.sh", "exec sleep 1 </dev/null >/dev/null 2>&1")}"`);
    _setFetchTimeoutForTests(300);
    const res = await fetchRepo(clone);
    expect(res.status).toBe(504);
    expect(res.body).toEqual({ error: "git fetch timed out after 0.3 s" });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("concurrent fetches of one repo share a single git fetch", async () => {
    const { clone } = originAndClone();
    const log = join(tmp, "uploadpack.log");
    git(clone, `config remote.origin.uploadpack "${script("slow.sh", `echo run >> "${log}"; sleep 0.5; exec git-upload-pack "$@"`)}"`);
    const [a, b] = await Promise.all([fetchRepo(clone), fetchRepo(join(clone, "."))]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.fetchedAt).toBe(b.body.fetchedAt);
    expect(readFileSync(log, "utf-8").trim().split("\n")).toHaveLength(1);
  });

  it("fetch runs ssh non-interactively", async () => {
    const saved = { GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND, GIT_SSH: process.env.GIT_SSH, PATH: process.env.PATH };
    delete process.env.GIT_SSH_COMMAND;
    delete process.env.GIT_SSH;
    try {
      const repo = join(tmp, "batch");
      const log = join(tmp, "ssh.log");
      const bin = join(tmp, "bin");
      execSync(`mkdir -p "${bin}"`);
      initRepo(repo);
      git(repo, "remote add origin ssh://git@example.invalid/x.git");
      // The stub ssh, first on PATH, records what git hands it and fails.
      script("bin/ssh", `echo "argv: $*" > "${log}"; echo "prompt: $GIT_TERMINAL_PROMPT" >> "${log}"; exit 1`);
      process.env.PATH = `${bin}:${saved.PATH}`;
      const res = await fetchRepo(repo);
      expect(res.status).toBe(502);
      const recorded = readFileSync(log, "utf-8");
      expect(recorded).toMatch(/^argv: .*-o BatchMode=yes/m);
      expect(recorded).toContain("prompt: 0");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("a repo's own core.sshCommand is used, not overridden", async () => {
    const saved = process.env.GIT_SSH_COMMAND;
    delete process.env.GIT_SSH_COMMAND;
    try {
      const repo = join(tmp, "keyed");
      const marker = join(tmp, "ssh-ran");
      initRepo(repo);
      git(repo, "remote add origin ssh://git@example.invalid/x.git");
      git(repo, `config core.sshCommand "${script("ssh.sh", `touch "${marker}"; exit 1`)}"`);
      const res = await fetchRepo(repo);
      expect(res.status).toBe(502);
      expect(existsSync(marker)).toBe(true);
    } finally {
      if (saved !== undefined) process.env.GIT_SSH_COMMAND = saved;
    }
  });
});
