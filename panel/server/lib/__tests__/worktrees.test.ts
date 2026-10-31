import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitSafeEnv } from "../gitEnv.js";
import { listRepoWorktrees } from "../worktrees.js";

// Fixture git calls strip GIT_DIR & co: when the suite runs from a hook in a
// linked worktree those would otherwise retarget the real repository.
function git(cwd: string, ...args: string[]) {
  const r = spawnSync(
    "git",
    ["-c", "user.name=fixture", "-c", "user.email=fixture@test", ...args],
    { cwd, encoding: "utf-8", env: gitSafeEnv() },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

describe("listRepoWorktrees", () => {
  let root: string, repo: string;

  beforeEach(() => {
    // realpath so the expected paths match what git reports.
    root = realpathSync(mkdtempSync(join(tmpdir(), "worktrees-")));
    repo = join(root, "repo");
    git(root, "init", "--quiet", repo);
    writeFileSync(join(repo, "a.txt"), "a\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "init");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("lists a linked worktree with its branch and head", () => {
    const wt = join(root, "repo-poc-wallet");
    git(repo, "worktree", "add", "--quiet", "-b", "poc-wallet", wt);
    const head = git(wt, "rev-parse", "HEAD").trim();
    expect(listRepoWorktrees(repo)).toEqual([{ path: wt, branch: "poc-wallet", head }]);
  });

  it("reports a detached worktree with null branch", () => {
    const wt = join(root, "repo-detached");
    git(repo, "worktree", "add", "--quiet", "--detach", wt);
    const head = git(wt, "rev-parse", "HEAD").trim();
    const result = listRepoWorktrees(repo);
    expect(result).toEqual([{ path: wt, branch: null, head }]);
    expect(result[0].head).toMatch(/^[0-9a-f]{40}$/);
  });

  it("omits prunable and missing worktrees", () => {
    const kept = join(root, "repo-kept");
    const prunable = join(root, "repo-prunable");
    const missing = join(root, "repo-missing");
    git(repo, "worktree", "add", "--quiet", "-b", "kept", kept);
    git(repo, "worktree", "add", "--quiet", "-b", "gone", prunable);
    git(repo, "worktree", "add", "--quiet", "-b", "locked", missing);
    // Deleted dir -> git reports it as prunable.
    rmSync(prunable, { recursive: true, force: true });
    // Locked + deleted -> git does not flag it prunable, but the dir is gone.
    git(repo, "worktree", "lock", missing);
    rmSync(missing, { recursive: true, force: true });
    expect(listRepoWorktrees(repo).map((w) => w.path)).toEqual([kept]);
  });

  it("never returns the main checkout", () => {
    expect(listRepoWorktrees(repo)).toEqual([]);
  });

  it("returns [] and warns once when git fails", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(listRepoWorktrees(join(root, "does-not-exist"))).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockClear();
    expect(listRepoWorktrees(root)).toEqual([]); // exists but is not a repo
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
