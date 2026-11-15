import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitSafeEnv } from "../lib/gitEnv.js";

// The guard for the git identity that test-setup.node.ts puts in the environment.
//
// A fixture that runs `git config user.name seed` writes into whichever repo git
// resolves, and once an inherited GIT_DIR resolved the real one. With identity
// supplied through GIT_AUTHOR_* / GIT_COMMITTER_*, fixtures have no reason to
// write a user.* key at all, so these tests pin that a commit in a sandbox with
// no identity configured anywhere still succeeds, as the fixture identity.
//
// "Nowhere" has to be made true on purpose: HOME and XDG_CONFIG_HOME point at
// the sandbox (git older than 2.32 ignores GIT_CONFIG_GLOBAL), the system file
// is skipped, and `user.useConfigOnly` stops git guessing `user@hostname` —
// without it a missing identity would go unnoticed on most machines.
describe("fixture git identity", () => {
  let sandbox: string;
  let repo: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "fixture-identity-"));
    writeFileSync(join(sandbox, "empty.gitconfig"), "");
    repo = join(sandbox, "repo");
    git(sandbox, ["init", "-q", repo]);
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  function isolatedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
      ...gitSafeEnv(),
      HOME: sandbox,
      XDG_CONFIG_HOME: join(sandbox, "xdg"),
      GIT_CONFIG_GLOBAL: join(sandbox, "empty.gitconfig"),
      GIT_CONFIG_SYSTEM: join(sandbox, "empty.gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
      ...extra,
    };
  }

  function git(cwd: string, args: string[], extra: NodeJS.ProcessEnv = {}): string {
    return execFileSync("git", args, {
      cwd,
      env: isolatedEnv(extra),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  function commit(extra: NodeJS.ProcessEnv = {}): void {
    git(repo, ["-c", "user.useConfigOnly=true", "commit", "-q", "--allow-empty", "-m", "probe"], extra);
  }

  function lastIdentity(): string {
    return git(repo, ["log", "-1", "--format=%an <%ae>|%cn <%ce>"]).trim();
  }

  it("a commit in a repo with no configured identity is authored and committed as the fixture identity", () => {
    commit();
    expect(lastIdentity()).toBe("fixture <fixture@test>|fixture <fixture@test>");
  });

  it("the fixture identity leaves no user.* key in the repo's config", () => {
    commit();
    const config = readFileSync(join(repo, ".git", "config"), "utf8");
    expect(config).not.toMatch(/^\s*\[user\]/m);
    expect(config).not.toMatch(/user\./);
  });

  it("a spawn's own GIT_AUTHOR_NAME overrides the fixture identity", () => {
    commit({ GIT_AUTHOR_NAME: "someone-else" });
    expect(lastIdentity()).toBe("someone-else <fixture@test>|fixture <fixture@test>");
  });
});
