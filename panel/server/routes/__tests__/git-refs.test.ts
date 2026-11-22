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
  it("lists the working tree with untracked files, status and counts", async () => {
    writeFileSync(join(repoDir, "a.txt"), "one\nTWO\nthree\nfour\n");
    sh("add a.txt");
    const res = await get("tree", {});
    expect(res.status).toBe(200);
    expect(res.body.files).toEqual([
      { path: ".gitignore", status: null },
      { path: "a.txt", status: "M", add: 2, del: 1 },
      { path: "dir/b.txt", status: "D", add: 0, del: 1 },
      { path: "keep.txt", status: "M", add: 1, del: 1 },
      { path: "u.txt", status: "?", add: 1, del: 0 },
    ]);
  });

  it("counts working tree changes before the first commit", async () => {
    const fresh = join(tmp, "fresh");
    mkdirSync(fresh);
    execSync("git init -q", { cwd: fresh, env: gitSafeEnv() });
    writeFileSync(join(fresh, "n.txt"), "a\nb\n");
    execSync("git add n.txt", { cwd: fresh, env: gitSafeEnv() });
    const res = await request(app()).get(`/api/git/tree?${new URLSearchParams({ repo: fresh })}`);
    expect(res.status).toBe(200);
    expect(res.body.files).toEqual([{ path: "n.txt", status: "A", add: 2, del: 0 }]);
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

  it("reports a rename with counts on the destination path", async () => {
    sh("checkout -q -b r");
    sh("mv a.txt moved.txt");
    writeFileSync(join(repoDir, "moved.txt"), "one\ntwo\nthree\nfour\n");
    sh("add moved.txt");
    sh("commit -q -m r");
    sh("checkout -q main");
    const res = await get("changed", { base: "main", head: "r" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ path: "moved.txt", status: "R", add: 1, del: 0 }]);
  });

  it("rejects a repo that is not a git repository", async () => {
    const plain = join(tmp, "plain");
    mkdirSync(plain);
    writeFileSync(join(plain, "f.txt"), "f\n");
    for (const [route, params] of [
      ["tree", {}],
      ["file", { path: "f.txt" }],
      ["changed", { base: "main", head: PR_REF }],
    ] as const) {
      const qs = new URLSearchParams({ repo: plain, ...params }).toString();
      const res = await request(app()).get(`/api/git/${route}?${qs}`);
      expect(res.status, route).toBe(400);
    }
  });

  it("uses root-relative paths when repo is a subdirectory", async () => {
    const qs = (p: Record<string, string>) => new URLSearchParams({ repo: join(repoDir, "dir"), ...p }).toString();
    const tree = await request(app()).get(`/api/git/tree?${qs({ ref: PR_REF })}`);
    expect(tree.body.files.map((f: { path: string }) => f.path)).toContain("a.txt");
    const file = await request(app()).get(`/api/git/file?${qs({ path: "keep.txt" })}`);
    expect(file.text).toBe("kept\n");
  });

  it("refuses to serve .git internals from disk", async () => {
    for (const path of [".git/config", ".git", "dir/../.git/HEAD", ".GIT/config"]) {
      expect((await get("file", { path })).status, path).toBe(400);
    }
  });

  it("refuses .git internals reached through a symlink", async () => {
    symlinkSync(".git/config", join(repoDir, "cfg"));
    symlinkSync(".git", join(repoDir, "gitdir"));
    for (const path of ["cfg", "gitdir/HEAD"]) {
      const res = await get("file", { path });
      expect(res.status, path).toBe(400);
      expect(res.text).not.toContain("[core]");
    }
  });

  it("answers 500, not 400/404, when git cannot run", async () => {
    const path = process.env.PATH;
    process.env.PATH = "";
    try {
      for (const [route, params] of [
        ["tree", {}],
        ["file", { path: "a.txt", ref: "main" }],
      ] as const) {
        expect((await get(route, params)).status, route).toBe(500);
      }
    } finally {
      process.env.PATH = path;
    }
  });

  it("treats paths literally, not as pathspec magic", async () => {
    const glob = await get("diff-ref", { base: "main", head: PR_REF, path: "*.txt" });
    expect(glob.status).toBe(200);
    expect(glob.text).toBe("");
  });

  it("answers 404 for a directory at a ref", async () => {
    expect((await get("file", { ref: "main", path: "dir" })).status).toBe(404);
  });

  it("diffs the working tree against HEAD when asked, staged changes included", async () => {
    writeFileSync(join(repoDir, "a.txt"), "one\nTWO\nthree\n");
    sh("add a.txt");
    expect((await get("diff", { file: "a.txt" })).body.diff).toBe("");
    const staged = (await get("diff", { file: "a.txt", against: "HEAD" })).body.diff;
    expect(staged).toContain("-two");
    expect(staged).toContain("+TWO");
    expect((await get("diff", { file: "keep.txt", against: "HEAD" })).body.diff).toContain("+kept");
    expect((await get("diff", { file: "u.txt", against: "HEAD" })).body.diff).toContain("+untracked");
    expect((await get("diff", { file: "a.txt", against: "main" })).status).toBe(400);

    writeFileSync(join(tmp, "secret.txt"), "secret\n");
    symlinkSync(join(tmp, "secret.txt"), join(repoDir, "out.txt"));
    const out = await get("diff", { file: "out.txt", against: "HEAD" });
    expect(out.status).toBe(400);
    expect(JSON.stringify(out.body)).not.toContain("secret\\n");
  });

  it("diffs against HEAD before the first commit", async () => {
    const fresh = join(tmp, "fresh");
    mkdirSync(fresh);
    execSync("git init -q", { cwd: fresh, env: gitSafeEnv() });
    writeFileSync(join(fresh, "n.txt"), "new\n");
    execSync("git add n.txt", { cwd: fresh, env: gitSafeEnv() });
    const qs = new URLSearchParams({ repo: fresh, file: "n.txt", against: "HEAD" }).toString();
    const res = await request(app()).get(`/api/git/diff?${qs}`);
    expect(res.status).toBe(200);
    expect(res.body.diff).toContain("+new");
  });

  it("answers 400 when base and head share no history", async () => {
    const emptyTree = sh("hash-object -t tree --stdin </dev/null").trim();
    sh(`update-ref refs/heads/lone ${sh(`commit-tree ${emptyTree} -m lone`).trim()}`);
    for (const route of ["changed", "diff-ref"]) {
      const res = await get(route, { base: "main", head: "lone", path: "a.txt" });
      expect(res.status, route).toBe(400);
      expect(res.body.error, route).toMatch(/merge base/);
    }
  });
});
