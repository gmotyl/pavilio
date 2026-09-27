import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * scripts/setup:codex derives the skills/ source from its own location, so every
 * case here runs a *copy* of it out of <sandbox>/repo/scripts/ next to a
 * sandbox skills/ tree. Every link it writes then points into the sandbox, never
 * into the developer's own checkout.
 *
 * CRITICAL: this suite runs on a machine that has a real ~/.codex full of real
 * skill symlinks. Every run therefore gets an environment built from scratch (no
 * process.env) with both HOME and CODEX_HOME inside the sandbox, and `run()`
 * refuses to spawn anything whose CODEX_HOME is not under the sandbox — so a
 * future edit cannot quietly point this suite at the real config.
 *
 * PATH is private too: it holds only the coreutils directory the script needs
 * (ln/rm/mkdir/readlink), so no `codex` binary from the host is discoverable and
 * the "is codex installed" decision is made purely from CODEX_HOME.
 */

const SETUP_CODEX = resolve(__dirname, "../../../scripts/setup:codex");

// Absolute, because the script runs on a PATH that could not resolve `bash`.
const BASH =
  spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim() || "/bin/bash";

// Where ln/rm/mkdir/readlink live on this host — the only directory on the PATH
// the script is given.
const COREUTILS_DIR = dirname(
  spawnSync("sh", ["-c", "command -v ln"], { encoding: "utf8" }).stdout.trim() || "/bin/ln",
);

let sandbox: string;
let repo: string;
let home: string;
let codexHome: string;
let codexSkills: string;

/** A skills/<name>/ directory with the SKILL.md that makes it installable. */
function writeSkill(root: string, name: string, body = `# ${name}\n`) {
  mkdirSync(join(root, "skills", name), { recursive: true });
  writeFileSync(join(root, "skills", name, "SKILL.md"), body);
}

