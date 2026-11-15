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
// Any option may sit between `config` (or `config set`) and the key; a fixed
// list of write modifiers missed `--system`, `--file=<x>`, `--value=<x>`, ….
// Instead the read/removal flags are excluded: a sequence containing one of
// them is a read or an unset, never a write. The subcommand forms `config get`,
// `config list`, `config unset` never match, since only `set` is accepted there.
const READ = "(?:--get(?:-all|-regexp|-urlmatch)?|-l|--list|--unset(?:-all)?|--remove-section|--rename-section)(?![\\w-])";
// Options that take their value as the next argument (`--file <x>`).
const VALUE_OPT = "(?:--file|-f|--blob|--type|--value|--comment)";
// One option token, `--opt` or `--opt=value`, that is not a read/removal flag.
const OPT = `(?!${READ})-`;
// "config", ["set",] [<"--opt[=x]"> | <"--file", x>]* "user.name|user.email"
// `\s` spans newlines, so a call split across lines matches as one; a value
// never crosses a comma or a comment barrier.
const SPAWN_ARGS = new RegExp(
  `${Q}config${Q}\\s*,\\s*(?:${Q}set${Q}\\s*,\\s*)?` +
    `(?:(?:${Q}${VALUE_OPT}${Q}\\s*,\\s*[^,\\u0000]+|${Q}${OPT}[^'"\`,\\n\\u0000]*${Q})\\s*,\\s*)*` +
    `${Q}user\\.(?:name|email)${Q}`,
  "g",
);
// git [<global opts: -C <dir>, -c <k=v>, --opt[=x]>] config [set] [--opt[=x] | --file <x>]* user.name|user.email
// `-c user.name=…` with no `config` subcommand never matches: `config` is required.
const SHELL = new RegExp(
  `\\bgit\\s+(?:(?:-C|-c)\\s+\\S+\\s+|--[\\w-]+(?:=\\S+)?\\s+)*config\\s+(?:set\\s+)?` +
    `(?:(?:${VALUE_OPT}\\s+[^\\s\\u0000]+|${OPT}[^\\s\\u0000]*)\\s+)*user\\.(?:name|email)\\b`,
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
      ["spawn args, config set --value=old", `git(dir, "config", "set", "--value=old", "user.name", "new");`],
      ["shell form, config set --value=old", `sh("git config set --value=old user.name new");`],
      ["spawn args, --file=<x> as one arg", `git(dir, "config", "--file=/tmp/x", "user.email", "x");`],
      ["shell form, --file=<x>", `sh("git config --file=/tmp/x user.email x");`],
      ["spawn args, --system", `git(dir, "config", "--system", "user.name", "t");`],
      ["shell form, --system", `sh("git config --system user.name t");`],
      ["spawn args, --type=string before the key", `git(dir, "config", "--type=string", "user.name", "t");`],
      ["shell form, --type=string before the key", `sh("git config --type=string user.email t@t");`],
      ["shell form, -f <file>", `sh("git config -f cfg user.name t");`],
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
      ["spawn args config get", `git(dir, "config", "get", "user.name");`],
      ["shell config get", `sh("git config get user.name");`],
      ["spawn args --unset", `git(dir, "config", "--unset", "user.name");`],
      ["shell --unset", `sh("git config --unset user.name");`],
      ["spawn args config unset", `git(dir, "config", "unset", "user.email");`],
      ["shell config unset", `sh("git config unset user.email");`],
      ["spawn args --get-all", `git(dir, "config", "--get-all", "user.name");`],
      ["shell --get-all", `sh("git config --get-all user.name");`],
      ["spawn args --list", `git(dir, "config", "--list", "user.name");`],
      ["shell --list", `sh("git config --list user.name");`],
      ["shell -f <file> --get", `sh("git config -f cfg --get user.name");`],
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
