import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * scripts/install-git-hooks is panel/package.json's "prepare". It must install
 * pavilio's husky gates into a pavilio clone and nowhere else: a sync-mode
 * workspace gets panel/ rsync'd in and runs the same prepare on `pnpm install`.
 * There it points core.hooksPath at scripts/git-hooks (the consumer pre-push
 * guard) unless the user set a hooksPath; rerere is enabled in every repo.
 *
 * Each case runs a copy of the script (plus scripts/remotes) inside a sandbox
 * git repo. `husky` is a stub on a sandbox PATH that records its argv and cwd,
 * so the real one never touches any repository. The environment is built from
 * literals only: no GIT_DIR or GIT_* from a hook-run host can redirect git.
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const SCRIPT = join(REPO_ROOT, "scripts", "install-git-hooks");
const REMOTES_LIB = join(REPO_ROOT, "scripts", "remotes");

const BASH = spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim() || "/bin/bash";
const SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin";

let sandbox: string;
let repo: string;
let stubBin: string;
let huskyLog: string;

function env() {
  return { HOME: sandbox, PATH: `${stubBin}:${SYSTEM_PATH}`, LANG: "C" };
}

function git(args: string[]) {
  const r = spawnSync("git", args, { cwd: repo, env: env(), encoding: "utf8" });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}

function runPrepare() {
  // Run from panel/ exactly as pnpm runs "prepare": `bash ../scripts/install-git-hooks`.
  expect(repo.startsWith(sandbox)).toBe(true);
  return spawnSync(BASH, ["../scripts/install-git-hooks"], {
    cwd: join(repo, "panel"),
    env: env(),
    encoding: "utf8",
  });
}

