import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * scripts/bootstrap is the one command a fresh clone runs. It derives the repo root
 * from its own location, so every case here runs a *copy* of it (next to a copy
 * of scripts/pm) out of <sandbox>/repo/scripts/, against a sandbox git clone.
 *
 * CRITICAL isolation — this suite runs on a developer machine with a real
 * ~/.claude, a real ~/.codex, a real ~/.config/opencode, a real Desktop behind a
 * real powershell.exe, and a real `origin` pointing at the live pavilio remote.
 * None of them may be reachable from here, so:
 *
 *   - the environment is built from literals only; `process.env` is never spread
 *     into it, so nothing of the host leaks in;
 *   - HOME points inside the mkdtemp sandbox, and `run()` refuses to spawn
 *     anything whose HOME or repo is not under it;
 *   - PATH holds exactly two sandbox-owned directories: the stub toolchain
 *     (node/pnpm/npm/corepack) and a curated symlink bin with the handful of
 *     system tools the script legitimately needs (git and coreutils). No
 *     `claude`, no `codex`, no `powershell.exe` is discoverable;
 *   - every sub-script scripts/bootstrap drives (setup:claude-code, setup:opencode,
 *     setup:codex, install:speech, setup:shortcut) is a *stub* written into the
 *     sandbox. The real ones are never copied, so the code that would symlink
 *     into ~/.claude/skills or ask PowerShell to write a .lnk onto the Desktop is
 *     never executed at all;
 *   - git is real, but every repository and every remote URL is either inside the
 *     sandbox or a string that is only ever recorded, never contacted. The one
 *     `git fetch` that must succeed targets a bare repo inside the sandbox.
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const BOOTSTRAP = join(REPO_ROOT, "scripts", "bootstrap");
const PM_LIB = join(REPO_ROOT, "scripts", "pm");

/** Absolute, because the script runs on a PATH that could not resolve `bash`. */
const BASH =
  spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim() || "/bin/bash";

/** The canonical upstream, as scripts/bootstrap spells it when it adds one. */
const CANONICAL_HTTPS = "https://github.com/gmotyl/pavilio.git";

/**
 * The system tools scripts/bootstrap (and the git fixtures) may legitimately reach
 * for. Symlinked one by one into a sandbox bin rather than putting /usr/bin on
 * PATH, so the set of host executables this suite can see is enumerated here and
 * nowhere else.
 */
const SYSTEM_TOOLS = [
  "git",
  "mkdir",
  "cp",
  "mv",
  "rm",
  "cat",
  "ln",
  "readlink",
  "chmod",
  "dirname",
  "basename",
  "sed",
  "grep",
  "head",
  "tr",
  "cut",
  "sort",
  "uname",
  "id",
  "sh",
];

let sandbox: string;
let repo: string;
let home: string;
let stubBin: string;
let sysBin: string;
let calls: string;

function which(tool: string): string {
  return spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
}

function writeExec(path: string, lines: string[]) {
  writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o755 });
}

/** A stub that records its own invocation and then succeeds. */
function writeRecorder(path: string, label: string, extra: string[] = []) {
  writeExec(path, [
    "#!/bin/sh",
    `# Stub ${label}: record the invocation, do nothing else.`,
    `printf '%s\\n' "${label} $*" >> "${calls}"`,
    ...extra,
    "exit 0",
  ]);
}

/** The stub `node`, answering only the version probe. */
function writeNodeStub(version: string) {
  writeExec(join(stubBin, "node"), [
    "#!/bin/sh",
    "# Stub node: the version probe is the only thing setup asks it.",
    `printf '%s\\n' "node $*" >> "${calls}"`,
    'case "$1" in',
    `  --version|-v) printf '%s\\n' '${version}' ;;`,
    "esac",
    "exit 0",
  ]);
}

/** Every line the stubs recorded, in order. */
function recorded(): string[] {
  if (!existsSync(calls)) return [];
  return readFileSync(calls, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
}

function countRecorded(needle: string): number {
  return recorded().filter((l) => l.includes(needle)).length;
}

/**
 * Like countRecorded, but anchored at the start of the recorded line, which is
 * always "<tool> <args…>". `countRecorded("npm ")` also matches every
 * `pnpm -C …` line; this one means what it reads.
 */
function countRecordedTool(tool: string): number {
  return recorded().filter((l) => l === tool || l.startsWith(`${tool} `)).length;
}

/** Position of the first recorded line containing `needle`, or -1. */
function indexOfRecorded(needle: string): number {
  return recorded().findIndex((l) => l.includes(needle));
}

/** A literal string, safe to drop into a RegExp (sandbox paths carry dots). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The `run:` value of every `✗ … failed — run: <cmd>` line. The contract in
 * scripts/bootstrap's own header is that this is a command, not prose.
 */
function failureCommands(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((l) => l.startsWith("✗"))
    .map((l) => l.replace(/^✗ .* failed — run: /u, ""));
}

/** The first word of every failure command must be something you can run. */
const RUNNABLE = /^(pnpm|npm|corepack|node|git|bash|sh|touch|mkdir|cp|chmod)\b/;

function clearCalls() {
  writeFileSync(calls, "");
}

function git(args: string[], cwd: string = repo) {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      HOME: home,
      PATH: `${stubBin}:${sysBin}`,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Sandbox",
      GIT_AUTHOR_EMAIL: "sandbox@example.invalid",
      GIT_COMMITTER_NAME: "Sandbox",
      GIT_COMMITTER_EMAIL: "sandbox@example.invalid",
    },
  });
  return { status: res.status, output: `${res.stdout}${res.stderr}`, stdout: res.stdout };
}

