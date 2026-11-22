import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { execSync } from "child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { configMock, makeApp } from "../../test-kit";
import { gitSafeEnv } from "../../lib/gitEnv";

let tmp = "";
let repoDir = "";

vi.mock("../../config", () => configMock(() => join(tmp, "projects")));
vi.mock("../../watcher", () => ({ broadcast: vi.fn() }));

import gitRouter from "../git";

const app = () => makeApp(gitRouter, "/api/git");

function sh(cmd: string): string {
  return execSync(`git ${cmd}`, { cwd: repoDir, stdio: "pipe", env: gitSafeEnv(), encoding: "utf-8" });
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "git-write-"));
  repoDir = join(tmp, "repo");
  execSync(`git init -q "${repoDir}"`, { stdio: "pipe", env: gitSafeEnv() });
  sh("config user.email t@t");
  sh("config user.name t");
  sh("symbolic-ref HEAD refs/heads/main");
  writeFileSync(join(repoDir, "a.txt"), "a\n");
  sh("add a.txt");
  sh("commit -q -m base");
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

// Each payload would create `pwned` in the repo if it ever reached a shell.
const pwned = () => join(repoDir, "pwned");

describe("git writes never reach a shell", () => {
  it("stages a filename carrying shell syntax literally", async () => {
    const name = "a$(touch pwned)`touch pwned`.txt";
    writeFileSync(join(repoDir, name), "x\n");
    const res = await request(app()).post("/api/git/stage").send({ files: [name], repo: repoDir });
    expect(res.status).toBe(200);
    expect(existsSync(pwned())).toBe(false);
    expect(sh("diff --cached --name-only -z").split("\0")).toContain(name);
  });

  it("stages a filename that looks like an option as a path", async () => {
    writeFileSync(join(repoDir, "-A"), "x\n");
    writeFileSync(join(repoDir, "other.txt"), "x\n");
    const res = await request(app()).post("/api/git/stage").send({ files: ["-A"], repo: repoDir });
    expect(res.status).toBe(200);
    expect(sh("diff --cached --name-only").trim()).toBe("-A");
  });

  it("commits a message with backticks and $() verbatim", async () => {
    writeFileSync(join(repoDir, "a.txt"), "b\n");
    sh("add a.txt");
    const message = 'msg `touch pwned` $(touch pwned) "quoted" \\ end';
    const res = await request(app()).post("/api/git/commit").send({ message, repo: repoDir });
    expect(res.status).toBe(200);
    expect(existsSync(pwned())).toBe(false);
    expect(sh("log -1 --format=%B").trim()).toBe(message);
  });

  it("refuses a branch that looks like an option and never runs shell syntax in one", async () => {
    let res = await request(app()).post("/api/git/checkout").send({ branch: "--orphan=x", repo: repoDir });
    expect(res.status).toBe(400);
    res = await request(app()).post("/api/git/checkout").send({ branch: "x$(touch pwned)", repo: repoDir });
    expect(res.status).toBe(409);
    expect(existsSync(pwned())).toBe(false);
  });

  it("greps for a query carrying shell syntax literally", async () => {
    const q = "$(touch pwned)";
    writeFileSync(join(repoDir, "a.txt"), `has ${q} inside\n`);
    sh("add a.txt");
    const res = await request(app()).get(`/api/git/grep?q=${encodeURIComponent(q)}&repo=${encodeURIComponent(repoDir)}`);
    expect(res.status).toBe(200);
    expect(existsSync(pwned())).toBe(false);
    expect(res.body).toEqual([{ relativePath: "a.txt", project: "", matches: [{ line: 1, text: `has ${q} inside` }] }]);
    const scoped = await request(app()).get(
      `/api/git/grep?q=inside&files=${encodeURIComponent("x$(touch pwned).txt,a.txt")}&repo=${encodeURIComponent(repoDir)}`,
    );
    expect(scoped.status).toBe(200);
    expect(scoped.body).toHaveLength(1);
    expect(existsSync(pwned())).toBe(false);
  });

  it("checks out an existing branch", async () => {
    sh("branch feat/x");
    const res = await request(app()).post("/api/git/checkout").send({ branch: "feat/x", repo: repoDir });
    expect(res.status).toBe(200);
    expect(res.body.branch).toBe("feat/x");
  });
});
