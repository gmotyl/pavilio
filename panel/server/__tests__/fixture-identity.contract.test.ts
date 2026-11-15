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
 * Comment lines (`//`, `*`, `/*`) are skipped on purpose: prose explaining the
 * leak must not trip the check; only code can write a config key.
 */
const PANEL = resolve(__dirname, "../..");
const SELF = relative(PANEL, __filename);

const Q = "['\"`]";
// "config", ["--local" | "--global" | "--file", <x>,] "user.name|user.email"
const SPAWN_ARGS = new RegExp(
  `${Q}config${Q}\\s*,\\s*(?:${Q}--(?:local|global)${Q}\\s*,\\s*|${Q}--file${Q}\\s*,\\s*[^,]+,\\s*)?${Q}user\\.(?:name|email)${Q}`,
);
// git [-C <dir>] config [--local | --global | --file <x>] user.name|user.email
const SHELL = /\bgit\s+(?:-C\s+\S+\s+)?config\s+(?:--(?:local|global)\s+|--file[\s=]\S+\s+)?user\.(?:name|email)\b/;
const COMMENT = /^\s*(?:\/\/|\/?\*)/;

function persistentIdentityWrite(line: string): boolean {
  if (COMMENT.test(line)) return false;
  return SPAWN_ARGS.test(line) || SHELL.test(line);
}

function testFiles(): string[] {
  return globSync("**/*.test.{ts,tsx}", { cwd: PANEL, exclude: (f) => f === "node_modules" })
    .filter((f) => f !== SELF)
    .sort();
}

describe("fixture identity", () => {
  it("no test file writes a persistent git identity", () => {
    const files = testFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("server/lib/__tests__/trackedFiles.test.ts");

    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(resolve(PANEL, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (persistentIdentityWrite(line)) offenders.push(`panel/${file}:${i + 1}`);
        });
    }
    expect(offenders, "persistent git identity writes — use -c user.name=… or the env identity").toEqual([]);
  });

  it("the matcher flags spawn-args and shell forms of git config user.*", () => {
    const rows: Array<[label: string, line: string]> = [
      ["spawn args, double quotes", `git(dir, "config", "user.email", "x@test");`],
      ["spawn args, single quotes", `execFileSync("git", ['config', 'user.name', 'seed'], { cwd });`],
      ["spawn args, backticks", "run(`config`, `user.name`, `t`);"],
      ["spawn args, --local", `git(dir, "config", "--local", "user.name", "t");`],
      ["spawn args, --global", `git(dir, "config", "--global", "user.email", "t@t");`],
      ["spawn args, --file <x>", `git(dir, "config", "--file", cfg, "user.name", "t");`],
      ["shell form", `sh("git config user.name seed");`],
      ["shell form, email", "execSync(`git config user.email t@t`, { cwd });"],
      ["shell form, --local", `sh("git config --local user.email t@t");`],
      ["shell form, --global", `sh("git config --global user.name t");`],
      ["shell form, -C dir", `sh(\`git -C \${dir} config user.name t\`);`],
    ];
    for (const [label, line] of rows) expect(persistentIdentityWrite(line), label).toBe(true);
  });

  it("the matcher allows -c identity and --get reads", () => {
    const rows: Array<[label: string, line: string]> = [
      ["spawn args -c", `execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args]);`],
      ["shell -c", `sh("git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init");`],
      ["spawn args --get", `git(dir, "config", "--get", "user.name");`],
      ["spawn args --get-regexp", `git(dir, "config", "--get-regexp", "user.email");`],
      ["shell --get", `sh("git config --get user.email");`],
      ["shell --get-regexp", `sh("git config --get-regexp '^user\\\\.'");`],
      ["other config key", `git(dir, "config", "core.autocrlf", "false");`],
      ["line comment prose", `// A fixture that ran git config user.name seed wrote into the parent repo`],
      ["block comment prose", ` * the old fixture called "config", "user.email" on the hook repo`],
      ["block comment opener", `/* git config user.name was the leak */`],
    ];
    for (const [label, line] of rows) expect(persistentIdentityWrite(line), label).toBe(false);
  });
});
