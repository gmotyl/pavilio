import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * scripts/pull derives SCRIPT_DIR from $0 and the workspace from its parent, so a
 * copy placed in <sandbox>/my-workspace/scripts/ makes that clone the workspace.
 * Every run is confined to a fresh mkdtemp tree with HOME redirected; the package
 * manager and rsync are recording stubs first on PATH.
 */

const PULL_SH = resolve(__dirname, "../../../scripts/pull");
// scripts/pull sources its sibling scripts/pm for the toolchain.
const PM_SH = resolve(__dirname, "../../../scripts/pm");
/** Contract text, printed verbatim at the end of a pull (same as scripts/update.sh). */
const REMINDER =
  "With several instances, run `pnpm sync` only on the mirror machine; every other machine runs `pnpm pull`.";

let sandbox: string;
let home: string;
let stubBin: string;
/** The bare repo every machine of the shared workspace pushes to. */
let wsOrigin: string;
/** This machine's workspace clone — the one `pnpm pull` runs in. */
let dest: string;

function gitEnv() {
  return {
    ...process.env,
    HOME: home,
    GIT_AUTHOR_NAME: "Pull Test",
    GIT_AUTHOR_EMAIL: "pull-test@example.com",
    GIT_COMMITTER_NAME: "Pull Test",
    GIT_COMMITTER_EMAIL: "pull-test@example.com",
  };
}

function git(cwd: string, ...args: string[]): string {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: gitEnv() });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  return res.stdout.trim();
}

function runPull() {
  const res = spawnSync("bash", [join(dest, "scripts", "pull")], {
    encoding: "utf8",
    cwd: dest,
    env: { ...gitEnv(), PATH: `${stubBin}:${process.env.PATH ?? ""}` },
  });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

/** A recording stand-in for an external command; `extra` is appended to its body. */
function stubCommand(name: string, extra = ""): string {
  const marker = join(sandbox, `${name}-invoked`);
  writeFileSync(join(stubBin, name), `#!/bin/bash\necho "$@" >>"${marker}"\n${extra}\n`, { mode: 0o755 });
  return marker;
}

function invocations(marker: string): string {
  return existsSync(marker) ? readFileSync(marker, "utf8") : "";
}

/** Another machine's clone commits `files` and pushes them; `dest` has not pulled. */
function pushFromAnotherMachine(subject: string, files: Record<string, string>) {
  const other = join(sandbox, `other-${Math.random().toString(36).slice(2)}`);
  git(sandbox, "clone", "--quiet", wsOrigin, other);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(other, path, ".."), { recursive: true });
    writeFileSync(join(other, path), body);
  }
  git(other, "add", "-A");
  git(other, "commit", "-q", "-m", subject);
  git(other, "push", "-q", "origin", "HEAD:main");
}

