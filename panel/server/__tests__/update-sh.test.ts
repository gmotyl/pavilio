import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * scripts/update.sh derives SCRIPT_DIR from $0 and REPO_ROOT from its parent, so a
 * copy of the script placed in <sandbox>/dest/scripts/ makes <sandbox>/dest the
 * destination workspace. Every run below is therefore confined to a fresh mkdtemp
 * tree: the real workspace is never a destination, and HOME is redirected too so a
 * guarded setup script cannot reach the real ~/.config.
 */

const UPDATE_SH = resolve(__dirname, "../../../scripts/update.sh");
// update.sh sources its sibling scripts/pm for the toolchain, so the sandbox copy
// needs it next to the script.
const PM_SH = resolve(__dirname, "../../../scripts/pm");

let sandbox: string;
let upstream: string;
let dest: string;
let home: string;
let origin: string;
let stubBin: string;

function git(cwd: string, ...args: string[]): string {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: gitEnv() });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

function gitEnv() {
  return {
    ...process.env,
    HOME: home,
    GIT_AUTHOR_NAME: "Update Test",
    GIT_AUTHOR_EMAIL: "update-test@example.com",
    GIT_COMMITTER_NAME: "Update Test",
    GIT_COMMITTER_EMAIL: "update-test@example.com",
  };
}

function currentBranch(): string {
  return git(upstream, "rev-parse", "--abbrev-ref", "HEAD");
}

