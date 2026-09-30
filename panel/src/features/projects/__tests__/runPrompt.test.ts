import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  composeRunLine,
  resolveObjective,
  runLineParts,
  takesPrompt,
  taskRunLine,
} from "../runPrompt";

const VARS = {
  change: "2026-09-28-commands-in-context",
  path: "projects/pavilio/plans/openspec/changes/2026-09-28-commands-in-context/tasks.md",
  project: "pavilio",
};

describe("resolveObjective", () => {
  it("substitutes change, path and project", () => {
    expect(resolveObjective("Run {change} of {project} from {path}", VARS)).toBe(
      "Run 2026-09-28-commands-in-context of pavilio from " +
        "projects/pavilio/plans/openspec/changes/2026-09-28-commands-in-context/tasks.md",
    );
  });

  it("substitutes every occurrence, not only the first", () => {
    expect(resolveObjective("{project}/{project}", VARS)).toBe("pavilio/pavilio");
  });

  it("leaves an unknown placeholder alone", () => {
    expect(resolveObjective("{change} {prompt} {nope}", VARS)).toBe(
      "2026-09-28-commands-in-context {prompt} {nope}",
    );
  });

  it("does not read `$` in a value as a replacement pattern", () => {
    // `String.replace` with a string replacement expands `$&`, `$1`, `$$`.
    expect(resolveObjective("in {path}", { ...VARS, path: "a/$&/$1/$$" })).toBe("in a/$&/$1/$$");
  });
});

const NASTY = [
  "don't stop",
  'say "hi"',
  "$HOME and ${HOME}",
  "`id` and $(id)",
  "ship it! !! !$ !-1",
  "a\tb",
  "one\ntwo\r\nthree",
  "back\\slash \\' \\\"",
  "all of it: ' \" $HOME ` ! \t \n done",
];

/** What the shell hands the CLI: the start prompt with control characters as spaces. */
function expectedPrompt(runLoop: string, objective: string): string {
  return runLoop.split("{prompt}").join(objective).replace(/\r\n|[\u0000-\u001f\u007f]/g, " ");
}

/**
 * The line typed into an interactive shell whose `cli` is a stub printing its
 * argument count and arguments NUL-separated between two markers. Returns
 * what the stub received, or null when the shell is not installed.
 */
function roundTrip(shell: string, args: string[], line: string): string[] | null {
  const script =
    `cli() { printf '<<<'; printf '%s\\0' "$#" "$@"; printf '>>>'; }\n` + `${line}\n` + "exit\n";
  const run = spawnSync(shell, args, {
    input: script,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmpdir(), TERM: "dumb" },
    timeout: 10_000,
  });
  if (run.error && (run.error as NodeJS.ErrnoException).code === "ENOENT") return null;
  const match = /<<<([\s\S]*?)>>>/.exec(run.stdout ?? "");
  if (!match) throw new Error(`${shell} printed no stub output: ${run.stdout} ${run.stderr}`);
  const [count, ...argv] = match[1].split("\0").slice(0, -1);
  expect(Number(count)).toBe(argv.length);
  return argv;
}

describe("composeRunLine", () => {
  it("a positional start prompt follows the command", () => {
    expect(composeRunLine("codex --no-daemon", "", "/goal {prompt}", "do it")).toBe(
      "codex --no-daemon '/goal do it'",
    );
  });

  it("a flagged start prompt follows its flag", () => {
    expect(composeRunLine("opencode", "--prompt", "{prompt}", "do it")).toBe(
      "opencode --prompt 'do it'",
    );
  });

  it("a run loop without {prompt} is still one quoted argument", () => {
    expect(composeRunLine("claude", "", "/continue", "ignored")).toBe("claude '/continue'");
    expect(composeRunLine("opencode", "--prompt", "keep going", "ignored")).toBe(
      "opencode --prompt 'keep going'",
    );
  });

  it("fills every {prompt} and quotes the run loop's own text too", () => {
    expect(composeRunLine("tool", "", "{prompt} -- it's {prompt}", "go")).toBe(
      "tool 'go -- it'\\''s go'",
    );
  });

  it("escapes a single quote and folds control characters", () => {
    expect(composeRunLine("claude", "", "/goal {prompt}", "don't\n$HOME\tx")).toBe(
      "claude '/goal don'\\''t $HOME x'",
    );
  });

  it("nasty objectives arrive as one literal argument in bash and zsh", () => {
    const shells: [string, string[]][] = [
      ["bash", ["--norc", "-i"]],
      ["zsh", ["-f", "-i"]],
    ];
    let ran = 0;
    for (const [shell, args] of shells) {
      for (const flag of ["", "--prompt"]) {
        for (const objective of NASTY) {
          const runLoop = "/goal {prompt}";
          const argv = roundTrip(shell, args, composeRunLine("cli", flag, runLoop, objective));
          if (argv === null) continue;
          ran += 1;
          const prompt = expectedPrompt(runLoop, objective);
          expect(argv, `${shell} ${JSON.stringify(objective)}`).toEqual(
            flag ? [flag, prompt] : [prompt],
          );
        }
      }
    }
    if (ran === 0) console.warn("neither bash nor zsh is installed; round trip skipped");
  });
});

describe("runLineParts", () => {
  it("the drawn wrapper matches the composed line", () => {
    const cases: [string, string, string][] = [
      ["codex --no-daemon", "", "/goal {prompt}"],
      ["opencode", "--prompt", "{prompt}"],
      ["claude", "", "it's /goal {prompt} now"],
    ];
    for (const [command, flag, runLoop] of cases) {
      const { before, after } = runLineParts(command, flag, runLoop);
      expect(before + "my objective" + after).toBe(
        composeRunLine(command, flag, runLoop, "my objective"),
      );
    }
    expect(runLineParts("codex --no-daemon", "", "/goal {prompt}")).toEqual({
      before: "codex --no-daemon '/goal ",
      after: "'",
    });
  });

  it("puts a run loop without a placeholder wholly before the objective", () => {
    const parts = runLineParts("claude", "", "/continue");
    expect(parts).toEqual({ before: "claude '/continue'", after: "" });
    expect(parts.before).toBe(composeRunLine("claude", "", "/continue", "ignored"));
  });

  it("marks a later placeholder, which the send fills too", () => {
    expect(runLineParts("tool", "", "{prompt} --title {prompt}")).toEqual({
      before: "tool '",
      after: " --title «objective»'",
    });
    expect(composeRunLine("tool", "", "{prompt} --title {prompt}", "go")).toBe(
      "tool 'go --title go'",
    );
  });
});

describe("takesPrompt", () => {
  it("is true only for a run loop that has a placeholder", () => {
    expect(takesPrompt('claude "/goal {prompt}"')).toBe(true);
    expect(takesPrompt("claude --continue")).toBe(false);
  });
});

describe("taskRunLine", () => {
  it("is null for a launcher whose run loop is not ready", () => {
    // A whole shell line starting with the command's own word.
    expect(
      taskRunLine({ name: "mine", command: "claude", runLoop: 'claude "/goal {prompt}"' }, "go"),
    ).toBeNull();
    // Not offered for runs: a name the panel does not ship, with no run loop.
    expect(taskRunLine({ name: "mine", command: "tool" }, "go")).toBeNull();
    expect(taskRunLine({ name: "mine", command: "tool", runLoop: "  " }, "go")).toBeNull();
  });

  it("composes the line for a ready launcher", () => {
    expect(
      taskRunLine({ name: "mine", command: "tool", runLoop: "/goal {prompt}", promptFlag: "" }, "go"),
    ).toBe("tool '/goal go'");
  });
});