/**
 * Build a sandbox checkout: a copy of scripts/bootstrap and scripts/pm, stubs for
 * every sub-script, the seed file, and a real git repository with `originUrl`
 * as its origin (omit for a repo with no remotes at all).
 */
function makeRepo(dir: string, originUrl?: string): string {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "panel"), { recursive: true });
  copyFileSync(BOOTSTRAP, join(dir, "scripts", "bootstrap"));
  copyFileSync(PM_LIB, join(dir, "scripts", "pm"));
  spawnSync("chmod", ["755", join(dir, "scripts", "bootstrap")]);
  writeFileSync(join(dir, "AGENTS.md.example"), "# Example registry\n\n- seeded\n");
  writeFileSync(join(dir, "panel", "package.json"), '{"name":"panel"}\n');
  for (const name of ["setup:claude-code", "setup:opencode", "setup:codex", "install:speech", "setup:shortcut"]) {
    writeRecorder(join(dir, "scripts", name), name);
  }

  git(["init"], dir);
  // git 2.25 still defaults to `master`, and there is no `git init -b`.
  git(["symbolic-ref", "HEAD", "refs/heads/main"], dir);
  writeFileSync(join(dir, "README.md"), "sandbox\n");
  git(["add", "-A"], dir);
  git(["commit", "-m", "sandbox"], dir);
  if (originUrl) git(["remote", "add", "origin", originUrl], dir);
  return dir;
}

function run(
  args: string[] = [],
  opts: { env?: Record<string, string>; input?: string; repoDir?: string } = {},
) {
  const dir = opts.repoDir ?? repo;
  const env: Record<string, string> = {
    HOME: home,
    PATH: `${stubBin}:${sysBin}`,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Sandbox",
    GIT_AUTHOR_EMAIL: "sandbox@example.invalid",
    GIT_COMMITTER_NAME: "Sandbox",
    GIT_COMMITTER_EMAIL: "sandbox@example.invalid",
    ...(opts.env ?? {}),
  };
  // Guard rails: a future edit must not be able to point this suite at the
  // developer's own home, checkout or PATH.
  if (!dir.startsWith(sandbox)) throw new Error(`refusing to run scripts/bootstrap outside the sandbox: ${dir}`);
  if (!env.HOME.startsWith(sandbox)) throw new Error(`refusing to run scripts/bootstrap with HOME=${env.HOME}`);
  // CODEX_HOME overrides ~/.codex on its own, so it is a second way out of the
  // sandbox and needs the same guard as HOME.
  if (env.CODEX_HOME !== undefined && !env.CODEX_HOME.startsWith(sandbox)) {
    throw new Error(`refusing to run scripts/bootstrap with CODEX_HOME=${env.CODEX_HOME}`);
  }
  for (const entry of env.PATH.split(":")) {
    if (!entry.startsWith(sandbox)) throw new Error(`refusing to run scripts/bootstrap with ${entry} on PATH`);
  }

  const res = spawnSync(BASH, [join(dir, "scripts", "bootstrap"), ...args], {
    encoding: "utf8",
    cwd: dir,
    env,
    // Always a closed/finite stdin: the origin prompt must never hang the suite.
    input: opts.input ?? "",
  });
  return { status: res.status, stdout: res.stdout, output: `${res.stdout}${res.stderr}` };
}

