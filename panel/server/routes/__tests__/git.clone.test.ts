import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { configMock, makeApp } from "../../test-kit";
import { gitSafeEnv } from "../../lib/gitEnv";

let tmp = "";
let projectsDir = "";
let origin = "";

vi.mock("../../config", () => configMock(() => projectsDir));
vi.mock("../../watcher", () => ({ broadcast: vi.fn() }));

import gitRouter from "../git";

const app = () => makeApp(gitRouter, "/api/git");
const git = (args: string[], cwd: string) => execFileSync("git", args, { cwd, stdio: "pipe", env: gitSafeEnv(), encoding: "utf-8" });

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
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

describe("POST /api/git/clone", () => {
  it("clones the linked repo's remote into its configured path, creating parent dirs", async () => {
    const target = join(tmp, "srv", "deep", "skills");
    linkRepos("alpha", [{ name: "skills", path: target, remote: origin }]);
    const res = await request(app()).post("/api/git/clone").send({ project: "alpha", repo: "skills" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, path: target });
    expect(readFileSync(join(target, "hello.txt"), "utf-8")).toBe("hi\n");
    expect(git(["remote", "get-url", "origin"], target).trim()).toBe(origin);
  });

  it("expands ~ in the configured path like the repo-missing check", async () => {
    vi.stubEnv("HOME", tmp);
    linkRepos("alpha", [{ name: "skills", path: "~/code/skills", remote: origin }]);
    const res = await request(app()).post("/api/git/clone").send({ project: "alpha", repo: "skills" });
    expect(res.status).toBe(200);
    expect(existsSync(join(tmp, "code", "skills", "hello.txt"))).toBe(true);
  });

  it("refuses when the target already exists", async () => {
    const target = join(tmp, "taken");
    mkdirSync(target);
    linkRepos("alpha", [{ name: "skills", path: target, remote: origin }]);
    const res = await request(app()).post("/api/git/clone").send({ project: "alpha", repo: "skills" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("target-exists");
    expect(existsSync(join(target, "hello.txt"))).toBe(false);
  });

  it("refuses a linked repo without a remote", async () => {
    linkRepos("alpha", [{ name: "skills", path: join(tmp, "x") }]);
    const res = await request(app()).post("/api/git/clone").send({ project: "alpha", repo: "skills" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("no-remote");
    expect(existsSync(join(tmp, "x"))).toBe(false);
  });

  it("only clones repos linked by a live project", async () => {
    linkRepos("alpha", [{ name: "skills", path: join(tmp, "x"), remote: origin }]);
    let res = await request(app()).post("/api/git/clone").send({ project: "nope", repo: "skills" });
    expect(res.status).toBe(404);
    res = await request(app()).post("/api/git/clone").send({ project: "alpha", repo: "other" });
    expect(res.status).toBe(404);
    res = await request(app()).post("/api/git/clone").send({ project: "../alpha", repo: "skills" });
    expect(res.status).toBe(404);
    res = await request(app()).post("/api/git/clone").send({ project: "alpha" });
    expect(res.status).toBe(400);
    expect(existsSync(join(tmp, "x"))).toBe(false);
  });

  it("reports git's error and leaves no target behind when the clone fails", async () => {
    const target = join(tmp, "out");
    linkRepos("alpha", [{ name: "skills", path: target, remote: join(tmp, "missing.git") }]);
    const res = await request(app()).post("/api/git/clone").send({ project: "alpha", repo: "skills" });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/does not exist|not appear to be a git repository|Could not read/i);
    expect(existsSync(target)).toBe(false);
  });

  it("passes the remote as an argument, never through a shell or as an option", async () => {
    const target = join(tmp, "out");
    linkRepos("alpha", [{ name: "skills", path: target, remote: "--upload-pack=touch pwned" }]);
    const res = await request(app()).post("/api/git/clone").send({ project: "alpha", repo: "skills" });
    expect(res.status).toBe(502);
    expect(existsSync(join(tmp, "pwned"))).toBe(false);
    expect(existsSync(join(projectsDir, "pwned"))).toBe(false);
  });
});