function run(args: string[] = [], extraEnv: Record<string, string> = {}) {
  const env = { HOME: home, CODEX_HOME: codexHome, PATH: COREUTILS_DIR, ...extraEnv };
  // Guard rail: never let a run escape the sandbox and touch the real ~/.codex.
  const effective = env.CODEX_HOME || join(env.HOME, ".codex");
  if (!effective.startsWith(sandbox)) {
    throw new Error(`refusing to run setup:codex outside the sandbox: ${effective}`);
  }
  const res = spawnSync(BASH, [join(repo, "scripts", "setup:codex"), ...args], {
    encoding: "utf8",
    env,
  });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "setup-codex-"));
  repo = join(sandbox, "repo");
  home = join(sandbox, "home");
  codexHome = join(home, ".codex");
  codexSkills = join(codexHome, "skills");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(home, { recursive: true });
  copyFileSync(SETUP_CODEX, join(repo, "scripts", "setup:codex"));
  writeSkill(repo, "pavilio-note");
  writeSkill(repo, "pavilio-grill");
  // A directory without SKILL.md is not a skill and must never be linked.
  mkdirSync(join(repo, "skills", "not-a-skill"), { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("scripts/setup:codex", () => {
  it("links every skill into CODEX_HOME/skills idempotently", () => {
    mkdirSync(codexHome, { recursive: true });

    const first = run();
    expect(first.status).toBe(0);

    for (const name of ["pavilio-note", "pavilio-grill"]) {
      const link = join(codexSkills, name);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link)).toBe(join(repo, "skills", name));
      // Bundled resources stay reachable through the link.
      expect(existsSync(join(link, "SKILL.md"))).toBe(true);
    }
    // A directory with no SKILL.md is not installed.
    expect(existsSync(join(codexSkills, "not-a-skill"))).toBe(false);

    // Re-running changes nothing: same targets, nothing installed a second time.
    const second = run();
    expect(second.status).toBe(0);
    for (const name of ["pavilio-note", "pavilio-grill"]) {
      expect(readlinkSync(join(codexSkills, name))).toBe(join(repo, "skills", name));
    }
    expect(second.output).toContain("0 installed");
  }, 30000);

  it("leaves foreign links alone unless --force", () => {
    // A link planted by another checkout of the same repo.
    const otherRepo = join(sandbox, "other-checkout");
    writeSkill(otherRepo, "pavilio-note");
    mkdirSync(codexSkills, { recursive: true });
    const foreign = join(otherRepo, "skills", "pavilio-note");
    symlinkSync(foreign, join(codexSkills, "pavilio-note"));

    const kept = run();
    expect(kept.status).toBe(0);
    expect(readlinkSync(join(codexSkills, "pavilio-note"))).toBe(foreign);
    // …and the user is told, with the path it actually points at.
    expect(kept.output).toContain("pavilio-note");
    expect(kept.output).toContain(foreign);
    expect(kept.output).toContain("--force");
    // The skill that had no conflicting entry is still linked.
    expect(readlinkSync(join(codexSkills, "pavilio-grill"))).toBe(
      join(repo, "skills", "pavilio-grill"),
    );

    // A conflict is not the same outcome as an already-correct link, and the
    // summary has to say so — otherwise the last line reads "N left as-is" and
    // --force is undiscoverable from it.
    expect(kept.output).toContain("1 conflicting");
    expect(kept.output).toMatch(/point somewhere else/);
    expect(kept.output).toMatch(/setup:codex --force/);

    const forced = run(["--force"]);
    expect(forced.status).toBe(0);
    expect(readlinkSync(join(codexSkills, "pavilio-note"))).toBe(
      join(repo, "skills", "pavilio-note"),
    );
    // --force unlinks the entry; it must never follow it and delete the other
    // checkout it pointed at.
    expect(statSync(foreign).isDirectory()).toBe(true);
    expect(readFileSync(join(foreign, "SKILL.md"), "utf8")).toContain("pavilio-note");
    expect(forced.output).toContain("0 conflicting");
  }, 30000);

  it("replaces a real directory only with --force, and keeps its contents out of the repo", () => {
    mkdirSync(codexSkills, { recursive: true });
    // Somebody copied a skill in by hand instead of linking it.
    const planted = join(codexSkills, "pavilio-note");
    mkdirSync(planted, { recursive: true });
    writeFileSync(join(planted, "SKILL.md"), "# hand-copied\n");
    writeFileSync(join(planted, "notes.md"), "keep me\n");

    const kept = run();
    expect(kept.status).toBe(0);
    // Untouched without --force, and reported as what it actually is.
    expect(lstatSync(planted).isDirectory()).toBe(true);
    expect(readFileSync(join(planted, "SKILL.md"), "utf8")).toContain("hand-copied");
    expect(kept.output).toContain("existing directory");
    expect(kept.output).toContain("1 conflicting");

    // rm -rf is the most dangerous statement in this script: it must remove the
    // planted directory and put our link in its place, nothing wider.
    const forced = run(["--force"]);
    expect(forced.status).toBe(0);
    expect(lstatSync(planted).isSymbolicLink()).toBe(true);
    expect(readlinkSync(planted)).toBe(join(repo, "skills", "pavilio-note"));
    expect(forced.output).toContain("was a real directory");
    // The repo's own skill survived intact — the link is not a loop onto itself.
    expect(readFileSync(join(repo, "skills", "pavilio-note", "SKILL.md"), "utf8")).toContain(
      "pavilio-note",
    );
    expect(existsSync(join(planted, "notes.md"))).toBe(false);
  }, 30000);

  it("says so and exits non-zero when CODEX_HOME/skills cannot be created", () => {
    mkdirSync(codexHome, { recursive: true });
    // `skills` occupied by a regular file: mkdir -p fails, and so would every
    // `ln -s` after it. Unchecked, the script printed "[link] <name>" per skill,
    // reported "2 installed" and exited 0 having installed nothing.
    writeFileSync(codexSkills, "not a directory\n");

    const { status, output } = run();

    expect(status).not.toBe(0);
    expect(status).toBeGreaterThan(0);
    expect(output).not.toMatch(/\[link\]/);
    expect(output).not.toMatch(/\d+ installed/);
    expect(output).toContain(codexSkills);
    // And the file is still a file: nothing was silently clobbered.
    expect(statSync(codexSkills).isFile()).toBe(true);
  }, 30000);

  it("says so and exits non-zero when a link cannot be written", () => {
    mkdirSync(codexSkills, { recursive: true });
    // mkdir -p succeeds (the directory is already there) but linking does not.
    // Simulated by shadowing `ln` rather than by permissions: this suite may run
    // as root, for whom a read-only directory is no obstacle at all.
    const stubBin = join(sandbox, "bin");
    mkdirSync(stubBin, { recursive: true });
    writeFileSync(
      join(stubBin, "ln"),
      ["#!/bin/sh", "# Stub ln: the link cannot be written.", "echo 'ln: cannot create link' >&2", "exit 1", ""].join(
        "\n",
      ),
      { mode: 0o755 },
    );

    const { status, output } = run([], { PATH: `${stubBin}:${COREUTILS_DIR}` });

    expect(status).toBeGreaterThan(0);
    expect(output).not.toMatch(/\d+ installed/);
    expect(output).toContain("Could not link");
    expect(existsSync(join(codexSkills, "pavilio-note"))).toBe(false);
  }, 30000);

  it("skips when codex is not installed", () => {
    // CODEX_HOME never created: a machine without codex.
    const explicit = run();
    expect(explicit.status).toBe(0);
    expect(explicit.output).toContain("skipped (codex not installed)");
    expect(existsSync(codexHome)).toBe(false);

    // Same verdict when CODEX_HOME is unset and the default ~/.codex is absent.
    const res = spawnSync(BASH, [join(repo, "scripts", "setup:codex")], {
      encoding: "utf8",
      env: { HOME: home, PATH: COREUTILS_DIR },
    });
    expect(res.status).toBe(0);
    expect(`${res.stdout}${res.stderr}`).toContain("skipped (codex not installed)");
    expect(existsSync(join(home, ".codex"))).toBe(false);
  }, 30000);

  it("prunes links that pointed into this repo for skills that no longer exist", () => {
    mkdirSync(codexSkills, { recursive: true });
    // Left behind when a skill was renamed or deleted upstream.
    const ours = join(codexSkills, "pavilio-gone");
    symlinkSync(join(repo, "skills", "pavilio-gone"), ours);
    // A dangling link owned by somebody else is not ours to clean up.
    const theirs = join(codexSkills, "their-gone");
    symlinkSync(join(sandbox, "elsewhere", "skills", "their-gone"), theirs);

    const { status, output } = run();
    expect(status).toBe(0);

    expect(existsSync(ours)).toBe(false);
    expect(lstatSync(ours, { throwIfNoEntry: false })).toBeUndefined();
    expect(output).toContain("pavilio-gone");
    expect(output).toContain("1 pruned");

    // Untouched, still dangling.
    expect(lstatSync(theirs).isSymbolicLink()).toBe(true);
    expect(readlinkSync(theirs)).toBe(join(sandbox, "elsewhere", "skills", "their-gone"));
  }, 30000);
});
