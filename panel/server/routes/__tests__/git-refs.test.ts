import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { execSync } from "child_process";
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "fs";
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

  it("stops counting untracked files past the file budget and still lists them", async () => {
    mkdirSync(join(repoDir, "n"));
    for (let i = 0; i < 510; i++) writeFileSync(join(repoDir, "n", `f${String(i).padStart(3, "0")}.txt`), "x\n");
    const res = await get("tree", {});
    expect(res.status).toBe(200);
    const untracked = res.body.files.filter((f: { status: string }) => f.status === "?");
    expect(untracked).toHaveLength(511);
    expect(untracked.filter((f: { add?: number }) => f.add !== undefined)).toHaveLength(500);
    expect(untracked.find((f: { path: string }) => f.path === "n/f499.txt")).toEqual({ path: "n/f499.txt", status: "?", add: 1, del: 0 });
    expect(untracked.find((f: { path: string }) => f.path === "n/f500.txt")).toEqual({ path: "n/f500.txt", status: "?" });
    expect(untracked.find((f: { path: string }) => f.path === "u.txt")).toEqual({ path: "u.txt", status: "?" });
  });

  it("stops counting untracked files past the byte budget", async () => {
    mkdirSync(join(repoDir, "n"));
    const chunk = "y".repeat(63) + "\n";
    // 70 files of 60 KiB: the 4 MiB budget runs out after 68.
    for (let i = 0; i < 70; i++) writeFileSync(join(repoDir, "n", `g${String(i).padStart(2, "0")}.txt`), chunk.repeat(960));
    const res = await get("tree", {});
    expect(res.status).toBe(200);
    const counted = res.body.files.filter((f: { path: string; add?: number }) => f.path.startsWith("n/") && f.add !== undefined);
    expect(counted).toHaveLength(68);
    expect(res.body.files.find((f: { path: string }) => f.path === "n/g69.txt")).toEqual({ path: "n/g69.txt", status: "?" });
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

  it("keeps three context lines whatever the user's diff.context says", async () => {
    // Review comments anchor to unchanged lines GitHub shows; a diff.context of 0 would drop them.
    sh("config diff.context 0");
    const ref = (await get("diff-ref", { base: "main", head: PR_REF, path: "a.txt" })).text;
    expect(ref).toContain("\n one\n");
    expect(ref).toContain("\n three\n");
    expect(ref).toBe(sh(`diff -U3 main...${PR_REF} -- a.txt`));
    const commit = (await get("diff", { sha: sh(`rev-parse ${PR_REF}`).trim(), file: "a.txt" })).body.diff;
    expect(commit).toContain("\n one\n");
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

  it("refuses files over the read cap from disk and at a ref", async () => {
    const big = "z".repeat(2 * 1024 * 1024 + 1);
    writeFileSync(join(repoDir, "huge.txt"), big);
    const disk = await get("file", { path: "huge.txt" });
    expect(disk.status).toBe(413);
    expect(disk.body).toEqual({ error: "file too large", tooLarge: true, size: big.length });

    sh("add huge.txt");
    sh("commit -q -m huge");
    const atRef = await get("file", { ref: "HEAD", path: "huge.txt" });
    expect(atRef.status).toBe(413);
    expect(atRef.body).toEqual({ error: "file too large", tooLarge: true, size: big.length });
  });

  it("refuses .git internals reached through an untracked symlink when diffing against HEAD", async () => {
    symlinkSync(".git/config", join(repoDir, "cfg"));
    const res = await get("diff", { file: "cfg", against: "HEAD" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("[core]");
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

  it("guards untracked diffs against HEAD: size cap, binary, vanished file", async () => {
    writeFileSync(join(repoDir, "big.txt"), "z".repeat(1024 * 1024 + 1));
    const big = await get("diff", { file: "big.txt", against: "HEAD" });
    expect(big.status).toBe(200);
    expect(big.body).toEqual({ diff: "", tooLarge: true, size: 1024 * 1024 + 1 });

    writeFileSync(join(repoDir, "bin.dat"), Buffer.from([1, 0, 2, 3]));
    const bin = await get("diff", { file: "bin.dat", against: "HEAD" });
    expect(bin.status).toBe(200);
    expect(bin.body).toEqual({ diff: "", binary: true });

    symlinkSync(join(repoDir, "gone.txt"), join(repoDir, "dangling.txt"));
    expect((await get("diff", { file: "dangling.txt", against: "HEAD" })).status).toBe(404);
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

  it("resolves a ref to its commit sha, refusing unknown or option-like refs", async () => {
    const res = await get("resolve", { ref: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sha: sh("rev-parse HEAD").trim() });
    expect((await get("resolve", { ref: PR_REF })).body.sha).toBe(sh(`rev-parse ${PR_REF}`).trim());
    expect((await get("resolve", { ref: "nope" })).status).toBe(400);
    expect((await get("resolve", { ref: "--all" })).status).toBe(400);
    expect((await get("resolve", {})).status).toBe(400);
  });

  it("an unborn repository logs no commits rather than failing", async () => {
    const fresh = join(tmp, "fresh");
    mkdirSync(fresh);
    execSync("git init -q", { cwd: fresh, stdio: "pipe", env: gitSafeEnv() });
    const res = await request(app()).get(`/api/git/log?repo=${encodeURIComponent(fresh)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("greps untracked files too, never ignored ones", async () => {
    writeFileSync(join(repoDir, "ignored.log"), "untracked\n");
    const res = await get("grep", { q: "untracked" });
    expect(res.status).toBe(200);
    expect(res.body.map((r: { relativePath: string }) => r.relativePath)).toEqual(["u.txt"]);
  });

  it("greps with root-relative paths when repo is a subdirectory, like /tree and /file", async () => {
    writeFileSync(join(repoDir, "dir", "keep.txt"), "kept too\n");
    const qs = new URLSearchParams({ repo: join(repoDir, "dir"), q: "kept" }).toString();
    const res = await request(app()).get(`/api/git/grep?${qs}`);
    expect(res.status).toBe(200);
    expect(res.body.map((r: { relativePath: string }) => r.relativePath).sort()).toEqual(["dir/keep.txt", "keep.txt"]);
  });

  it("greps a filename holding a colon-number-colon sequence or non-ASCII literally", async () => {
    writeFileSync(join(repoDir, "a:12:b.txt"), "needle\n");
    writeFileSync(join(repoDir, "zażółć.txt"), "needle\n");
    const res = await get("grep", { q: "needle" });
    expect(res.status).toBe(200);
    expect(res.body.map((r: { relativePath: string }) => r.relativePath).sort()).toEqual(["a:12:b.txt", "zażółć.txt"]);
    expect(res.body[0].matches).toEqual([{ line: 1, text: "needle" }]);
  });

  it("answers 400 when base and head share no history", async () => {
    const emptyTree = sh("hash-object -t tree --stdin </dev/null").trim();
    sh(`update-ref refs/heads/lone ${sh(`commit-tree ${emptyTree} -m lone`).trim()}`);
    for (const route of ["changed", "diff-ref"]) {
      const res = await get(route, { base: "main", head: "lone", path: "a.txt" });
      expect(res.status, route).toBe(400);
      expect(res.body.error, route).toMatch(/merge base/);
      // A code the client can tell apart from a plain failure: Retry alone cannot fix it.
      expect(res.body.code, route).toBe("no-merge-base");
    }
  });

  it("lists and diffs the files of the root commit", async () => {
    const root = sh("rev-parse main").trim();
    const files = await get("commit-files", { sha: root });
    expect(files.status).toBe(200);
    expect(files.body).toEqual(
      expect.arrayContaining([
        { status: "A", path: "a.txt" },
        { status: "A", path: "dir/b.txt" },
      ]),
    );
    const diff = await get("diff", { sha: root, file: "a.txt" });
    expect(diff.status).toBe(200);
    expect(diff.body.diff).toContain("+one");
  });

  it("lists and diffs a merge commit against its first parent", async () => {
    sh("stash -q -u");
    sh(`checkout -q -b side ${PR_REF}`);
    sh("checkout -q main");
    writeFileSync(join(repoDir, "keep.txt"), "main side\n");
    sh("commit -q -am mainline");
    sh("merge -q --no-ff --no-edit side");
    const merge = sh("rev-parse HEAD").trim();

    const files = await get("commit-files", { sha: merge });
    expect(files.status).toBe(200);
    expect(files.body).toEqual(
      expect.arrayContaining([
        { status: "M", path: "a.txt" },
        { status: "A", path: "c.txt" },
        { status: "D", path: "dir/b.txt" },
      ]),
    );
    expect(files.body).not.toContainEqual(expect.objectContaining({ path: "keep.txt" }));
    const diff = await get("diff", { sha: merge, file: "a.txt" });
    expect(diff.status).toBe(200);
    expect(diff.body.diff).toContain("+TWO");
  });

  it("lists an octopus merge against its first parent", async () => {
    sh("stash -q -u");
    for (const side of ["s1", "s2"]) {
      sh(`checkout -q -b ${side} main`);
      writeFileSync(join(repoDir, `${side}.txt`), `${side}\n`);
      sh(`add ${side}.txt`);
      sh(`commit -q -m ${side}`);
    }
    sh("checkout -q main");
    writeFileSync(join(repoDir, "keep.txt"), "main side\n");
    sh("commit -q -am mainline");
    sh("merge -q --no-edit s1 s2");
    const merge = sh("rev-parse HEAD").trim();
    expect(sh(`rev-list --parents -n1 ${merge}`).trim().split(" ")).toHaveLength(4);

    const files = await get("commit-files", { sha: merge });
    expect(files.status).toBe(200);
    expect(files.body).toEqual([
      { status: "A", path: "s1.txt" },
      { status: "A", path: "s2.txt" },
    ]);
  });

  it("refuses a sha that is not a commit before any shell sees it", async () => {
    const marker = join(tmp, "pwned");
    for (const sha of [`main;touch ${marker}`, "--output=x", "nope"]) {
      for (const [route, extra] of [["commit-files", {}], ["diff", { file: "a.txt" }]] as const) {
        const res = await get(route, { sha, ...extra });
        expect(res.status, `${route} ${sha}`).toBe(400);
      }
    }
    expect(existsSync(marker)).toBe(false);
  });
});

/** A clean repo with one commit of `files`, made the current `repoDir`. */
function freshRepo(name: string, files: Record<string, string>, init = "init -q"): string {
  repoDir = join(tmp, name);
  mkdirSync(repoDir);
  sh(init);
  sh("symbolic-ref HEAD refs/heads/main");
  for (const [p, c] of Object.entries(files)) writeFileSync(join(repoDir, p), c);
  sh("add -A");
  sh("commit -q -m base");
  return repoDir;
}

const TEN = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n") + "\n";

describe("ref-based git reads: path and status edge cases", () => {
  it("diffs a renamed file as a rename, between refs and against HEAD", async () => {
    freshRepo("ren", { "old.txt": TEN });
    sh("checkout -q -b r");
    sh("mv old.txt new.txt");
    writeFileSync(join(repoDir, "new.txt"), TEN.replace("line 3", "LINE 3"));
    sh("add -A");
    sh("commit -q -m r");
    sh("checkout -q main");
    const ref = await get("diff-ref", { base: "main", head: "r", path: "new.txt" });
    expect(ref.status).toBe(200);
    expect(ref.text).toContain("rename from old.txt");
    expect(ref.text).not.toContain("+line 0");

    sh("mv old.txt staged.txt");
    const wt = await get("diff", { file: "staged.txt", against: "HEAD" });
    expect(wt.status).toBe(200);
    expect(wt.body.diff).toContain("rename from old.txt");

    // A commit's own diff (History) too.
    const commit = await get("diff", { file: "new.txt", sha: sh("rev-parse r").trim() });
    expect(commit.status).toBe(200);
    expect(commit.body.diff).toContain("rename from old.txt");
    expect(commit.body.diff).not.toContain("+line 0");
  });

  it("returns literal non-ASCII paths from status and commit-files, rename source separately", async () => {
    freshRepo("utf", { "é.txt": "e\n", "src.txt": TEN });
    writeFileSync(join(repoDir, "é.txt"), "E\n");
    sh("commit -q -am edit");
    const files = await get("commit-files", { sha: "HEAD" });
    expect(files.body).toEqual([{ status: "M", path: "é.txt" }]);
    sh("mv src.txt dst.txt");
    writeFileSync(join(repoDir, "ü.txt"), "u\n");
    const status = await get("status", {});
    expect(status.body).toEqual(
      expect.arrayContaining([
        { status: "R", path: "dst.txt", from: "src.txt" },
        { status: "??", path: "ü.txt" },
      ]),
    );
  });

  it.skipIf(process.platform === "win32")("keeps a backslash in a POSIX filename literal", async () => {
    freshRepo("bs", { "a\\b.txt": "literal\n" });
    mkdirSync(join(repoDir, "a"));
    writeFileSync(join(repoDir, "a", "b.txt"), "split\n");
    const disk = await get("file", { path: "a\\b.txt" });
    expect(disk.text).toBe("literal\n");
    const atRef = await get("file", { path: "a\\b.txt", ref: "HEAD" });
    expect(atRef.text).toBe("literal\n");
  });

  it.skipIf(process.platform === "win32")("counts a changed file whose name has a tab", async () => {
    freshRepo("tab", { "t\tab.txt": "a\n" });
    sh("checkout -q -b t");
    writeFileSync(join(repoDir, "t\tab.txt"), "a\nb\n");
    sh("commit -q -am t");
    const res = await get("changed", { base: "main", head: "t" });
    expect(res.body).toEqual([{ path: "t\tab.txt", status: "M", add: 1, del: 0 }]);
  });

  it("keeps the surviving copy of a modify/delete conflict openable", async () => {
    freshRepo("ud", { "f.txt": "base\n" });
    sh("checkout -q -b del");
    sh("rm -q f.txt");
    sh("commit -q -m del");
    sh("checkout -q main");
    writeFileSync(join(repoDir, "f.txt"), "changed\n");
    sh("commit -q -am mod");
    try {
      sh("merge -q del");
    } catch {
      /* conflict expected */
    }
    const tree = await get("tree", {});
    expect(tree.body.files.find((f: { path: string }) => f.path === "f.txt")?.status).toBe("M");
  });

  it("synthesizes an untracked diff even when status hides untracked files", async () => {
    sh("config status.showUntrackedFiles no");
    const res = await get("diff", { file: "u.txt", against: "HEAD" });
    expect(res.body.diff).toContain("+untracked");
  });

  it("refuses to diff a shallow boundary commit as if it added the whole tree", async () => {
    const src = repoDir;
    sh("commit -q --allow-empty -m second");
    repoDir = join(tmp, "shallow");
    execSync(`git clone -q --depth 1 "file://${src}" "${repoDir}"`, { stdio: "pipe", env: gitSafeEnv() });
    const files = await get("commit-files", { sha: "HEAD" });
    expect(files.status).toBe(409);
    expect(files.body.error).toMatch(/shallow/);
    const diff = await get("diff", { sha: "HEAD", file: "a.txt" });
    expect(diff.status).toBe(409);
  });

  it("diffs the first changes of a SHA-256 repository", async () => {
    repoDir = join(tmp, "sha256");
    mkdirSync(repoDir);
    sh("init -q --object-format=sha256");
    writeFileSync(join(repoDir, "n.txt"), "new\n");
    sh("add n.txt");
    const unborn = await get("diff", { file: "n.txt", against: "HEAD" });
    expect(unborn.status).toBe(200);
    expect(unborn.body.diff).toContain("+new");
    sh("commit -q -m first");
    const first = await get("diff", { sha: "HEAD", file: "n.txt" });
    expect(first.status).toBe(200);
    expect(first.body.diff).toContain("+new");
  });
});

describe("GET /branches", () => {
  /** Local main + feat/a; bare origin with main, feat/b and origin/HEAD -> origin/main. */
  function withOrigin() {
    const origin = join(tmp, "origin.git");
    execSync(`git init -q --bare ${origin}`, { stdio: "pipe", env: gitSafeEnv() });
    sh(`remote add origin ${origin}`);
    sh("branch -q feat/b");
    sh("push -q origin main feat/b");
    sh("branch -q -D feat/b");
    sh("branch -q feat/a");
    sh("fetch -q origin");
    sh("remote set-head origin main");
  }

  it("branches lists local heads and remote branches separately", async () => {
    withOrigin();
    const res = await get("branches", {});
    expect(res.status).toBe(200);
    // git's for-each-ref order (refname-sorted)
    expect(res.body.local).toEqual(["feat/a", "main"]);
    expect(res.body.remote).toEqual([{ ref: "origin/feat/b", remote: "origin", name: "feat/b" }]);
  });

  it("branches drops origin/HEAD and remote branches with a local twin", async () => {
    withOrigin();
    const res = await get("branches", {});
    const refs = res.body.remote.map((r: { ref: string }) => r.ref);
    expect(refs).not.toContain("origin/HEAD");
    expect(refs).not.toContain("origin");
    expect(refs).not.toContain("origin/main");
  });

  it("branches keeps the legacy branches field unchanged", async () => {
    const bare = await get("branches", {});
    expect(bare.body).toEqual({ current: "main", branches: ["main"], local: ["main"], remote: [] });

    withOrigin();
    const res = await get("branches", {});
    const legacy = sh("branch -a --format='%(refname:short)'").trim().split("\n").filter(Boolean);
    expect(res.body.current).toBe("main");
    expect(res.body.branches).toEqual(legacy);
    expect(res.body.branches).toContain("origin");
  });

  it("branches dedupes a remote branch whose local twin shares a name with a tag", async () => {
    withOrigin();
    // A tag and a branch both named v1 make `%(refname:short)` answer `heads/v1`.
    sh("branch -q v1");
    sh("push -q origin v1");
    sh("tag v1");
    sh("fetch -q origin");
    const res = await get("branches", {});
    expect(res.status).toBe(200);
    expect(res.body.local).toContain("v1");
    expect(res.body.local).not.toContain("heads/v1");
    const refs = res.body.remote.map((r: { ref: string }) => r.ref);
    expect(refs).not.toContain("origin/v1");
  });

  it("branches skips a remote ref with no slash", async () => {
    withOrigin();
    sh("update-ref refs/remotes/stray HEAD");
    // A same-named tag makes `%(refname:short)` answer `remotes/stray`, which has a slash.
    sh("tag stray");
    const res = await get("branches", {});
    expect(res.status).toBe(200);
    expect(res.body.remote).toEqual([{ ref: "origin/feat/b", remote: "origin", name: "feat/b" }]);
  });
});