/** Every commit reachable from HEAD, oldest first. */
function commits(): string[] {
  return git(dest, "rev-list", "--reverse", "HEAD").split("\n");
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "pull-sh-"));
  home = join(sandbox, "home");
  stubBin = join(sandbox, "stub-bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(stubBin, { recursive: true });

  wsOrigin = join(sandbox, "workspace-origin.git");
  mkdirSync(wsOrigin, { recursive: true });
  git(wsOrigin, "init", "--bare", "--quiet");
  git(wsOrigin, "symbolic-ref", "HEAD", "refs/heads/main");

  // Seed the workspace origin with the scripts and a panel, as a real workspace has.
  const seed = join(sandbox, "seed");
  mkdirSync(join(seed, "scripts"), { recursive: true });
  mkdirSync(join(seed, "panel"), { recursive: true });
  git(seed, "init", "--quiet");
  git(seed, "checkout", "-q", "-b", "main");
  copyFileSync(PULL_SH, join(seed, "scripts", "pull"));
  copyFileSync(PM_SH, join(seed, "scripts", "pm"));
  writeFileSync(join(seed, "panel", "package.json"), '{ "name": "panel-fixture", "version": "0.0.0" }\n');
  writeFileSync(join(seed, "notes.md"), "base\n");
  writeFileSync(join(seed, ".gitignore"), "node_modules/\ndist/\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "workspace initial");
  git(seed, "remote", "add", "origin", wsOrigin);
  git(seed, "push", "-q", "-u", "origin", "main");

  // Named like a Quick Start workspace, beside where a `pavilio` clone would sit.
  dest = join(sandbox, "my-workspace");
  git(sandbox, "clone", "--quiet", wsOrigin, dest);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("scripts/pull", () => {
  it("pull merges, builds and prints the reminder", () => {
    // Diverged on both sides, so the pull has to merge rather than fast-forward.
    writeFileSync(join(dest, "local.md"), "mine\n");
    git(dest, "add", "-A");
    git(dest, "commit", "-q", "-m", "local note");
    const local = git(dest, "rev-parse", "HEAD");
    pushFromAnotherMachine("remote note", { "remote.md": "theirs\n" });
    const remote = git(wsOrigin, "rev-parse", "main");
    const pnpmCalled = stubCommand("pnpm");

    const { status, output } = runPull();

    expect(status, output).toBe(0);
    expect(existsSync(join(dest, "remote.md"))).toBe(true);
    // git's own merge commit, parents in order: ours, then the remote's.
    expect(git(dest, "rev-parse", "HEAD^1")).toBe(local);
    expect(git(dest, "rev-parse", "HEAD^2")).toBe(remote);
    expect(git(dest, "log", "-1", "--pretty=%s")).toMatch(/^Merge branch 'main'/);
    // Installs the panel's dependencies, then builds the bundle — in that order.
    const calls = invocations(pnpmCalled);
    expect(calls).toContain(`-C ${join(dest, "panel")} install\n`);
    expect(calls).toMatch(new RegExp(`-C ${join(dest, "panel")} run build`));
    expect(calls.indexOf("install")).toBeLessThan(calls.indexOf("build"));
    expect(output).toContain(REMINDER);
    expect(git(dest, "status", "--porcelain")).toBe("");
  });

  it("pull never rsyncs from an upstream clone", () => {
    // The sibling clone update.sh would mirror from — it must stay untouched.
    const upstream = join(sandbox, "pavilio");
    mkdirSync(join(upstream, "panel"), { recursive: true });
    writeFileSync(join(upstream, "panel", "package.json"), '{ "name": "upstream" }\n');
    writeFileSync(join(upstream, "panel", "from-upstream.ts"), "export {};\n");
    git(upstream, "init", "--quiet");
    git(upstream, "add", "-A");
    git(upstream, "commit", "-q", "-m", "upstream");
    pushFromAnotherMachine("remote note", { "remote.md": "theirs\n" });
    const remote = git(wsOrigin, "rev-parse", "main");
    const before = commits();
    const rsyncCalled = stubCommand("rsync");
    stubCommand("pnpm");

    const { status, output } = runPull();

    expect(status, output).toBe(0);
    expect(existsSync(rsyncCalled)).toBe(false);
    expect(existsSync(join(dest, "panel", "from-upstream.ts"))).toBe(false);
    // A fast-forward to the remote, and not a single commit of its own on top.
    expect(git(dest, "rev-parse", "HEAD")).toBe(remote);
    expect(commits()).toEqual([...before, remote]);
    expect(git(dest, "status", "--porcelain")).toBe("");
  });

  it("pull stops on uncommitted files it would overwrite", () => {
    pushFromAnotherMachine("remote edit", { "notes.md": "theirs\n" });
    // Uncommitted local edit on the very file the remote changed: no autostash.
    writeFileSync(join(dest, "notes.md"), "half-written\n");
    const head = git(dest, "rev-parse", "HEAD");
    const pnpmCalled = stubCommand("pnpm");

    const { status, output } = runPull();

    expect(status).not.toBe(0);
    expect(output).toMatch(/would be overwritten/i);
    expect(output).toMatch(/notes\.md/);
    expect(output).toMatch(/Commit or move the files git named above/);
    // Nothing moved, the edit survived, and nothing was installed or built.
    expect(git(dest, "rev-parse", "HEAD")).toBe(head);
    expect(readFileSync(join(dest, "notes.md"), "utf8")).toBe("half-written\n");
    expect(git(dest, "stash", "list")).toBe("");
    expect(invocations(pnpmCalled)).not.toMatch(/build/);
    expect(invocations(pnpmCalled)).not.toMatch(/install/);
  });

  it("pull merges the workspace origin even when main tracks upstream", () => {
    // A bootstrapped clone-mode workspace: bootstrap renames origin→upstream (git
    // rewrites branch.main.remote to upstream), then adds the notes `origin`
    // without -u. A bare `git pull` would follow the tracking remote instead.
    const canonical = join(sandbox, "canonical.git");
    git(sandbox, "clone", "--quiet", "--bare", wsOrigin, canonical);
    const upstreamWork = join(sandbox, "canonical-work");
    git(sandbox, "clone", "--quiet", canonical, upstreamWork);
    writeFileSync(join(upstreamWork, "from-upstream.md"), "canonical\n");
    git(upstreamWork, "add", "-A");
    git(upstreamWork, "commit", "-q", "-m", "upstream only");
    git(upstreamWork, "push", "-q", "origin", "HEAD:main");
    git(dest, "remote", "rename", "origin", "upstream");
    git(dest, "remote", "set-url", "upstream", canonical);
    git(dest, "remote", "add", "origin", wsOrigin);
    expect(git(dest, "config", "branch.main.remote")).toBe("upstream");
    pushFromAnotherMachine("remote note", { "remote.md": "theirs\n" });
    const remote = git(wsOrigin, "rev-parse", "main");
    stubCommand("pnpm");

    const { status, output } = runPull();

    expect(status, output).toBe(0);
    expect(git(dest, "rev-parse", "HEAD")).toBe(remote);
    expect(existsSync(join(dest, "remote.md"))).toBe(true);
    expect(existsSync(join(dest, "from-upstream.md"))).toBe(false);
  });

  it("pull refuses without an origin remote and points at bootstrap", () => {
    git(dest, "remote", "rename", "origin", "upstream");
    const head = git(dest, "rev-parse", "HEAD");
    const pnpmCalled = stubCommand("pnpm");

    const { status, output } = runPull();

    expect(status).not.toBe(0);
    expect(output).toMatch(/no `origin` remote/i);
    expect(output).toMatch(/pnpm bootstrap/);
    expect(output).not.toMatch(/Commit or move the files/);
    expect(git(dest, "rev-parse", "HEAD")).toBe(head);
    expect(invocations(pnpmCalled)).toBe("");
  });

  it("pull refuses on a detached HEAD", () => {
    git(dest, "checkout", "-q", "--detach");
    const pnpmCalled = stubCommand("pnpm");

    const { status, output } = runPull();

    expect(status).not.toBe(0);
    expect(output).toMatch(/detached HEAD/i);
    expect(output).not.toMatch(/Commit or move the files/);
    expect(invocations(pnpmCalled)).toBe("");
  });

  it("pull failing for another reason prints a generic hint", () => {
    git(dest, "remote", "set-url", "origin", join(sandbox, "gone.git"));
    const pnpmCalled = stubCommand("pnpm");

    const { status, output } = runPull();

    expect(status).not.toBe(0);
    expect(output).toMatch(/see git's message above/);
    expect(output).not.toMatch(/Commit or move the files/);
    expect(invocations(pnpmCalled)).not.toMatch(/build/);
  });

  it("pull exits non-zero when the build fails", () => {
    pushFromAnotherMachine("remote note", { "remote.md": "theirs\n" });
    // Install succeeds, the build fails.
    stubCommand(
      "pnpm",
      ['for arg in "$@"; do', '  [ "$arg" = "build" ] && exit 1', "done", "exit 0"].join("\n"),
    );

    const { status, output } = runPull();

    expect(status).not.toBe(0);
    expect(output).toMatch(/build failed/i);
    expect(output).toMatch(/pnpm -C .*panel.* build/);
    expect(output).not.toMatch(/panel bundle built/);
  });
});
