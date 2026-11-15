import { describe, it, expect } from "vitest";
import { globSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

/**
 * Contract: no panel test writes a persistent git identity.
 *
 * Test fixtures get their committer identity from the environment the test
 * setup exports, or from a one-shot `-c user.name=…` flag. A fixture that runs
 * `git config user.name …` instead persists the key into whichever repo git
 * resolves; when that fixture runs inside a git hook, GIT_DIR points at the
 * real repo and the write lands in the developer's own config (the `seed`
 * identity leak). No behaviour test can reach a future misdirected fixture —
 * it only does damage outside the suite — so this static check walks every
 * test file instead. It is kept on the same ground as the tree-wide button
 * test-id check: the only thing that catches the next offender
 * (wiki/concepts/contract-test).
 *
 * The scan runs over whole files, so a spawn call split across lines is still
 * caught; the offender is reported at the line where the match starts.
 * Comment lines (`//`, `*`, `/*`) are skipped on purpose: prose explaining the
 * leak must not trip the check; only code can write a config key. A skipped
 * comment line also breaks a match, so no match can run through one.
 * A bare read without `--get` (`git config user.name`) is flagged too — it is
 * indistinguishable from a write here; write reads as `--get`.
 */
const PANEL = resolve(__dirname, "../..");
const SELF = relative(PANEL, __filename);

const Q = "['\"`]";
// Options/subcommand allowed between `config` and the key. Each is a write
// modifier (or `set`, the modern write subcommand); `--get*` is not listed, so
// reads stay allowed.
const WRITE_OPT = "--(?:local|global|worktree|replace-all|add)";
// "config", [<opts> | "--file", <x> | "set", …] "user.name|user.email"
// `\s` spans newlines, so a call split across lines matches as one.
const SPAWN_ARGS = new RegExp(
  `${Q}config${Q}\\s*,\\s*(?:${Q}(?:${WRITE_OPT}|set)${Q}\\s*,\\s*|${Q}--file${Q}\\s*,\\s*[^,\\u0000]+,\\s*)*${Q}user\\.(?:name|email)${Q}`,
  "g",
);
// git [<global opts: -C <dir>, -c <k=v>, --opt[=x]>] config [<opts> | --file <x> | set] user.name|user.email
// `-c user.name=…` with no `config` subcommand never matches: `config` is required.
const SHELL = new RegExp(
  `\\bgit\\s+(?:(?:-C|-c)\\s+\\S+\\s+|--[\\w-]+(?:=\\S+)?\\s+)*config\\s+(?:(?:${WRITE_OPT}|set|--file[\\s=]\\S+)\\s+)*user\\.(?:name|email)\\b`,
  "g",
);
const COMMENT = /^\s*(?:\/\/|\/?\*)/;
// Replaces a comment line: non-whitespace, so no `\s*` can bridge across it.
const BARRIER = "\u0000";

/** 1-based line numbers where a persistent identity write starts in `text`. */
function identityWriteLines(text: string): number[] {
  const code = text
    .split("\n")
    .map((line) => (COMMENT.test(line) ? BARRIER : line))
    .join("\n");
  const starts = new Set<number>();
  for (const re of [SPAWN_ARGS, SHELL]) {
    for (const m of code.matchAll(re)) starts.add(code.slice(0, m.index).split("\n").length);
  }
  return [...starts].sort((a, b) => a - b);
}

function persistentIdentityWrite(text: string): boolean {
  return identityWriteLines(text).length > 0;
}

function testFiles(): string[] {
  return globSync("**/*.test.{ts,tsx}", { cwd: PANEL, exclude: (f) => f === "node_modules" })
    .filter((f) => f !== SELF)
    .sort();
}

describe("fixture identity", () => {
  it("no test file writes a persistent git identity", () => {
    const files = testFiles();
    expect(files.length, "scan found too few test files — glob or cwd broke").toBeGreaterThan(100);
    expect(
      files.includes("server/lib/__tests__/trackedFiles.test.ts"),
      "scan found no test files — glob or cwd broke (trackedFiles.test.ts missing from the scan)",
    ).toBe(true);

    const offenders: string[] = [];
    for (const file of files) {
      for (const line of identityWriteLines(readFileSync(resolve(PANEL, file), "utf8"))) {
        offenders.push(`panel/${file}:${line}`);
      }
    }
    expect(offenders, "persistent git identity writes — use -c user.name=… or the env identity").toEqual([]);
  });

  it("the matcher flags spawn-args and shell forms of git config user.*", () => {
    const rows: Array<[label: string, text: string]> = [
      ["spawn args, double quotes", `git(dir, "config", "user.email", "x@test");`],
      ["spawn args, single quotes", `execFileSync("git", ['config', 'user.name', 'seed'], { cwd });`],
      ["spawn args, backticks", "run(`config`, `user.name`, `t`);"],
      ["spawn args, --local", `git(dir, "config", "--local", "user.name", "t");`],
      ["spawn args, --global", `git(dir, "config", "--global", "user.email", "t@t");`],
      ["spawn args, --file <x>", `git(dir, "config", "--file", cfg, "user.name", "t");`],
      ["spawn args, --worktree", `git(dir, "config", "--worktree", "user.name", "t");`],
      ["spawn args, --replace-all", `git(dir, "config", "--replace-all", "user.email", "t@t");`],
      ["spawn args, --add", `git(dir, "config", "--add", "user.name", "t");`],
      ["spawn args, config set", `git(dir, "config", "set", "user.email", "t@t");`],
      ["spawn args, config set --local", `git(dir, "config", "set", "--local", "user.name", "t");`],
      ["spawn args, multi-line", `git(dir,\n  "config",\n  "user.email", "x");`],
      ["spawn args, multi-line array", `execFileSync("git", [\n  "config",\n  "--local",\n  "user.name",\n  "t",\n]);`],
      ["shell form", `sh("git config user.name seed");`],
      ["shell form, email", "execSync(`git config user.email t@t`, { cwd });"],
      ["shell form, --local", `sh("git config --local user.email t@t");`],
      ["shell form, --global", `sh("git config --global user.name t");`],
      ["shell form, --worktree", `sh("git config --worktree user.name t");`],
      ["shell form, --replace-all", `sh("git config --replace-all user.email t@t");`],
      ["shell form, --add", `sh("git config --add user.name t");`],
      ["shell form, config set", `sh("git config set user.name t");`],
      ["shell form, config set --global", `sh("git config set --global user.email t@t");`],
      ["shell form, -C dir", `sh(\`git -C \${dir} config user.name t\`);`],
      ["shell form, --git-dir=x", `sh("git --git-dir=x config user.email t@t");`],
      ["shell form, -c a=b before config", `sh("git -c a=b config user.name t");`],
      ["shell form, multi-line", "execSync(`git\n  config\n  user.name t`);"],
      ["bare read without --get", `sh("git config user.name");`],
    ];
    for (const [label, text] of rows) expect(persistentIdentityWrite(text), label).toBe(true);

    // A multi-line write is reported at the line where the match starts.
    expect(identityWriteLines(`a();\nb();\ngit(dir,\n  "config",\n  "user.name", "t");\n`), "match start line").toEqual([4]);
  });

  it("the matcher allows -c identity and --get reads", () => {
    const rows: Array<[label: string, text: string]> = [
      ["spawn args -c", `execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args]);`],
      ["shell -c", `sh("git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init");`],
      ["spawn args --get", `git(dir, "config", "--get", "user.name");`],
      ["spawn args --get-regexp", `git(dir, "config", "--get-regexp", "user.email");`],
      ["spawn args multi-line --get", `git(dir,\n  "config",\n  "--get",\n  "user.name");`],
      ["shell --get", `sh("git config --get user.email");`],
      ["shell --get-regexp", `sh("git config --get-regexp '^user\\\\.'");`],
      ["other config key", `git(dir, "config", "core.autocrlf", "false");`],
      ["line comment prose", `// A fixture that ran git config user.name seed wrote into the parent repo`],
      ["block comment prose", ` * the old fixture called "config", "user.email" on the hook repo`],
      ["block comment opener", `/* git config user.name was the leak */`],
      ["comment line inside a would-be match", `git(dir, "config",\n  // "user.name" was here\n  "core.autocrlf", "false");`],
      ["comment line bridging config and key", `const a = ["config",\n// note\n"user.name"];`],
    ];
    for (const [label, text] of rows) expect(persistentIdentityWrite(text), label).toBe(false);
  });

});