beforeEach(() => {
  // realpath: macOS tmpdir is a /var -> /private/var symlink and the stub logs the resolved $PWD.
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "install-git-hooks-")));
  repo = join(sandbox, "repo");
  stubBin = join(sandbox, "bin");
  huskyLog = join(sandbox, "husky.log");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "panel"), { recursive: true });
  mkdirSync(join(repo, "scripts", "git-hooks"), { recursive: true });
  mkdirSync(stubBin);
  copyFileSync(SCRIPT, join(repo, "scripts", "install-git-hooks"));
  copyFileSync(REMOTES_LIB, join(repo, "scripts", "remotes"));
  writeFileSync(join(stubBin, "husky"), `#!/bin/sh\necho "$PWD $*" >> "${huskyLog}"\n`, { mode: 0o755 });
  expect(git(["init", "-q"]).status).toBe(0);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("scripts/install-git-hooks", () => {
  it("installs husky from the repo root when origin is the pavilio repository", () => {
    git(["remote", "add", "origin", "git@github.com:gmotyl/pavilio.git"]);
    const r = runPrepare();
    expect(r.status).toBe(0);
    expect(readFileSync(huskyLog, "utf8").trim()).toBe(`${repo} panel/.husky`);
  });

  it("installs husky when only the upstream remote is pavilio (a fork-based clone)", () => {
    git(["remote", "add", "origin", "git@github.com:someone/my-workspace.git"]);
    git(["remote", "add", "upstream", "https://github.com/gmotyl/pavilio.git"]);
    expect(runPrepare().status).toBe(0);
    expect(existsSync(huskyLog)).toBe(true);
  });

  it("install-git-hooks points a sync-mode workspace at scripts/git-hooks", () => {
    git(["remote", "add", "origin", "git@github.com:someone/projects.git"]);
    const r = runPrepare();
    expect(r.status).toBe(0);
    // pavilio's own husky gates never reach a workspace — only the consumer guard.
    expect(existsSync(huskyLog)).toBe(false);
    expect(git(["config", "--local", "--get", "core.hooksPath"]).stdout).toBe("scripts/git-hooks");
    // Idempotent and quiet on a second run.
    const again = runPrepare();
    expect(again.status).toBe(0);
    expect(again.stderr).not.toMatch(/warning/i);
    expect(git(["config", "--local", "--get", "core.hooksPath"]).stdout).toBe("scripts/git-hooks");
  });

  it("does not point a workspace at scripts/git-hooks it does not have", () => {
    git(["remote", "add", "origin", "git@github.com:someone/projects.git"]);
    rmSync(join(repo, "scripts", "git-hooks"), { recursive: true, force: true });
    expect(runPrepare().status).toBe(0);
    expect(git(["config", "--local", "--get", "core.hooksPath"]).status).not.toBe(0);
  });

  it("replaces a core.hooksPath an earlier install pointed at panel/.husky/_", () => {
    git(["remote", "add", "origin", "git@github.com:someone/projects.git"]);
    git(["config", "core.hooksPath", "panel/.husky/_"]);
    const r = runPrepare();
    expect(r.status).toBe(0);
    expect(git(["config", "--local", "--get", "core.hooksPath"]).stdout).toBe("scripts/git-hooks");
    expect(r.stdout).toMatch(/removed core\.hooksPath/);
  });

  it("replaces a local core.hooksPath that points at a directory that does not exist", () => {
    // The real-world shape: an absolute path to a husky dir that was since deleted.
    git(["remote", "add", "origin", "git@github.com:someone/projects.git"]);
    const missing = join(sandbox, "gone", ".husky", "_");
    git(["config", "core.hooksPath", missing]);
    const r = runPrepare();
    expect(r.status).toBe(0);
    expect(git(["config", "--local", "--get", "core.hooksPath"]).stdout).toBe("scripts/git-hooks");
    expect(r.stdout).toContain(`replaced core.hooksPath=${missing}`);
    expect(r.stderr).not.toMatch(/warning/i);
  });

  it("overrides a global core.hooksPath that points at a missing directory, leaving the global alone", () => {
    git(["remote", "add", "origin", "git@github.com:someone/projects.git"]);
    git(["config", "--global", "core.hooksPath", "~/no-such-hooks"]);
    const r = runPrepare();
    expect(r.status).toBe(0);
    expect(git(["config", "--local", "--get", "core.hooksPath"]).stdout).toBe("scripts/git-hooks");
    expect(git(["config", "--global", "--get", "core.hooksPath"]).stdout).toBe("~/no-such-hooks");
    expect(r.stdout).toContain("replaced core.hooksPath=~/no-such-hooks");
  });

  it("install-git-hooks keeps a user-set hooksPath", () => {
    git(["remote", "add", "origin", "git@github.com:someone/projects.git"]);
    mkdirSync(join(repo, ".githooks"));
    git(["config", "core.hooksPath", ".githooks"]);
    const r = runPrepare();
    expect(r.status).toBe(0);
    expect(git(["config", "--local", "--get", "core.hooksPath"]).stdout).toBe(".githooks");
    expect(r.stderr).toMatch(/warning.*core\.hooksPath=\.githooks.*scripts\/git-hooks\/pre-push/is);
  });

  it("install-git-hooks enables rerere", () => {
    // A sync-mode workspace and a pavilio clone alike.
    git(["remote", "add", "origin", "git@github.com:someone/projects.git"]);
    expect(runPrepare().status).toBe(0);
    expect(git(["config", "--local", "--get", "rerere.enabled"]).stdout).toBe("true");

    git(["config", "--local", "--unset", "rerere.enabled"]);
    git(["remote", "set-url", "origin", "git@github.com:gmotyl/pavilio.git"]);
    expect(runPrepare().status).toBe(0);
    expect(existsSync(huskyLog)).toBe(true);
    expect(git(["config", "--local", "--get", "rerere.enabled"]).stdout).toBe("true");
  });

  it("is a no-op outside a git checkout", () => {
    rmSync(join(repo, ".git"), { recursive: true, force: true });
    const r = runPrepare();
    expect(r.status).toBe(0);
    expect(existsSync(huskyLog)).toBe(false);
  });
});
