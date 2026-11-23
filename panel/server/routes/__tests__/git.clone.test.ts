import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { execFileSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { configMock, makeApp } from "../../test-kit";
import { gitSafeEnv } from "../../lib/gitEnv";

let tmp = "";
let projectsDir = "";
let origin = "";

vi.mock("../../config", () => configMock(() => projectsDir));
vi.mock("../../watcher", () => ({ broadcast: vi.fn() }));
// A slow existence check widens the window two requests could both pass before either reserves.
const slow = vi.hoisted(() => ({ lstatMs: 0 }));
vi.mock("fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("fs/promises")>();
  const lstat = (async (...args: Parameters<typeof real.lstat>) => {
    if (slow.lstatMs) await new Promise((r) => setTimeout(r, slow.lstatMs));
    return real.lstat(...args);
  }) as typeof real.lstat;
  return { ...real, default: { ...real, lstat }, lstat };
});

import gitRouter from "../git";
import { broadcast } from "../../watcher";

const app = () => makeApp(gitRouter, "/api/git");
const git = (args: string[], cwd: string) => execFileSync("git", args, { cwd, stdio: "pipe", env: gitSafeEnv(), encoding: "utf-8" });

const post = (body: object) => request(app()).post("/api/git/clone").send(body);

function linkRepos(project: string, repos: unknown[]): void {
  const dir = join(projectsDir, project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "PROJECT.md"), "# p\n");
  writeFileSync(join(dir, "repos.json"), JSON.stringify(repos));
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "git-clone-"));
  projectsDir = join(tmp, "projects");
  mkdirSync(projectsDir);
  // A bare repo with one commit stands in for the remote.
  const seed = join(tmp, "seed");
  mkdirSync(seed);
  git(["init", "-q", "-b", "main"], seed);
  writeFileSync(join(seed, "hello.txt"), "hi\n");
  git(["add", "hello.txt"], seed);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"], seed);
  origin = join(tmp, "origin.git");
  git(["clone", "-q", "--bare", seed, origin], tmp);
});