function runUpdate(extraEnv: Record<string, string> = {}, upstreamArg: string = upstream) {
  const res = spawnSync("bash", [join(dest, "scripts", "update.sh"), upstreamArg], {
    encoding: "utf8",
    env: { ...gitEnv(), PATH: `${stubBin}:${process.env.PATH ?? ""}`, ...extraEnv },
  });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

/**
 * Put a recording stand-in for an external command first on the run's PATH. The
 * stub touches a marker file, so a test can assert the command was never reached
 * rather than inferring it from output alone.
 */
function stubCommand(name: string): string {
  const marker = join(sandbox, `${name}-invoked`);
  writeFileSync(join(stubBin, name), `#!/bin/bash\necho "$@" >>"${marker}"\n`, { mode: 0o755 });
  return marker;
}

/**
 * Turn the destination into a real workspace repo: the commit step is a no-op
 * without one, and it only runs at all when the build before it succeeds.
 */
function initDestRepo() {
  writePanelFixture(SUCCEEDING_BUILD);
  commitUpstream("panel build succeeds");
  git(dest, "init", "--quiet");
  git(dest, "checkout", "-q", "-b", "main");
  writeFileSync(join(dest, ".gitignore"), "node_modules/\ndist/\n");
  git(dest, "add", "-A");
  git(dest, "commit", "-q", "-m", "workspace initial");
}

function destStatus(): string {
  return git(dest, "status", "--porcelain");
}

/**
 * Turn the destination into a pavilio *clone* — the same repo update.sh is run
 * from — with `upstream` pointing at the bare origin. Clone mode is selected by
 * the upstream directory resolving to the repo itself, so these runs pass `dest`
 * as the argument. The script and pm are re-copied after the clone and stay
 * untracked, which is what a real clone of a workspace-less checkout looks like
 * here: origin's scripts/ never carries them, so they cannot collide on a rebase.
 */
function initCloneRepo() {
  writePanelFixture(SUCCEEDING_BUILD);
  commitUpstream("panel build succeeds");
  rmSync(dest, { recursive: true, force: true });
  git(sandbox, "clone", "--quiet", origin, dest);
  git(dest, "remote", "rename", "origin", "upstream");
  mkdirSync(join(dest, "scripts"), { recursive: true });
  copyFileSync(UPDATE_SH, join(dest, "scripts", "update.sh"));
  copyFileSync(PM_SH, join(dest, "scripts", "pm"));
  writeFileSync(join(dest, ".git", "info", "exclude"), "scripts/update.sh\nscripts/pm\n");
}

// A build that fails on purpose. The sandbox has no node_modules, so the real
// panel build could not run here anyway, and most cases only care about what the
// script does before it.
const FAILING_BUILD = 'node -e "process.exit(1)"';
// A build that succeeds and leaves a bundle behind, for the one case that needs
// the whole run to reach the summary. Plain node, no dependencies.
const SUCCEEDING_BUILD =
  'node -e "const f=require(\'fs\');f.mkdirSync(\'dist\',{recursive:true});f.writeFileSync(\'dist/index.html\',\'<!doctype html>\')"';

/** Rewrite the upstream fixture's panel/package.json to use a given build script. */
function writePanelFixture(buildScript: string) {
  writeFileSync(
    join(upstream, "panel", "package.json"),
    `${JSON.stringify(
      { name: "panel-fixture", version: "0.0.0", scripts: { build: buildScript } },
      null,
      2,
    )}\n`,
  );
}

/** Commit whatever the test just changed in the upstream fixture, so main can fast-forward. */
function commitUpstream(message: string) {
  git(upstream, "add", "-A");
  git(upstream, "commit", "-q", "-m", message);
  git(upstream, "push", "-q", "origin", "HEAD:main");
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "update-sh-"));
  home = join(sandbox, "home");
  upstream = join(sandbox, "upstream");
  dest = join(sandbox, "dest");
  stubBin = join(sandbox, "stub-bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(stubBin, { recursive: true });

  // A bare repo standing in for origin — the script fetches from it.
  origin = join(sandbox, "origin.git");
  mkdirSync(origin, { recursive: true });
  git(origin, "init", "--bare", "--quiet");
  git(origin, "symbolic-ref", "HEAD", "refs/heads/main");

  // The upstream clone, with the structure update.sh insists on.
  mkdirSync(join(upstream, "panel", "src"), { recursive: true });
  mkdirSync(join(upstream, "skills"), { recursive: true });
  mkdirSync(join(upstream, "scripts"), { recursive: true });
  git(upstream, "init", "--quiet");
  git(upstream, "checkout", "-q", "-b", "main");
  git(upstream, "config", "user.email", "update-test@example.com");
  git(upstream, "config", "user.name", "Update Test");
  writePanelFixture(FAILING_BUILD);
  writeFileSync(join(upstream, "panel", "src", "app.ts"), "export const app = 1;\n");
  writeFileSync(join(upstream, "skills", "demo.md"), "# demo\n");
  writeFileSync(join(upstream, "scripts", "noop.sh"), "#!/bin/bash\n");
  writeFileSync(join(upstream, "conflict.txt"), "main\n");
  git(upstream, "add", "-A");
  git(upstream, "commit", "-q", "-m", "initial");
  git(upstream, "remote", "add", "origin", origin);
  git(upstream, "push", "-q", "origin", "main");

  // The destination workspace: nothing but the script under test.
  mkdirSync(join(dest, "scripts"), { recursive: true });
  copyFileSync(UPDATE_SH, join(dest, "scripts", "update.sh"));
  copyFileSync(PM_SH, join(dest, "scripts", "pm"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("scripts/update.sh upstream branch handling", () => {
  it("switches an upstream clone off a feature branch onto main", () => {
    git(upstream, "checkout", "-q", "-b", "feature/wip");

    const { output } = runUpdate();

    expect(currentBranch()).toBe("main");
    expect(output).toMatch(/switch/i);
    expect(output).toMatch(/feature\/wip/);
  }, 60000);

  it("leaves an upstream clone already on main alone", () => {
    const { output } = runUpdate();

    expect(currentBranch()).toBe("main");
    expect(output).not.toMatch(/switch/i);
    expect(output).toMatch(/Syncing panel/);
  }, 60000);

  it("refuses to switch while an interactive rebase is in progress", () => {
    git(upstream, "checkout", "-q", "-b", "feature/wip");
    mkdirSync(join(upstream, ".git", "rebase-merge"), { recursive: true });

    const { status, output } = runUpdate();

    expect(status).not.toBe(0);
    expect(output).toMatch(/rebase/i);
    expect(output).not.toMatch(/Syncing panel/);
    expect(currentBranch()).toBe("feature/wip");
  }, 60000);

  it("refuses to switch while an am-style rebase is in progress", () => {
    git(upstream, "checkout", "-q", "-b", "feature/wip");
    mkdirSync(join(upstream, ".git", "rebase-apply"), { recursive: true });

    const { status, output } = runUpdate();

    expect(status).not.toBe(0);
    expect(output).toMatch(/rebase/i);
    expect(output).not.toMatch(/Syncing panel/);
    expect(currentBranch()).toBe("feature/wip");
  }, 60000);

  it("refuses to switch while a merge is in progress", () => {
    git(upstream, "checkout", "-q", "-b", "feature/wip");
    writeFileSync(join(upstream, ".git", "MERGE_HEAD"), `${git(upstream, "rev-parse", "HEAD")}\n`);

    const { status, output } = runUpdate();

    expect(status).not.toBe(0);
    expect(output).toMatch(/merge/i);
    expect(output).not.toMatch(/rebase/i);
    expect(output).not.toMatch(/Syncing panel/);
    expect(currentBranch()).toBe("feature/wip");
  }, 60000);

  it("refuses when checkout would overwrite local modifications, leaving the branch unchanged", () => {
    git(upstream, "checkout", "-q", "-b", "feature/wip");
    writeFileSync(join(upstream, "conflict.txt"), "feature\n");
    git(upstream, "commit", "-q", "-am", "diverge conflict.txt");
    // Uncommitted work on a file that differs between the branches: git checkout
    // itself must be the one that refuses.
    writeFileSync(join(upstream, "conflict.txt"), "uncommitted\n");

    const { status, output } = runUpdate();

    expect(status).not.toBe(0);
    expect(output).toMatch(/would be overwritten/i);
    expect(output).toMatch(/checkout main/);
    expect(currentBranch()).toBe("feature/wip");
    // The whole point of the guard: a failed switch must stop the run before any
    // rsync, or the feature branch's content gets mirrored into the workspace. A
    // non-zero exit alone does not prove that — the fixture's build fails too, so
    // the run would exit non-zero even if it had synced the wrong branch first.
    expect(output).not.toMatch(/Syncing panel/);
  }, 60000);

  it("syncs despite a harmless dirty file in the upstream clone", () => {
    git(upstream, "checkout", "-q", "-b", "feature/wip");
    // Identical on both branches, so `git checkout main` carries the edit across.
    writeFileSync(join(upstream, "panel", "src", "app.ts"), "export const app = 2;\n");

    const { output } = runUpdate();

    expect(currentBranch()).toBe("main");
    expect(output).toMatch(/Syncing panel/);
    expect(git(upstream, "status", "--porcelain")).toMatch(/panel\/src\/app\.ts/);
  }, 60000);
});

describe("scripts/update.sh panel build", () => {
  it("reports a build failure instead of a success summary", () => {
    const { status, output } = runUpdate();

    expect(status).not.toBe(0);
    expect(output).toMatch(/build failed/i);
    expect(output).toMatch(/pnpm -C .*panel.* build/);
    expect(output).not.toMatch(/^Done\./m);
  }, 60000);

  it("finishes with the summary and tells the user the panel is built and startable", () => {
    writePanelFixture(SUCCEEDING_BUILD);
    commitUpstream("panel build succeeds");

    const { status, output } = runUpdate();

    expect(status).toBe(0);
    expect(output).toMatch(/panel bundle built/i);
    expect(output).toMatch(/^Done\./m);
    expect(output).toMatch(/built and ready to start: pnpm start/);
    expect(output).not.toMatch(/build failed/i);
    // The bundle lands in the destination workspace, never copied from upstream.
    expect(existsSync(join(dest, "panel", "dist", "index.html"))).toBe(true);
  }, 60000);
});

describe("scripts/update.sh sync commit", () => {
  it("commits the synced files so the workspace is left clean", () => {
    initDestRepo();

    const { status, output } = runUpdate();

    expect(status).toBe(0);
    expect(output).toMatch(/committed sync of upstream/);
    expect(destStatus()).toBe("");
    expect(git(dest, "log", "-1", "--pretty=%s")).toMatch(/^chore\(sync\): pavilio upstream @ /);
  }, 60000);

  it("names the upstream revision and subject it synced", () => {
    initDestRepo();
    const sha = git(upstream, "rev-parse", "--short", "HEAD");

    runUpdate();

    expect(git(dest, "log", "-1", "--pretty=%s")).toContain(sha);
    expect(git(dest, "log", "-1", "--pretty=%b")).toContain("panel build succeeds");
  }, 60000);

  it("leaves the user's own unrelated edits uncommitted", () => {
    initDestRepo();
    // A live notes workspace: the user's work in progress sits in the same tree
    // as the mirrored files, and a sync commit must never swallow it.
    writeFileSync(join(dest, "BRIEFING.md"), "my own draft\n");
    writeFileSync(join(dest, "notes.md"), "staged by hand\n");
    git(dest, "add", "notes.md");

    runUpdate();

    const status = destStatus();
    expect(status).toMatch(/\?\? BRIEFING\.md/);
    expect(status).toMatch(/^A {2}notes\.md$/m);
    // Anchored to a sync commit having actually happened, so the exclusions below
    // cannot pass merely because nothing was committed at all.
    expect(git(dest, "log", "-1", "--pretty=%s")).toMatch(/^chore\(sync\)/);
    const committed = git(dest, "show", "--name-only", "--pretty=", "HEAD");
    expect(committed).not.toMatch(/BRIEFING\.md/);
    expect(committed).not.toMatch(/notes\.md/);
  }, 60000);

  it("commits files that upstream retired, not just changed ones", () => {
    initDestRepo();
    runUpdate();
    // panel/ is mirrored with --delete, so a retired module must land in the
    // commit as a deletion or it lingers downstream as tracked dead code.
    rmSync(join(upstream, "panel", "src", "app.ts"));
    commitUpstream("retire app.ts");

    runUpdate();

    expect(destStatus()).toBe("");
    expect(git(dest, "show", "--name-status", "--pretty=", "HEAD")).toMatch(
      /^D\s+panel\/src\/app\.ts$/m,
    );
  }, 60000);

  it("skips a synced path the workspace gitignores instead of aborting the pull", () => {
    initDestRepo();
    // A generated directory the workspace deliberately does not track — exactly
    // how .claude/commands/ is set up downstream, ignored wholesale with one
    // force-added file inside. `git add` treats a pathspec matching only ignored
    // files as an error, which under `set -e` used to kill the run after a
    // successful sync and build.
    mkdirSync(join(dest, ".claude", "commands"), { recursive: true });
    writeFileSync(join(dest, ".claude", "commands", "generated.md"), "# generated\n");
    writeFileSync(join(dest, ".gitignore"), "node_modules/\ndist/\n.claude/commands/\n");
    git(dest, "add", "-A");
    git(dest, "commit", "-q", "-m", "ignore the generated commands");

    const { status, output } = runUpdate();

    expect(status).toBe(0);
    expect(output).toMatch(/committed sync of upstream/);
    expect(output).not.toMatch(/ignored by one of your \.gitignore/);
    // The ignored path is left alone; everything else still lands.
    expect(destStatus()).toBe("");
    expect(git(dest, "show", "--name-only", "--pretty=", "HEAD")).toMatch(/panel\//);
  }, 60000);

  it("says there is nothing to commit when the workspace is already in sync", () => {
    initDestRepo();
    runUpdate();
    const head = git(dest, "rev-parse", "HEAD");

    const { status, output } = runUpdate();

    expect(status).toBe(0);
    expect(output).toMatch(/nothing to commit/);
    expect(git(dest, "rev-parse", "HEAD")).toBe(head);
  }, 60000);

  it("skips committing when PAVILIO_PULL_COMMIT=0, leaving the sync in the tree", () => {
    initDestRepo();

    const { status, output } = runUpdate({ PAVILIO_PULL_COMMIT: "0" });

    expect(status).toBe(0);
    expect(output).toMatch(/PAVILIO_PULL_COMMIT=0/);
    expect(destStatus()).toMatch(/panel\//);
  }, 60000);

  it("refuses to commit into a workspace with a merge in progress", () => {
    initDestRepo();
    writeFileSync(join(dest, ".git", "MERGE_HEAD"), `${git(dest, "rev-parse", "HEAD")}\n`);
    const head = git(dest, "rev-parse", "HEAD");

    const { status, output } = runUpdate();

    expect(status).toBe(0);
    expect(output).toMatch(/merge or rebase in progress/);
    expect(output).toMatch(/^Done\./m);
    // The warning has to be true, not just printed: the user's merge still owns
    // HEAD, and the synced files are left in the tree for them to commit.
    expect(git(dest, "rev-parse", "HEAD")).toBe(head);
    expect(destStatus()).toMatch(/panel\//);
  }, 60000);

  it("still finishes the pull when the workspace is not a git repo at all", () => {
    writePanelFixture(SUCCEEDING_BUILD);
    commitUpstream("panel build succeeds");

    const { status, output } = runUpdate();

    expect(status).toBe(0);
    expect(output).toMatch(/not a git repo/);
    expect(output).toMatch(/^Done\./m);
  }, 60000);
});

describe("scripts/update.sh clone mode", () => {
  it("selects clone mode when the upstream directory is the repository itself", () => {
    initCloneRepo();
    const rsyncCalled = stubCommand("rsync");

    const { status, output } = runUpdate({}, dest);

    expect(status).toBe(0);
    expect(output).toMatch(/Updating in place \(clone mode\)/);
    // A clone has nothing to mirror from: the sync path must not run at all.
    expect(output).not.toMatch(/Syncing panel/);
    expect(existsSync(rsyncCalled)).toBe(false);
  }, 60000);

  it("refuses clone mode without an upstream remote and names pnpm setup", () => {
    initCloneRepo();
    git(dest, "remote", "remove", "upstream");

    const { status, output } = runUpdate({}, dest);

    expect(status).toBe(1);
    expect(output).toMatch(/No 'upstream' remote/);
    expect(output).toMatch(/pnpm setup/);
    expect(output).not.toMatch(/panel bundle built/);
  }, 60000);

  it("rebases the workspace's own commits on upstream/main and builds", () => {
    initCloneRepo();
    // The workspace's own notes commit — in a clone these are the user's commits,
    // so the update replays them on top of upstream rather than committing for them.
    mkdirSync(join(dest, "projects"), { recursive: true });
    writeFileSync(join(dest, "projects", "note.md"), "my own note\n");
    git(dest, "add", "-A");
    git(dest, "commit", "-q", "-m", "notes: my own work");
    // Upstream moves on in the meantime.
    writeFileSync(join(upstream, "panel", "src", "app.ts"), "export const app = 3;\n");
    commitUpstream("upstream moves on");
    const upstreamHead = git(upstream, "rev-parse", "HEAD");

    const { status, output } = runUpdate({}, dest);

    expect(status).toBe(0);
    // The user's commit sits on top of upstream/main, unchanged and uncommitted-over.
    expect(git(dest, "log", "-1", "--pretty=%s")).toBe("notes: my own work");
    expect(git(dest, "rev-parse", "HEAD~1")).toBe(upstreamHead);
    expect(output).toMatch(/panel bundle built/);
    expect(existsSync(join(dest, "panel", "dist", "index.html"))).toBe(true);
  }, 120000);

  it("stops on a rebase conflict with the path and continue/abort commands, without building", () => {
    initCloneRepo();
    writeFileSync(join(dest, "conflict.txt"), "mine\n");
    git(dest, "commit", "-q", "-am", "my conflicting edit");
    writeFileSync(join(upstream, "conflict.txt"), "theirs\n");
    commitUpstream("upstream conflicting edit");

    const { status, output } = runUpdate({}, dest);

    expect(status).toBe(1);
    expect(output).toMatch(/conflict\.txt/);
    expect(output).toMatch(/rebase --continue/);
    expect(output).toMatch(/rebase --abort/);
    expect(output).not.toMatch(/panel bundle built/);
    expect(existsSync(join(dest, "panel", "dist", "index.html"))).toBe(false);
  }, 60000);

  it("ends clone mode with the restart hint and never restarts the panel", () => {
    initCloneRepo();
    // scripts/panel is the only thing that can stop or start the panel. update.sh
    // must print the hint and leave the running process alone.
    const panelInvoked = join(sandbox, "panel-invoked");
    writeFileSync(
      join(dest, "scripts", "panel"),
      `#!/bin/bash\necho "$@" >>"${panelInvoked}"\n`,
      { mode: 0o755 },
    );
    const sha = git(dest, "rev-parse", "--short", "HEAD");
    const subject = git(dest, "log", "-1", "--pretty=%s");

    const { status, output } = runUpdate({}, dest);

    expect(status).toBe(0);
    expect(output).toContain(`Updated to ${sha} ${subject}.`);
    expect(output).toMatch(/The running panel still serves the old bundle — run: pnpm restart/);
    expect(existsSync(panelInvoked)).toBe(false);
    expect(output).not.toMatch(/\bkill\b/);
  }, 120000);
});
