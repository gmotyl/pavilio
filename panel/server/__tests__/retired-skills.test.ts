import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * A skill that is renamed or removed upstream leaves generated artifacts behind, because the
 * setup scripts only ever add: `.claude/commands/<name>.md`, the `~/.claude/skills/<name>` link,
 * `.opencode/commands/<name>.md` and its `opencode.json` entry. `skills/RETIRED` lists those
 * names and both setup scripts remove exactly them.
 *
 * Every run uses copies of the scripts in a mkdtemp repo, with HOME inside the sandbox and an
 * environment built from literals, so the developer's real ~/.claude and ~/.config are never
 * reachable.
 */

const SCRIPTS = resolve(__dirname, "../../../scripts");

let sandbox = "";
let repo = "";
let home = "";
let stubBin = "";

function write(abs: string, text: string) {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

function run(script: string) {
  const res = spawnSync("bash", [join(repo, "scripts", script)], {
    cwd: repo,
    encoding: "utf8",
    env: { HOME: home, PATH: `${stubBin}:/usr/local/bin:/usr/bin:/bin` },
  });
  expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);
}

const isLink = (p: string) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "retired-skills-"));
  repo = join(sandbox, "repo");
  home = join(sandbox, "home");
  stubBin = join(sandbox, "stub-bin");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(stubBin, { recursive: true });
  // setup:claude-code only checks that a `claude` binary exists.
  writeFileSync(join(stubBin, "claude"), "#!/bin/bash\n", { mode: 0o755 });
  for (const s of ["setup:claude-code", "setup:opencode"]) copyFileSync(join(SCRIPTS, s), join(repo, "scripts", s));

  write(join(repo, "skills/alive/SKILL.md"), "---\nname: alive\ndescription: still here\n---\n# alive\n");
  write(
    join(repo, "skills/RETIRED"),
    ["# Skills renamed or removed upstream.", "pavilio-bootstrap", "", "../escape", "kept-real-dir", ""].join("\n"),
  );
});

afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

describe("retired skills", () => {
  it("setup:claude-code removes the retired command and skill link, nothing else", () => {
    write(join(repo, ".claude/commands/pavilio-bootstrap.md"), "old\n");
    write(join(repo, ".claude/commands/my-own.md"), "mine\n");
    write(join(repo, ".claude/escape.md"), "outside commands\n");
    const skills = join(home, ".claude/skills");
    mkdirSync(skills, { recursive: true });
    symlinkSync(join(repo, "skills/pavilio-bootstrap"), join(skills, "pavilio-bootstrap"));
    write(join(skills, "kept-real-dir/SKILL.md"), "a real dir, not a link\n");

    run("setup:claude-code");

    expect(existsSync(join(repo, ".claude/commands/pavilio-bootstrap.md"))).toBe(false);
    expect(isLink(join(skills, "pavilio-bootstrap"))).toBe(false);
    expect(existsSync(join(skills, "kept-real-dir/SKILL.md"))).toBe(true);
    expect(readFileSync(join(repo, ".claude/commands/my-own.md"), "utf8")).toBe("mine\n");
    expect(existsSync(join(repo, ".claude/escape.md"))).toBe(true);
    expect(existsSync(join(repo, ".claude/commands/alive.md"))).toBe(true);
    expect(isLink(join(skills, "alive"))).toBe(true);
  });

  it("setup:opencode removes the retired wrapper, its opencode.json entry and the global copy", () => {
    write(join(repo, ".opencode/commands/pavilio-bootstrap.md"), "old\n");
    write(
      join(repo, "opencode.json"),
      JSON.stringify({ command: { "pavilio-bootstrap": { template: "old" } }, permission: { x: 1 } }),
    );
    write(join(home, ".config/opencode/commands/pavilio-bootstrap.md"), "old\n");
    write(join(home, ".config/opencode/commands/global-own.md"), "mine\n");

    run("setup:opencode");

    expect(existsSync(join(repo, ".opencode/commands/pavilio-bootstrap.md"))).toBe(false);
    const cfg = JSON.parse(readFileSync(join(repo, "opencode.json"), "utf8"));
    expect(Object.keys(cfg.command)).toEqual(["alive"]);
    expect(cfg.permission).toEqual({ x: 1 });
    expect(existsSync(join(home, ".config/opencode/commands/pavilio-bootstrap.md"))).toBe(false);
    expect(existsSync(join(home, ".config/opencode/commands/global-own.md"))).toBe(true);
  });

  it("a retired name that is a live skill again is left alone", () => {
    write(join(repo, "skills/pavilio-bootstrap/SKILL.md"), "---\nname: pavilio-bootstrap\n---\n# back\n");

    run("setup:claude-code");

    expect(existsSync(join(repo, ".claude/commands/pavilio-bootstrap.md"))).toBe(true);
    expect(isLink(join(home, ".claude/skills/pavilio-bootstrap"))).toBe(true);
  });
});