afterEach(() => {
  slow.lstatMs = 0;
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

describe("POST /api/git/clone", () => {
  /** Link one repo `skills` at `path` and post a clone of exactly that entry. */
  const cloneOne = (path: string, remote?: string) => {
    linkRepos("alpha", [{ name: "skills", path, ...(remote !== undefined ? { remote } : {}) }]);
    return post({ project: "alpha", repo: "skills", path });
  };

  it("clones the linked repo's remote into its configured path, creating parent dirs", async () => {
    const target = join(tmp, "srv", "deep", "skills");
    const res = await cloneOne(target, origin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, path: target });
    expect(readFileSync(join(target, "hello.txt"), "utf-8")).toBe("hi\n");
    expect(git(["remote", "get-url", "origin"], target).trim()).toBe(origin);
    // Every tab refetches presence: the checkout may sit outside the watched projects dir.
    expect(broadcast).toHaveBeenCalledWith({ type: "projects-change" });
    // The private staging dir is gone once the clone is published.
    expect(readdirSync(join(tmp, "srv", "deep"))).toEqual(["skills"]);
  });

  it("expands ~ in the configured path like the repo-missing check", async () => {
    vi.stubEnv("HOME", tmp);
    const res = await cloneOne("~/code/skills", origin);
    expect(res.status).toBe(200);
    expect(existsSync(join(tmp, "code", "skills", "hello.txt"))).toBe(true);
  });

  it("refuses when the target already exists", async () => {
    const target = join(tmp, "taken");
    mkdirSync(target);
    const res = await cloneOne(target, origin);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("target-exists");
    expect(existsSync(join(target, "hello.txt"))).toBe(false);
  });

  it("refuses a linked repo without a remote", async () => {
    const res = await cloneOne(join(tmp, "x"));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("no-remote");
    expect(existsSync(join(tmp, "x"))).toBe(false);
  });

  it("only clones repos linked by a live project", async () => {
    const path = join(tmp, "x");
    linkRepos("alpha", [{ name: "skills", path, remote: origin }]);
    let res = await post({ project: "nope", repo: "skills", path });
    expect(res.status).toBe(404);
    res = await post({ project: "alpha", repo: "other", path });
    expect(res.status).toBe(404);
    res = await post({ project: "../alpha", repo: "skills", path });
    expect(res.status).toBe(404);
    res = await post({ project: "alpha", repo: "skills", path: join(tmp, "elsewhere") });
    expect(res.status).toBe(404);
    res = await post({ project: "alpha", repo: "skills" });
    expect(res.status).toBe(400);
    res = await post({ project: "alpha" });
    expect(res.status).toBe(400);
    expect(existsSync(path)).toBe(false);
  });

  it("clones the selected one of two same-named entries, pairing its own remote", async () => {
    const first = join(tmp, "first");
    const second = join(tmp, "second");
    linkRepos("alpha", [
      { name: "skills", path: first, remote: join(tmp, "missing.git") },
      { name: "skills", path: second, remote: origin },
    ]);
    const res = await post({ project: "alpha", repo: "skills", path: second });
    expect(res.status).toBe(200);
    expect(existsSync(join(second, "hello.txt"))).toBe(true);
    expect(existsSync(first)).toBe(false);
  });

  it("never pairs a skipped entry's remote with a valid entry's path", async () => {
    const target = join(tmp, "out");
    linkRepos("alpha", [
      { name: "skills", path: "", remote: join(tmp, "missing.git") },
      { name: "skills", path: target, remote: origin },
    ]);
    const res = await post({ project: "alpha", repo: "skills", path: target });
    expect(res.status).toBe(200);
    expect(git(["remote", "get-url", "origin"], target).trim()).toBe(origin);
  });

  it("refuses an entry the name and path do not single out", async () => {
    const target = join(tmp, "out");
    linkRepos("alpha", [
      { name: "skills", path: target, remote: origin },
      { name: "skills", path: target, remote: join(tmp, "missing.git") },
    ]);
    const res = await post({ project: "alpha", repo: "skills", path: target });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ambiguous-repo");
    expect(existsSync(target)).toBe(false);
  });

  it("reports git's error and leaves no target behind when the clone fails", async () => {
    const target = join(tmp, "out");
    const res = await cloneOne(target, join(tmp, "missing.git"));
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/does not exist|not appear to be a git repository|Could not read/i);
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(tmp).filter((n) => n.includes("clone"))).toEqual([]);
  });

  it("passes the remote as an argument, never through a shell or as an option", async () => {
    const res = await cloneOne(join(tmp, "out"), "--upload-pack=touch pwned");
    expect(res.status).toBe(502);
    expect(existsSync(join(tmp, "pwned"))).toBe(false);
    expect(existsSync(join(projectsDir, "pwned"))).toBe(false);
  });

  /** A fake `ssh` first on PATH: records its argv, optionally sleeps, then fails. */
  function fakeSsh(sleep = 0): string {
    const bin = join(tmp, "bin");
    mkdirSync(bin, { recursive: true });
    const log = join(tmp, "ssh-args");
    writeFileSync(join(bin, "ssh"), `#!/bin/sh\necho "$@" >> "${log}"\n${sleep ? `sleep ${sleep}\n` : ""}exit 255\n`);
    chmodSync(join(bin, "ssh"), 0o755);
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    vi.stubEnv("GIT_SSH_COMMAND", undefined as unknown as string);
    vi.stubEnv("GIT_SSH", undefined as unknown as string);
    return log;
  }
  const SSH_REMOTE = "ssh://git@example.invalid/o/skills.git";

  // The fake ssh is a POSIX shell script; the panel targets macOS and WSL2.
  describe.skipIf(process.platform === "win32")("over ssh", () => {
    it("runs ssh in batch mode so a host-key or password prompt cannot hang the clone", async () => {
      const log = fakeSsh();
      const res = await cloneOne(join(tmp, "out"), SSH_REMOTE);
      expect(res.status).toBe(502);
      expect(readFileSync(log, "utf-8")).toContain("-o BatchMode=yes");
    });

    it("answers 409 clone-in-progress to a second clone of the same target", async () => {
      fakeSsh(0.3);
      const path = join(tmp, "out");
      linkRepos("alpha", [{ name: "skills", path, remote: SSH_REMOTE }]);
      const send = () => post({ project: "alpha", repo: "skills", path });
      const [a, b] = await Promise.all([send(), new Promise((r) => setTimeout(r, 50)).then(send)]);
      expect(a.status).toBe(502);
      expect(b.status).toBe(409);
      expect(b.body.code).toBe("clone-in-progress");
      // The slot frees once the first clone settles.
      expect((await send()).status).toBe(502);
    });

    it("reserves the target before any await, so simultaneous clones never both start", async () => {
      const log = fakeSsh(0.2);
      slow.lstatMs = 100;
      const path = join(tmp, "out");
      linkRepos("alpha", [{ name: "skills", path, remote: SSH_REMOTE }]);
      const send = () => post({ project: "alpha", repo: "skills", path });
      const statuses = (await Promise.all([send(), send(), send()])).map((r) => r.status).sort();
      expect(statuses).toEqual([409, 409, 502]);
      expect(readFileSync(log, "utf-8").trim().split("\n")).toHaveLength(1);
    });

    it("stages the clone privately: the target appears only once the clone succeeds", async () => {
      fakeSsh(0.3);
      const target = join(tmp, "out");
      const pending = cloneOne(target, SSH_REMOTE).then((r) => r);
      await new Promise((r) => setTimeout(r, 150));
      expect(existsSync(target)).toBe(false);
      expect((await pending).status).toBe(502);
      expect(existsSync(target)).toBe(false);
    });

    it("a failed clone never removes a sibling another request cloned meanwhile", async () => {
      fakeSsh(0.3);
      const slow = join(tmp, "new", "a");
      const fast = join(tmp, "new", "b");
      linkRepos("alpha", [
        { name: "a", path: slow, remote: SSH_REMOTE },
        { name: "b", path: fast, remote: origin },
      ]);
      const a = post({ project: "alpha", repo: "a", path: slow }).then((r) => r);
      await new Promise((r) => setTimeout(r, 50));
      expect((await post({ project: "alpha", repo: "b", path: fast })).status).toBe(200);
      expect((await a).status).toBe(502);
      expect(existsSync(join(fast, "hello.txt"))).toBe(true);
      expect(readdirSync(join(tmp, "new"))).toEqual(["b"]);
    });
  });

  it("refuses transports other than https, ssh and file", async () => {
    const res = await cloneOne(join(tmp, "out"), "git://127.0.0.1:9/o/skills.git");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/transport 'git' not allowed/);
  });

  it("an inherited GIT_ALLOW_PROTOCOL cannot widen the transport allowlist", async () => {
    vi.stubEnv("GIT_ALLOW_PROTOCOL", "git:https:ssh:file");
    const res = await cloneOne(join(tmp, "out"), "git://127.0.0.1:9/o/skills.git");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/transport 'git' not allowed/);
  });

  it("removes the parent dirs it created when the clone fails", async () => {
    mkdirSync(join(tmp, "srv"));
    const res = await cloneOne(join(tmp, "srv", "a", "b", "skills"), join(tmp, "missing.git"));
    expect(res.status).toBe(502);
    expect(existsSync(join(tmp, "srv"))).toBe(true);
    expect(existsSync(join(tmp, "srv", "a"))).toBe(false);
  });

  it("never echoes https credentials or signed query parameters from the remote in the error", async () => {
    const res = await cloneOne(join(tmp, "out"), "https://bob:s3cret@127.0.0.1:9/o/skills.git?sig=t0ken");
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("s3cret");
    expect(JSON.stringify(res.body)).not.toContain("bob:");
    expect(JSON.stringify(res.body)).not.toContain("t0ken");
  });
});
