import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../config";
import { machineId } from "../lib/hostname";

/**
 * scripts/git-hooks/pre-push — the consumer pre-push guard (design D9).
 *
 * Each case builds a sandbox workspace cloned from a sandbox bare remote and
 * points its core.hooksPath at the real scripts/git-hooks, so a real `git push`
 * runs the guard exactly as a workspace would: refs on stdin, GIT_DIR exported
 * by git, the sync role resolved by the real scripts/sync-role (a tsx process,
 * hence node-slow). The test-setup strip keeps the host's GIT_DIR out of every
 * fixture; global and system git config are pinned to the sandbox.
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const HOOKS_DIR = join(REPO_ROOT, "scripts", "git-hooks");
const MIRROR_FILE = ".pavilio/sync-mirror.json";

let me: string;
let sandbox: string;
let remote: string;
let ws: string;

beforeAll(async () => {
  // The guard's scripts/machine-id loads panel.config.local.ts, so compare
  // against the same loaded config.
  await loadConfig();
  me = machineId();
});

function env(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(sandbox, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
}

function git(cwd: string, args: string[]) {
  expect(cwd.startsWith(sandbox)).toBe(true);
  const r = spawnSync("git", args, { cwd, env: env(), encoding: "utf8" });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}

function ok(cwd: string, args: string[]) {
  const r = git(cwd, args);
  expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
  return r.stdout;
}

function commitFile(cwd: string, path: string, content: string) {
  mkdirSync(join(cwd, path, ".."), { recursive: true });
  writeFileSync(join(cwd, path), content);
  ok(cwd, ["add", "--", path]);
  ok(cwd, ["commit", "-q", "-m", `edit ${path}`]);
}

/** Workspace with panel/, scripts/ and projects/ on origin/main, optionally a mirror file. */
function setup(mirror: string | undefined, hooksDir = HOOKS_DIR) {
  const seed = join(sandbox, "seed");
  mkdirSync(seed);
  ok(seed, ["init", "-q"]);
  ok(seed, ["symbolic-ref", "HEAD", "refs/heads/main"]); // git < 2.28 has no `init -b`
  commitFile(seed, "panel/a.txt", "upstream\n");
  commitFile(seed, "scripts/b", "upstream\n");
  commitFile(seed, "projects/x/notes.md", "notes\n");
  if (mirror !== undefined) commitFile(seed, MIRROR_FILE, JSON.stringify({ mirror }) + "\n");
  ok(sandbox, ["clone", "-q", "--bare", seed, remote]);
  ok(sandbox, ["clone", "-q", remote, ws]);
  ok(ws, ["config", "core.hooksPath", hooksDir]);
}

/** Another machine pushes a commit to the remote. */
function remoteCommit(path: string, content: string) {
  const other = join(sandbox, "other");
  ok(sandbox, ["clone", "-q", remote, other]);
  commitFile(other, path, content);
  ok(other, ["push", "-q", "--no-verify", "origin", "main"]);
}

function push() {
  return git(ws, ["push", "origin", "main"]);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "consumer-push-guard-"));
  remote = join(sandbox, "remote.git");
  ws = join(sandbox, "ws");
  writeFileSync(join(sandbox, "gitconfig"), "");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("scripts/git-hooks/pre-push", () => {
  it("guard refuses a consumer push that changes generated paths", () => {
    setup(`not-${me}`);
    commitFile(ws, "panel/a.txt", "local hotfix\n");
    commitFile(ws, "projects/x/notes.md", "more notes\n");
    const before = ok(remote, ["rev-parse", "main"]);

    const r = push();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("panel/a.txt");
    expect(r.stderr).not.toContain("projects/x/notes.md");
    expect(r.stderr).toContain("gmotyl/pavilio");
    expect(r.stderr).toContain("pnpm sync");
    expect(r.stderr).toContain("--no-verify");
    expect(ok(remote, ["rev-parse", "main"])).toBe(before);

    // The deliberate escape still works.
    expect(git(ws, ["push", "--no-verify", "origin", "main"]).status).toBe(0);
  });

  it("guard passes a consumer merge that takes the remote side", () => {
    setup(`not-${me}`);
    commitFile(ws, "panel/a.txt", "local edit\n");
    commitFile(ws, "projects/x/notes.md", "local notes\n");
    remoteCommit("panel/a.txt", "synced by the mirror\n");
    ok(ws, ["fetch", "-q", "origin"]);
    ok(ws, ["merge", "-q", "--no-edit", "-X", "theirs", "origin/main"]);

    const r = push();
    expect(r.status, r.stderr).toBe(0);
    expect(ok(remote, ["rev-parse", "main"])).toBe(ok(ws, ["rev-parse", "HEAD"]));
  });

  it("guard ignores the mirror", () => {
    setup(me);
    commitFile(ws, "panel/a.txt", "synced\n");
    commitFile(ws, "scripts/b", "synced\n");
    const r = push();
    expect(r.status, r.stderr).toBe(0);
    // Resolved as the mirror, not waved through by the fail-open path.
    expect(r.stderr).not.toMatch(/guard skipped/);
  });

  it("guard ignores a workspace without a mirror file", () => {
    setup(undefined);
    commitFile(ws, "panel/a.txt", "synced\n");
    const r = push();
    expect(r.status, r.stderr).toBe(0);
  });

  it("guard fails open with a warning when the sync role cannot be resolved", () => {
    // A copy of the guard whose scripts/ has no panel/ next to it: sync-role
    // cannot find tsx. The push must go through, with the reason on stderr.
    const copy = join(sandbox, "tooling", "scripts");
    mkdirSync(join(copy, "git-hooks"), { recursive: true });
    cpSync(join(HOOKS_DIR, "pre-push"), join(copy, "git-hooks", "pre-push"));
    for (const f of ["sync-role", "pm"]) cpSync(join(REPO_ROOT, "scripts", f), join(copy, f));
    setup(`not-${me}`, join(copy, "git-hooks"));
    commitFile(ws, "panel/a.txt", "local hotfix\n");

    const r = push();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/pre-push guard skipped/);
  });
});
