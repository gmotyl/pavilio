import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "fs";
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
const PR_REF = "refs/pavilio/pr/1";

function sh(cmd: string): string {
  return execSync(`git -c user.email=t@t -c user.name=t ${cmd}`, {
    cwd: repoDir,
    stdio: "pipe",
    env: gitSafeEnv(),
    encoding: "utf-8",
  });
}

function get(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ repo: repoDir, ...params }).toString();
  return request(app()).get(`/api/git/${path}?${qs}`);
}

/**
 * main: a.txt, dir/b.txt, keep.txt, .gitignore
 * refs/pavilio/pr/1 (off main): a.txt edited, c.txt added, dir/b.txt deleted
 * working tree on main: keep.txt edited, dir/b.txt deleted, u.txt untracked, ignored.log ignored
 */
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "git-refs-"));
  repoDir = join(tmp, "repo");
  mkdirSync(join(repoDir, "dir"), { recursive: true });
  sh("init -q");
  sh("symbolic-ref HEAD refs/heads/main");
  writeFileSync(join(repoDir, "a.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(repoDir, "dir", "b.txt"), "bee\n");
  writeFileSync(join(repoDir, "keep.txt"), "keep\n");
  writeFileSync(join(repoDir, ".gitignore"), "*.log\n");
  sh("add -A");
  sh("commit -q -m base");

  sh("checkout -q -b pr");
  writeFileSync(join(repoDir, "a.txt"), "one\nTWO\nthree\nfour\n");
  writeFileSync(join(repoDir, "c.txt"), "sea\n");
  sh("rm -q dir/b.txt");
  sh("add -A");
  sh("commit -q -m pr");
  sh(`update-ref ${PR_REF} HEAD`);
  sh("checkout -q main");
  sh("branch -q -D pr");

  writeFileSync(join(repoDir, "keep.txt"), "kept\n");
  rmSync(join(repoDir, "dir", "b.txt"));
  writeFileSync(join(repoDir, "u.txt"), "untracked\n");
  writeFileSync(join(repoDir, "ignored.log"), "noise\n");
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("ref-based git reads", () => {
  it("lists the working tree with untracked files and status", async () => {
    const res = await get("tree", {});
    expect(res.status).toBe(200);
    const byPath = Object.fromEntries(
      (res.body.files as { path: string; status: string | null }[]).map((f) => [f.path, f.status]),
    );
    expect(byPath).toEqual({
      ".gitignore": null,
      "a.txt": null,
      "dir/b.txt": "D",
      "keep.txt": "M",
      "u.txt": "?",
    });
  });

  it("lists files at a ref", async () => {
    const res = await get("tree", { ref: PR_REF });
    expect(res.status).toBe(200);
    expect(res.body.files).toEqual([
      { path: ".gitignore", status: null },
      { path: "a.txt", status: null },
      { path: "c.txt", status: null },
      { path: "keep.txt", status: null },
    ]);

    expect((await get("tree", { ref: "-n" })).status).toBe(400);
    expect((await get("tree", { ref: "refs/nope" })).status).toBe(400);
  });

  it("reads a file at a ref and from disk", async () => {
    const atRef = await get("file", { ref: PR_REF, path: "a.txt" });
    expect(atRef.status).toBe(200);
    expect(atRef.text).toBe("one\nTWO\nthree\nfour\n");

    const onDisk = await get("file", { path: "keep.txt" });
    expect(onDisk.status).toBe(200);
    expect(onDisk.text).toBe("kept\n");

    expect((await get("file", { path: "dir/b.txt" })).status).toBe(404);
    expect((await get("file", { ref: PR_REF, path: "dir/b.txt" })).status).toBe(404);
  });

  it("rejects a path outside the repo", async () => {
    writeFileSync(join(tmp, "secret.txt"), "secret\n");
    symlinkSync(join(tmp, "secret.txt"), join(repoDir, "link.txt"));

    for (const path of ["../secret.txt", "dir/../../secret.txt", join(tmp, "secret.txt"), "link.txt"]) {
      const res = await get("file", { path });
      expect(res.status, path).toBe(400);
      expect(res.text).not.toContain("secret\n");
    }
    expect((await get("file", { ref: PR_REF, path: "../secret.txt" })).status).toBe(400);
    expect((await get("diff-ref", { base: "main", head: PR_REF, path: "../x" })).status).toBe(400);
  });

  it("reports changed files with counts between base and head", async () => {
    const res = await get("changed", { base: "main", head: PR_REF });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { path: "a.txt", status: "M", add: 2, del: 1 },
      { path: "c.txt", status: "A", add: 1, del: 0 },
      { path: "dir/b.txt", status: "D", add: 0, del: 1 },
    ]);
  });

  it("returns the three-dot diff for one path", async () => {
    const res = await get("diff-ref", { base: "main", head: PR_REF, path: "a.txt" });
    expect(res.status).toBe(200);
    expect(res.text).toBe(sh(`diff main...${PR_REF} -- a.txt`));
    expect(res.text).toContain("+TWO");
  });
});