/** The per-host env file scripts/pm reads PAVILIO_NODE_BIN from. */
function localEnv(dir: string = repo): string {
  return join(dir, "scripts", "start-panel-windows.local.env");
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "setup-sh-"));
  repo = join(sandbox, "repo");
  home = join(sandbox, "home");
  stubBin = join(sandbox, "bin");
  sysBin = join(sandbox, "sysbin");
  calls = join(sandbox, "calls.log");

  mkdirSync(home, { recursive: true });
  mkdirSync(stubBin, { recursive: true });
  mkdirSync(sysBin, { recursive: true });
  writeFileSync(calls, "");

  for (const tool of SYSTEM_TOOLS) {
    const found = which(tool);
    if (found) symlinkSync(found, join(sysBin, tool));
  }

  writeNodeStub("v24.4.0");
  writeRecorder(join(stubBin, "pnpm"), "pnpm");
  writeRecorder(join(stubBin, "npm"), "npm");
  writeRecorder(join(stubBin, "corepack"), "corepack");

  makeRepo(repo, CANONICAL_HTTPS);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("scripts/bootstrap", () => {
  it("takes a fresh clone through install, build, seed, skills, speech and shortcut", () => {
    // Every agent this workspace knows about is "installed" in the sandbox home.
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    mkdirSync(join(home, ".codex"), { recursive: true });

    const { status, stdout, output } = run(["--yes"]);
    expect(status, output).toBe(0);

    // The two fatal steps ran exactly once each, through the package manager.
    expect(countRecorded(`pnpm -C ${join(repo, "panel")} install`)).toBe(1);
    expect(countRecorded(`pnpm -C ${join(repo, "panel")} run build`)).toBe(1);

    // The seed landed.
    expect(existsSync(join(repo, "projects"))).toBe(true);
    expect(readFileSync(join(repo, ".projects.local.md"), "utf8")).toBe(
      readFileSync(join(repo, "AGENTS.md.example"), "utf8"),
    );

    // Each tail step was invoked once, and no more than once.
    for (const name of ["setup:claude-code", "setup:opencode", "setup:codex", "install:speech", "setup:shortcut"]) {
      expect(countRecorded(name), `${name} invocations`).toBe(1);
    }

    // Order, not just presence: nothing that needs panel/node_modules may run
    // before the install, and the build is what the tail steps see.
    const panelDir = join(repo, "panel");
    const order = [
      `pnpm -C ${panelDir} install`,
      `pnpm -C ${panelDir} run build`,
      "setup:claude-code",
      "setup:opencode",
      "setup:codex",
      "install:speech",
      "setup:shortcut",
    ].map((needle) => [needle, indexOfRecorded(needle)] as const);
    for (const [needle, at] of order) expect(at, `${needle} was never recorded`).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1][1], `${order[i - 1][0]} must precede ${order[i][0]}`).toBeLessThan(order[i][1]);
    }

    // One line per step, in order, all of them done.
    expect(stdout).toMatch(/^✓ toolchain\b/m);
    expect(stdout).toMatch(/^✓ seed\b/m);
    expect(stdout).toMatch(/^✓ panel install$/m);
    expect(stdout).toMatch(/^✓ panel build$/m);
    expect(stdout).toMatch(/^✓ remotes\b/m);
    expect(stdout).toMatch(/^✓ skills \(claude-code\)$/m);
    expect(stdout).toMatch(/^✓ skills \(opencode\)$/m);
    expect(stdout).toMatch(/^✓ skills \(codex\)$/m);
    expect(stdout).toMatch(/^✓ speech$/m);
    expect(stdout).toMatch(/^✓ shortcut$/m);

    // And the last thing the user reads is how to start the panel.
    const lines = stdout.trimEnd().split("\n");
    expect(lines[lines.length - 1]).toBe("Done. Start the panel: pnpm start  →  http://localhost:3010");
  }, 60000);

  it("is idempotent: a second run changes no seeded file and no remote", () => {
    mkdirSync(join(home, ".claude"), { recursive: true });

    const first = run(["--yes"]);
    expect(first.status, first.output).toBe(0);

    // Stand-ins for a workspace that has been used: the seed is the user's file
    // now, and re-running setup must not reach into it.
    writeFileSync(join(repo, ".projects.local.md"), "# my own registry\n");
    mkdirSync(join(repo, "projects", "my-project"), { recursive: true });
    writeFileSync(join(repo, "projects", "my-project", "PROJECT.md"), "mine\n");

    const seedBefore = readFileSync(join(repo, ".projects.local.md"));
    const remotesBefore = git(["remote", "-v"]).stdout;
    const envBefore = readFileSync(localEnv(), "utf8");

    const second = run(["--yes"]);
    expect(second.status, second.output).toBe(0);

    expect(readFileSync(join(repo, ".projects.local.md"))).toEqual(seedBefore);
    expect(readFileSync(join(repo, "projects", "my-project", "PROJECT.md"), "utf8")).toBe("mine\n");
    expect(git(["remote", "-v"]).stdout).toBe(remotesBefore);
    expect(readFileSync(localEnv(), "utf8")).toBe(envBefore);

    // Every step line is a done or a skip — nothing failed on the second pass.
    const steps = second.stdout.split("\n").filter((l) => /^[✓–✗]/u.test(l));
    expect(steps.length).toBeGreaterThan(5);
    expect(steps.filter((l) => l.startsWith("✗"))).toEqual([]);
  }, 60000);

  it("refuses node older than 22 before installing anything", () => {
    writeNodeStub("v20.19.0");
    clearCalls();

    const { status, stdout, output } = run(["--yes"]);

    expect(status).toBe(1);
    expect(output).toContain("22");
    expect(output.toLowerCase()).toMatch(/node/);
    // The report line carries a command, not a sentence: the "install Node.js"
    // part is an explanation and belongs on stderr.
    expect(failureCommands(stdout)).toEqual(["pnpm bootstrap"]);
    // Nothing was installed, built, seeded or linked.
    expect(countRecorded("pnpm -C")).toBe(0);
    expect(countRecordedTool("npm")).toBe(0);
    expect(countRecordedTool("pnpm")).toBe(0);
    expect(countRecorded("install:speech")).toBe(0);
    expect(existsSync(join(repo, ".projects.local.md"))).toBe(false);
  }, 60000);

  it("chooses corepack pnpm, then npm, and says which", () => {
    // No pnpm on PATH, but corepack — which ships with node — can provide one.
    rmSync(join(stubBin, "pnpm"));
    clearCalls();

    const viaCorepack = run(["--yes"]);
    expect(viaCorepack.status, viaCorepack.output).toBe(0);
    expect(viaCorepack.stdout).toMatch(/^✓ toolchain\b.*package manager: corepack pnpm$/m);
    expect(countRecorded(`corepack pnpm -C ${join(repo, "panel")} install`)).toBe(1);
    expect(countRecorded(`corepack pnpm -C ${join(repo, "panel")} run build`)).toBe(1);

    // Neither: the npm every node install brings with it.
    rmSync(join(stubBin, "corepack"));
    const second = join(sandbox, "repo-npm");
    makeRepo(second, CANONICAL_HTTPS);
    clearCalls();

    const viaNpm = run(["--yes"], { repoDir: second });
    expect(viaNpm.status, viaNpm.output).toBe(0);
    expect(viaNpm.stdout).toMatch(/^✓ toolchain\b.*package manager: npm$/m);
    expect(viaNpm.stdout).not.toMatch(/package manager: (corepack )?pnpm$/m);
    // npm spells both commands differently, and `install` is not a package script.
    expect(countRecorded(`npm --prefix ${join(second, "panel")} install`)).toBe(1);
    expect(countRecorded(`npm --prefix ${join(second, "panel")} run build`)).toBe(1);
  }, 60000);

  it("skips agents whose config directory is absent", () => {
    // Only Claude Code is installed in this sandbox home.
    mkdirSync(join(home, ".claude"), { recursive: true });

    const { status, stdout, output } = run(["--yes"]);
    expect(status, output).toBe(0);

    expect(stdout).toMatch(/^✓ skills \(claude-code\)$/m);
    expect(stdout).toMatch(/^– skills \(opencode\) skipped \(.*opencode.*\)$/m);
    expect(stdout).toMatch(/^– skills \(codex\) skipped \(.*\.codex.*\)$/m);

    expect(countRecorded("setup:claude-code")).toBe(1);
    expect(countRecorded("setup:opencode")).toBe(0);
    expect(countRecorded("setup:codex")).toBe(0);

    // The run continues past the skips.
    expect(stdout).toContain("Done. Start the panel: pnpm start");
  }, 60000);

  it("reports a failed tail step with the command to rerun and still exits 0", () => {
    writeExec(join(repo, "scripts", "install:speech"), [
      "#!/bin/sh",
      "# Stub install:speech: the hook installer refuses.",
      `printf '%s\\n' "install:speech $*" >> "${calls}"`,
      "echo 'could not write the hook' >&2",
      "exit 1",
    ]);

    const { status, stdout, output } = run(["--yes"]);

    // A tail step that failed is reported, not fatal.
    expect(status, output).toBe(0);
    expect(stdout).toMatch(/^✗ speech failed — run: bash scripts\/install:speech$/m);
    // The reason is not swallowed.
    expect(output).toContain("could not write the hook");
    // …and the steps after it still ran.
    expect(countRecorded("setup:shortcut")).toBe(1);
    expect(stdout).toContain("Done. Start the panel: pnpm start");
  }, 60000);

  it("renames a canonical origin to a push-disabled upstream", () => {
    const { status, stdout, output } = run(["--yes"]);
    expect(status, output).toBe(0);
    expect(stdout).toMatch(/^✓ remotes\b/m);

    expect(git(["remote", "get-url", "upstream"]).stdout.trim()).toBe(CANONICAL_HTTPS);
    expect(git(["remote", "get-url", "--push", "upstream"]).stdout.trim()).toBe("no_push");
    // With --yes there is no prompt, so no origin is left behind.
    expect(git(["remote", "get-url", "origin"]).status).not.toBe(0);

    // Without --yes the user is asked for a private remote, and answering with
    // one makes main track it — but only because the fetch actually succeeded.
    const privateBare = join(sandbox, "private.git");
    git(["init", "--bare", privateBare], sandbox);
    const other = join(sandbox, "repo-ssh");
    makeRepo(other, "git@github.com:gmotyl/pavilio");
    git(["push", privateBare, "main"], other);

    const prompted = run([], { repoDir: other, input: `${privateBare}\n` });
    expect(prompted.status, prompted.output).toBe(0);
    expect(prompted.output).toContain("Private repo URL for your notes (Enter to skip):");
    expect(git(["remote", "get-url", "upstream"], other).stdout.trim()).toBe(
      "git@github.com:gmotyl/pavilio",
    );
    expect(git(["remote", "get-url", "--push", "upstream"], other).stdout.trim()).toBe("no_push");
    expect(git(["remote", "get-url", "origin"], other).stdout.trim()).toBe(privateBare);
    expect(git(["rev-parse", "--abbrev-ref", "main@{upstream}"], other).stdout.trim()).toBe(
      "origin/main",
    );
  }, 60000);

  it("leaves a fork origin alone and adds upstream", () => {
    const fork = join(sandbox, "repo-fork");
    makeRepo(fork, "git@github.com:someone-else/pavilio.git");

    const { status, stdout, output } = run(["--yes"], { repoDir: fork });
    expect(status, output).toBe(0);
    expect(stdout).toMatch(/^✓ remotes\b/m);

    // The user's own remote is none of setup's business.
    expect(git(["remote", "get-url", "origin"], fork).stdout.trim()).toBe(
      "git@github.com:someone-else/pavilio.git",
    );
    expect(git(["remote", "get-url", "--push", "origin"], fork).stdout.trim()).toBe(
      "git@github.com:someone-else/pavilio.git",
    );
    // …but the canonical repo is reachable for updates.
    expect(git(["remote", "get-url", "upstream"], fork).stdout.trim()).toBe(CANONICAL_HTTPS);
  }, 60000);

  it("pins PAVILIO_NODE_BIN without disturbing other local env keys", () => {
    // A per-host file the user (or the Windows launcher) already owns, carrying
    // a stale pin at a directory that no longer exists.
    writeFileSync(
      localEnv(),
      ['PANEL_EXTRA_PORTS="3000"', `PAVILIO_NODE_BIN="${join(sandbox, "gone")}"`, 'PANEL_POST_LAUNCH_CMD="echo hi"', ""].join(
        "\n",
      ),
    );

    const { status, output } = run(["--yes"]);
    expect(status, output).toBe(0);

    const written = readFileSync(localEnv(), "utf8");
    const pins = written.split("\n").filter((l) => l.startsWith("PAVILIO_NODE_BIN="));
    expect(pins).toHaveLength(1);
    expect(pins[0]).toContain(stubBin);
    expect(pins[0]).not.toContain(join(sandbox, "gone"));
    // Every other key the file carried survived, values intact.
    expect(written).toContain('PANEL_EXTRA_PORTS="3000"');
    expect(written).toContain('PANEL_POST_LAUNCH_CMD="echo hi"');

    // And scripts/pm reads the pin back — the file is the contract between them.
    const readBack = spawnSync(
      BASH,
      ["-c", `. "${join(repo, "scripts", "pm")}" && pm_probe_pinned && command -v node`],
      { encoding: "utf8", env: { HOME: home, PATH: sysBin }, cwd: repo },
    );
    expect(readBack.stdout.trim()).toBe(join(stubBin, "node"));
  }, 60000);

  // -------------------------------------------------------------------------
  // remotes: the user's own remotes are never collateral damage
  // -------------------------------------------------------------------------

  it("leaves a pre-existing upstream the user owns completely alone", () => {
    // A team repo the user fetches *and pushes* to, under the name `upstream`,
    // with a push URL deliberately different from the fetch URL.
    const dir = join(sandbox, "repo-team");
    makeRepo(dir, "git@github.com:someone-else/pavilio.git");
    git(["remote", "add", "upstream", "https://github.com/acme/pavilio-team.git"], dir);
    git(["remote", "set-url", "--push", "upstream", "git@github.com:acme/pavilio-team.git"], dir);

    const { status, stdout, output } = run(["--yes"], { repoDir: dir });
    expect(status, output).toBe(0);
    expect(stdout).toMatch(/^[✓–] remotes\b/mu);

    // Both URLs survived: nothing here is setup's to rewrite.
    expect(git(["remote", "get-url", "upstream"], dir).stdout.trim()).toBe(
      "https://github.com/acme/pavilio-team.git",
    );
    expect(git(["remote", "get-url", "--push", "upstream"], dir).stdout.trim()).toBe(
      "git@github.com:acme/pavilio-team.git",
    );
    expect(git(["remote", "get-url", "origin"], dir).stdout.trim()).toBe(
      "git@github.com:someone-else/pavilio.git",
    );
  }, 60000);

  it("gives a repo with no remotes at all a canonical upstream on the first run", () => {
    // An unzipped archive, a `gh repo create` from a local directory, a user who
    // removed their remotes: `git init`'d, committed, no remotes.
    const bare = join(sandbox, "repo-no-remotes");
    makeRepo(bare);
    expect(git(["remote"], bare).stdout.trim()).toBe("");

    const { status, stdout, output } = run(["--yes"], { repoDir: bare });
    expect(status, output).toBe(0);
    expect(stdout).toMatch(/^✓ remotes\b/m);

    // One run is enough — scripts/update.sh refuses to pull without this.
    expect(git(["remote", "get-url", "upstream"], bare).stdout.trim()).toBe(CANONICAL_HTTPS);
    expect(git(["remote", "get-url", "--push", "upstream"], bare).stdout.trim()).toBe("no_push");
  }, 60000);

  it("recognises every spelling of the canonical repo", () => {
    const spellings = [
      "ssh://git@github.com/gmotyl/pavilio.git",
      "ssh://git@github.com/gmotyl/pavilio",
      "https://github.com/gmotyl/pavilio.git/",
      "https://github.com/GMotyl/Pavilio.git",
      "https://user:token@github.com/gmotyl/pavilio.git",
      "git@github.com:gmotyl/pavilio.git",
      "https://github.com/gmotyl/pavilio",
    ];
    spellings.forEach((url, i) => {
      const dir = join(sandbox, `repo-spelling-${i}`);
      makeRepo(dir, url);
      const { status, output } = run(["--yes"], { repoDir: dir });
      expect(status, `${url}: ${output}`).toBe(0);
      // Canonical ⇒ renamed out of the way, push disabled, origin freed.
      expect(git(["remote", "get-url", "upstream"], dir).stdout.trim(), url).toBe(url);
      expect(git(["remote", "get-url", "--push", "upstream"], dir).stdout.trim(), url).toBe("no_push");
      expect(git(["remote", "get-url", "origin"], dir).status, url).not.toBe(0);
    });
  }, 120000);

  it("does not mistake a repo that merely contains the canonical path for it", () => {
    // Widening the match until ssh:// and case variants pass must not widen it
    // into repositories that only *start* the same way.
    const notCanonical = [
      "https://github.com/gmotyl/pavilio-fork.git",
      "https://github.com/gmotyl/pavilio-notes",
      "git@github.com:gmotyl/pavilio-fork.git",
      "https://github.com/gmotyl-mirror/pavilio.git",
      "https://gitlab.com/gmotyl/pavilio.git",
    ];
    notCanonical.forEach((url, i) => {
      const dir = join(sandbox, `repo-notcanon-${i}`);
      makeRepo(dir, url);
      const { status, output } = run(["--yes"], { repoDir: dir });
      expect(status, `${url}: ${output}`).toBe(0);
      // The user's remote stays exactly where it was, under its own name…
      expect(git(["remote", "get-url", "origin"], dir).stdout.trim(), url).toBe(url);
      expect(git(["remote", "get-url", "--push", "origin"], dir).stdout.trim(), url).toBe(url);
      // …and the canonical repo arrives beside it.
      expect(git(["remote", "get-url", "upstream"], dir).stdout.trim(), url).toBe(CANONICAL_HTTPS);
    });
  }, 120000);

  it("reports a canonical origin next to an existing upstream as a skip with the fix", () => {
    const dir = join(sandbox, "repo-both");
    makeRepo(dir, CANONICAL_HTTPS);
    git(["remote", "add", "upstream", "git@github.com:someone-else/pavilio.git"], dir);

    const { status, stdout, output } = run(["--yes"], { repoDir: dir });
    expect(status, output).toBe(0);

    // Not a ✓: `git push` here targets a repo the user cannot write, the notes
    // prompt is unreachable, and no number of re-runs changes either.
    expect(stdout).not.toMatch(/^✓ remotes/m);
    const skip = stdout.split("\n").find((l) => l.startsWith("– remotes skipped ("));
    expect(skip, stdout).toBeTruthy();
    expect(skip).toContain("git remote remove upstream && pnpm bootstrap");

    // …and nothing was changed behind that skip.
    expect(git(["remote", "get-url", "origin"], dir).stdout.trim()).toBe(CANONICAL_HTTPS);
    expect(git(["remote", "get-url", "upstream"], dir).stdout.trim()).toBe(
      "git@github.com:someone-else/pavilio.git",
    );
    expect(git(["remote", "get-url", "--push", "upstream"], dir).stdout.trim()).toBe(
      "git@github.com:someone-else/pavilio.git",
    );
  }, 60000);

  it("adds a notes origin without letting git open a credential prompt", () => {
    // A stub `ssh`, so the fetch of a freshly added remote is observable without
    // leaving the sandbox. It fails, which is also the untested branch of the
    // prompt: origin recorded, tracking not set, and the run says so.
    writeExec(join(stubBin, "ssh"), [
      "#!/bin/sh",
      "# Stub ssh: record how git invoked us, then refuse.",
      `printf '%s\\n' "ssh $*" >> "${calls}"`,
      "exit 255",
    ]);

    const { status, stdout, output } = run([], { input: "ssh://git@example.invalid/notes.git\n" });
    expect(status, output).toBe(0);

    // BatchMode is what stops ssh asking for a passphrase mid-report.
    const sshCalls = recorded().filter((l) => l.startsWith("ssh "));
    expect(sshCalls.length, recorded().join("\n")).toBeGreaterThan(0);
    for (const call of sshCalls) expect(call).toContain("BatchMode=yes");

    expect(git(["remote", "get-url", "origin"]).stdout.trim()).toBe("ssh://git@example.invalid/notes.git");
    // Not anchored: the prompt itself has no newline, so the report line that
    // follows it shares a line with it.
    expect(stdout).toMatch(/✓ remotes\b.*origin added, but main still tracks upstream/);
    expect(stdout).toContain("git branch --set-upstream-to=origin/main main");
  }, 60000);

  // -------------------------------------------------------------------------
  // the fatal steps really are fatal
  // -------------------------------------------------------------------------

  it("stops the run when panel install fails, before any tail step", () => {
    writeExec(join(stubBin, "pnpm"), [
      "#!/bin/sh",
      "# Stub pnpm: everything works except `install`.",
      `printf '%s\\n' "pnpm $*" >> "${calls}"`,
      'case " $* " in *" install "*) echo "ERESOLVE exploded" >&2; exit 1 ;; esac',
      "exit 0",
    ]);

    const { status, stdout, output } = run(["--yes"]);

    expect(status, output).toBe(1);
    expect(stdout).toMatch(
      new RegExp(`^✗ panel install failed — run: pnpm -C ${escapeRe(join(repo, "panel"))} install$`, "m"),
    );
    expect(output).toContain("ERESOLVE exploded");
    // Nothing after it ran — a half-installed panel must not be seeded, linked
    // or declared done.
    expect(countRecorded("build")).toBe(0);
    for (const name of ["setup:claude-code", "setup:opencode", "setup:codex", "install:speech", "setup:shortcut"]) {
      expect(countRecorded(name), name).toBe(0);
    }
    expect(stdout).not.toContain("Done. Start the panel");
    for (const cmd of failureCommands(stdout)) expect(cmd).toMatch(RUNNABLE);
  }, 60000);

  it("stops the run when panel build fails, before any tail step", () => {
    writeExec(join(stubBin, "pnpm"), [
      "#!/bin/sh",
      "# Stub pnpm: the install works, the build does not.",
      `printf '%s\\n' "pnpm $*" >> "${calls}"`,
      'case " $* " in *" build "*) echo "tsc exploded" >&2; exit 1 ;; esac',
      "exit 0",
    ]);

    const { status, stdout, output } = run(["--yes"]);

    expect(status, output).toBe(1);
    expect(stdout).toMatch(
      new RegExp(`^✗ panel build failed — run: pnpm -C ${escapeRe(join(repo, "panel"))} build$`, "m"),
    );
    expect(stdout).toMatch(/^✓ panel install$/m);
    for (const name of ["setup:claude-code", "setup:opencode", "setup:codex", "install:speech", "setup:shortcut"]) {
      expect(countRecorded(name), name).toBe(0);
    }
    expect(stdout).not.toContain("Done. Start the panel");
  }, 60000);

  it("reports a non-writable node pin without a sentence where the command goes", () => {
    // pin_node_bin's only externals are the shell and `mv`; a `mv` that refuses
    // is the one way to reach its failure branch as root.
    writeExec(join(stubBin, "mv"), ["#!/bin/sh", "# Stub mv: refuse, so the pin cannot be swapped in.", "exit 1"]);

    const { status, stdout, output } = run(["--yes"]);

    // Not fatal — only the Windows launcher needs the pin.
    expect(status, output).toBe(0);
    const line = stdout.split("\n").find((l) => l.startsWith("✗ toolchain failed"));
    expect(line, stdout).toBeTruthy();
    for (const cmd of failureCommands(stdout)) expect(cmd).toMatch(RUNNABLE);
    expect(stdout).toContain("Done. Start the panel");
  }, 60000);

  // -------------------------------------------------------------------------
  // the report mechanics
  // -------------------------------------------------------------------------

  it("lifts a sub-script's own skip reason into the report", () => {
    // The commonest real-world outcome of setup:shortcut: not WSL, nothing to do.
    writeExec(join(repo, "scripts", "setup:shortcut"), [
      "#!/bin/sh",
      "# Stub setup:shortcut: the machine is not WSL.",
      `printf '%s\\n' "setup:shortcut $*" >> "${calls}"`,
      "echo 'skipped (not WSL)'",
      "exit 0",
    ]);

    const { status, stdout, output } = run(["--yes"]);
    expect(status, output).toBe(0);

    expect(stdout).toMatch(/^– shortcut skipped \(not WSL\)$/mu);
    expect(stdout).not.toMatch(/^✓ shortcut$/m);
    // The sub-script's own output is not echoed — one line per step.
    expect(stdout.split("\n").filter((l) => l.includes("not WSL"))).toHaveLength(1);
  }, 60000);

  it("closes stdin for every sub-script, so none of them can consume the run's input", () => {
    writeExec(join(repo, "scripts", "install:speech"), [
      "#!/bin/sh",
      "# Stub install:speech: report whether stdin had anything to give.",
      "if IFS= read -r line; then",
      `  printf '%s\\n' "install:speech stdin:$line" >> "${calls}"`,
      "else",
      `  printf '%s\\n' "install:speech stdin:none" >> "${calls}"`,
      "fi",
      "exit 0",
    ]);

    const { status, output } = run(["--yes"], { input: "SHOULD-NOT-REACH-A-SUBSCRIPT\n" });
    expect(status, output).toBe(0);

    expect(recorded()).toContain("install:speech stdin:none");
    expect(recorded().join("\n")).not.toContain("SHOULD-NOT-REACH-A-SUBSCRIPT");
  }, 60000);

  // -------------------------------------------------------------------------
  // flags
  // -------------------------------------------------------------------------

  it("honours --no-speech and --no-shortcut", () => {
    const noSpeech = run(["--yes", "--no-speech"]);
    expect(noSpeech.status, noSpeech.output).toBe(0);
    expect(noSpeech.stdout).toMatch(/^– speech skipped \(--no-speech\)$/mu);
    expect(countRecorded("install:speech")).toBe(0);
    expect(countRecorded("setup:shortcut")).toBe(1);

    const other = join(sandbox, "repo-no-shortcut");
    makeRepo(other, CANONICAL_HTTPS);
    clearCalls();

    const noShortcut = run(["--yes", "--no-shortcut"], { repoDir: other });
    expect(noShortcut.status, noShortcut.output).toBe(0);
    expect(noShortcut.stdout).toMatch(/^– shortcut skipped \(--no-shortcut\)$/mu);
    expect(countRecorded("setup:shortcut")).toBe(0);
    expect(countRecorded("install:speech")).toBe(1);
  }, 60000);

  it("prints usage for -h/--help and refuses an unknown option with exit 2", () => {
    for (const flag of ["-h", "--help"]) {
      clearCalls();
      const help = run([flag]);
      expect(help.status, help.output).toBe(0);
      expect(help.stdout).toContain("Usage: pnpm bootstrap");
      expect(help.stdout).toContain("--no-speech");
      expect(help.stdout).toContain("--no-shortcut");
      // Help does no work.
      expect(recorded()).toEqual([]);
      expect(existsSync(join(repo, ".projects.local.md"))).toBe(false);
    }

    clearCalls();
    const bogus = run(["--frobnicate"]);
    expect(bogus.status).toBe(2);
    expect(bogus.output).toContain("Unknown option: --frobnicate");
    expect(bogus.output).toContain("Usage: pnpm bootstrap");
    expect(recorded()).toEqual([]);
  }, 60000);

  // -------------------------------------------------------------------------
  // the toolchain pin
  // -------------------------------------------------------------------------

  it("pins node and names the right start command when corepack is the only manager", () => {
    // corepack, but no npm at all: pm_resolve cannot pick a manager here, and
    // the pin must still be written rather than left empty.
    rmSync(join(stubBin, "pnpm"));
    rmSync(join(stubBin, "npm"));
    clearCalls();

    const { status, stdout, output } = run(["--yes"]);
    expect(status, output).toBe(0);
    expect(stdout).toMatch(/^✓ toolchain\b.*package manager: corepack pnpm$/m);
    // pm's "node/pnpm not found" advice must not surface on a run that succeeds.
    expect(output).not.toContain("node/pnpm not found");

    const pins = readFileSync(localEnv(), "utf8")
      .split("\n")
      .filter((l) => l.startsWith("PAVILIO_NODE_BIN="));
    expect(pins).toEqual([`PAVILIO_NODE_BIN="${stubBin}"`]);

    // And the closing line names a command this host actually has.
    const lines = stdout.trimEnd().split("\n");
    expect(lines[lines.length - 1]).toBe(
      "Done. Start the panel: corepack pnpm start  →  http://localhost:3010",
    );
  }, 60000);

  it("names the npm start command when npm is the resolved manager", () => {
    rmSync(join(stubBin, "pnpm"));
    rmSync(join(stubBin, "corepack"));
    clearCalls();

    const { status, stdout, output } = run(["--yes"]);
    expect(status, output).toBe(0);
    const lines = stdout.trimEnd().split("\n");
    expect(lines[lines.length - 1]).toBe("Done. Start the panel: npm start  →  http://localhost:3010");
  }, 60000);

  it("escapes the pinned path, which scripts/pm eval's back", () => {
    // Legal on every POSIX filesystem, and every one of these characters means
    // something inside the double-quoted assignment pm reads.
    const weird = join(sandbox, 'n$o-"d"-`e`-x\\y');
    mkdirSync(weird, { recursive: true });
    writeExec(join(weird, "node"), [
      "#!/bin/sh",
      "# Stub node in an awkwardly named directory.",
      `printf '%s\\n' "node $*" >> "${calls}"`,
      'case "$1" in',
      "  --version|-v) printf '%s\\n' 'v24.4.0' ;;",
      "esac",
      "exit 0",
    ]);

    // PAVILIO_NODE_BIN is how pm_probe_pinned is told which interpreter to use,
    // so this is also how NODE_BIN_DIR comes to hold the awkward path.
    const { status, output } = run(["--yes"], { env: { PAVILIO_NODE_BIN: weird } });
    expect(status, output).toBe(0);

    const pins = readFileSync(localEnv(), "utf8")
      .split("\n")
      .filter((l) => l.startsWith("PAVILIO_NODE_BIN="));
    expect(pins).toHaveLength(1);

    // The only assertion that matters: pm reads back exactly what was written.
    const readBack = spawnSync(
      BASH,
      ["-c", `. "${join(repo, "scripts", "pm")}" && pm_probe_pinned && command -v node`],
      { encoding: "utf8", env: { HOME: home, PATH: sysBin }, cwd: repo },
    );
    expect(readBack.stdout.trim()).toBe(join(weird, "node"));
  }, 60000);
});
