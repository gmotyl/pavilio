import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gitSafeEnv } from "../gitEnv.js";
import { diffActiveChanges, listRepoWorktrees } from "../worktrees.js";

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

describe("diffActiveChanges", () => {
  let root: string, wt: string, main: string;

  /** Write `files` (relative path -> content) under `<openspecDir>/changes/<id>/`. */
  function change(openspecDir: string, id: string, files: Record<string, string>) {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(openspecDir, "changes", id, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
  }

  const full = {
    "proposal.md": "# proposal\n",
    "design.md": "# design\n",
    "specs/auth/spec.md": "# auth\n",
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "diff-changes-"));
    wt = join(root, "wt", "openspec");
    main = join(root, "main", "openspec");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("flags a change that exists only in the worktree", () => {
    change(wt, "2026-10-30-new", full);
    mkdirSync(join(main, "changes"), { recursive: true });
    expect(diffActiveChanges(wt, main)).toEqual(new Set(["2026-10-30-new"]));
    // A main tree with no changes dir at all behaves the same.
    rmSync(main, { recursive: true, force: true });
    expect(diffActiveChanges(wt, main)).toEqual(new Set(["2026-10-30-new"]));
  });

  it("ignores byte-identical copies of main's changes", () => {
    change(wt, "same", { ...full, "tasks.md": "- [ ] one\n" });
    change(main, "same", { ...full, "tasks.md": "- [ ] one\n" });
    // Non-artifact files do not count towards the diff.
    change(wt, "same", { "notes.txt": "scratch" });
    expect(diffActiveChanges(wt, main)).toEqual(new Set());
  });

  it("flags a change whose artifact set or bytes differ", () => {
    // Worktree adds tasks.md.
    change(wt, "added-tasks", { ...full, "tasks.md": "- [ ] one\n" });
    change(main, "added-tasks", full);
    // Worktree edits design.md.
    change(wt, "edited-design", { ...full, "design.md": "# design v2\n" });
    change(main, "edited-design", full);
    // Worktree edits a delta spec.
    change(wt, "edited-spec", { ...full, "specs/auth/spec.md": "# auth v2\n" });
    change(main, "edited-spec", full);
    // Worktree adds a delta spec for a new capability.
    change(wt, "added-spec", { ...full, "specs/billing/spec.md": "# billing\n" });
    change(main, "added-spec", full);
    // Worktree drops an artifact main has.
    change(wt, "dropped-proposal", { "design.md": full["design.md"] });
    change(main, "dropped-proposal", full);
    // Control: identical.
    change(wt, "untouched", full);
    change(main, "untouched", full);
    expect(diffActiveChanges(wt, main)).toEqual(
      new Set(["added-tasks", "edited-design", "edited-spec", "added-spec", "dropped-proposal"]),
    );
  });

  it("never flags archived changes", () => {
    change(wt, "archive/2026-10-01-old", full);
    change(wt, "archive/2026-10-02-edited", { "proposal.md": "# v2\n" });
    change(main, "archive/2026-10-02-edited", { "proposal.md": "# v1\n" });
    expect(diffActiveChanges(wt, main)).toEqual(new Set());
  });

  it("returns an empty set when the worktree has no changes dir", () => {
    change(main, "only-main", full);
    expect(diffActiveChanges(wt, main)).toEqual(new Set());
    expect(diffActiveChanges(join(root, "nowhere"), join(root, "nowhere-either"))).toEqual(new Set());
  });
});
