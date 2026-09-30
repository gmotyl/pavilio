import { describe, expect, it } from "vitest";
import { composeRunLine, resolveObjective, splitRunLoop, takesPrompt } from "../runPrompt";

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

describe("composeRunLine", () => {
  it("substitutes the objective into each shipped run loop", () => {
    expect(composeRunLine('claude "/goal {prompt}"', "do it")).toBe('claude "/goal do it"');
    expect(composeRunLine('codex "/goal {prompt}"', "do it")).toBe('codex "/goal do it"');
    expect(composeRunLine('opencode --prompt "{prompt}"', "do it")).toBe(
      'opencode --prompt "do it"',
    );
  });

  it("escapes what a double-quoted shell string would otherwise interpret", () => {
    // `"` would end the string, `$` and a backtick would expand, `\` would escape.
    expect(composeRunLine('claude "/goal {prompt}"', 'say "hi" $HOME `id` a\\b')).toBe(
      'claude "/goal say \\"hi\\" \\$HOME \\`id\\` a\\\\b"',
    );
  });

  it("keeps a history-expansion bang out of the double-quoted string", () => {
    // Inside "…" an interactive bash or zsh expands `!x`, and a backslash
    // there stays in the text; a single-quoted `!` is inert in both.
    expect(composeRunLine('claude "{prompt}"', "ship it!now")).toBe(
      `claude "ship it"'!'"now"`,
    );
  });

  it("escapes a single quote inside a single-quoted run loop", () => {
    expect(composeRunLine("claude '{prompt}'", "don't $HOME")).toBe(
      "claude 'don'\\''t $HOME'",
    );
  });

  it("single-quotes the objective when the run loop leaves it bare", () => {
    expect(composeRunLine("aider --message {prompt}", "fix it's $HOME")).toBe(
      "aider --message 'fix it'\\''s $HOME'",
    );
  });

  it("folds line breaks to spaces, so the PTY never receives an early return", () => {
    expect(composeRunLine('claude "{prompt}"', "one\ntwo\r\nthree")).toBe(
      'claude "one two three"',
    );
  });

  it("folds tabs and other control characters to spaces, like line breaks", () => {
    // A tab typed into a PTY asks the shell to complete; ESC, ^C, ^D and DEL
    // are keystrokes too. None of them may reach the terminal as themselves.
    expect(composeRunLine('claude "{prompt}"', "a\tb\u001bc\u0003d\u0004e\u007ff\u0000g")).toBe(
      'claude "a b c d e f g"',
    );
    expect(composeRunLine("aider --message {prompt}", "x\ty")).toBe("aider --message 'x y'");
  });

  it("returns a run loop with no placeholder unchanged", () => {
    expect(composeRunLine("claude --continue", "ignored")).toBe("claude --continue");
  });
});

describe("splitRunLoop", () => {
  it("splits the launcher's wrapper around the first placeholder", () => {
    expect(splitRunLoop('codex "/goal {prompt}"')).toEqual({
      before: 'codex "/goal ',
      after: '"',
    });
  });

  it("puts a run loop without a placeholder wholly before the objective", () => {
    expect(splitRunLoop("claude --continue")).toEqual({ before: "claude --continue", after: "" });
  });

  it("marks a later placeholder, which the send fills too", () => {
    // `composeRunLine` substitutes every `{prompt}`; the drawing must not show
    // a raw placeholder that the sent line will not contain.
    expect(splitRunLoop('tool "{prompt}" --title "{prompt}"')).toEqual({
      before: 'tool "',
      after: '" --title "«objective»"',
    });
    expect(composeRunLine('tool "{prompt}" --title "{prompt}"', "go")).toBe(
      'tool "go" --title "go"',
    );
  });
});

describe("takesPrompt", () => {
  it("is true only for a run loop that has a placeholder", () => {
    expect(takesPrompt('claude "/goal {prompt}"')).toBe(true);
    expect(takesPrompt("claude --continue")).toBe(false);
  });
});
