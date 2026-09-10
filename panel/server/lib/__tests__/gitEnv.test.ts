import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GIT_LOCATION_VARS, gitSafeEnv } from "../gitEnv.js";

/**
 * The bug these guard against: git reads GIT_DIR (and friends) before it looks at
 * cwd, so a child process inherits a repository rather than choosing one. Git
 * exports them to every hook, absolute in a linked worktree, which is how a
 * pre-push hook's test run reinitialised the shared clone and committed fixture
 * history onto main.
 */

let sandbox: string;

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...(env ?? process.env),
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  return res;
}

/** A repo standing in for the one a hook would have handed us via GIT_DIR. */
function makeRepo(path: string, subject: string): string {
  mkdirSync(path, { recursive: true });
  git(path, ["init", "--quiet"]);
  writeFileSync(join(path, "file.txt"), "original\n");
  git(path, ["add", "-A"]);
  git(path, ["commit", "-qm", subject]);
  return path;
}

function headSubject(repo: string): string {
  return git(repo, ["log", "-1", "--pretty=%s"]).stdout.trim();
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "gitenv-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("gitSafeEnv", () => {
  it("removes every repository-locating variable", () => {
    const polluted = Object.fromEntries(GIT_LOCATION_VARS.map((n) => [n, "/somewhere/.git"]));

    const cleaned = gitSafeEnv({ ...polluted, PATH: "/usr/bin" });

    for (const name of GIT_LOCATION_VARS) expect(cleaned[name]).toBeUndefined();
    expect(cleaned.PATH).toBe("/usr/bin");
  });

  it("keeps the GIT_* variables that carry the caller's intent", () => {
    // Only the locating ones are dangerous; identity, transport and prompting
    // settings are deliberate and must survive.
    const cleaned = gitSafeEnv({
      GIT_DIR: "/somewhere/.git",
      GIT_AUTHOR_NAME: "Greg",
      GIT_SSH_COMMAND: "ssh -i /key",
      GIT_TERMINAL_PROMPT: "0",
    });

    expect(cleaned.GIT_DIR).toBeUndefined();
    expect(cleaned.GIT_AUTHOR_NAME).toBe("Greg");
    expect(cleaned.GIT_SSH_COMMAND).toBe("ssh -i /key");
    expect(cleaned.GIT_TERMINAL_PROMPT).toBe("0");
  });

  it("does not mutate the environment it was handed", () => {
    const base = { GIT_DIR: "/somewhere/.git" };

    gitSafeEnv(base);

    expect(base.GIT_DIR).toBe("/somewhere/.git");
  });
});

describe("an inherited GIT_DIR", () => {
  it("hijacks a child git that was given only cwd — the bug itself", () => {
    const victim = makeRepo(join(sandbox, "victim"), "victim original");
    const work = join(sandbox, "work");
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, "fixture.txt"), "fixture\n");

    // Exactly what a hook hands a child: an absolute GIT_DIR. cwd says "work",
    // git hears "victim".
    const hookEnv = { ...process.env, GIT_DIR: join(victim, ".git") };
    git(work, ["add", "-A"], hookEnv);
    git(work, ["commit", "-qm", "fixture commit"], hookEnv);

    expect(headSubject(victim)).toBe("fixture commit");
  });

  it("is powerless once the env goes through gitSafeEnv", () => {
    const victim = makeRepo(join(sandbox, "victim"), "victim original");
    const work = makeRepo(join(sandbox, "work"), "work original");
    writeFileSync(join(work, "fixture.txt"), "fixture\n");

    const hookEnv = { ...process.env, GIT_DIR: join(victim, ".git") };
    git(work, ["add", "-A"], gitSafeEnv(hookEnv));
    git(work, ["commit", "-qm", "fixture commit"], gitSafeEnv(hookEnv));

    expect(headSubject(victim)).toBe("victim original");
    expect(headSubject(work)).toBe("fixture commit");
  });

  it("cannot reinitialise another repository through a bare init", () => {
    // The step that turned the shared clone bare: `git init --bare <path>` run
    // with GIT_DIR set re-inits whatever GIT_DIR names, not <path>.
    const victim = makeRepo(join(sandbox, "victim"), "victim original");
    const work = join(sandbox, "work");
    mkdirSync(work, { recursive: true });

    const hookEnv = { ...process.env, GIT_DIR: join(victim, ".git") };
    git(work, ["init", "--quiet", "--bare", join(work, "remote.git")], gitSafeEnv(hookEnv));

    expect(git(victim, ["rev-parse", "--is-bare-repository"]).stdout.trim()).toBe("false");
    expect(headSubject(victim)).toBe("victim original");
  });
});
