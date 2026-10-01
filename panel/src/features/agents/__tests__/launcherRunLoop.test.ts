import { describe, expect, it } from "vitest";

import { fixWholeLine, resolveRunLoop } from "../launcherRunLoop";
import {
  DEFAULT_TERMINAL_LAUNCHERS,
  type TerminalLauncher,
} from "../../../preferences/declarations";

describe("resolveRunLoop", () => {
  it("the shipped defaults carry a start prompt and opencode's flag", () => {
    // Written out rather than derived from the constant, so a changed default
    // shows up here as a diff.
    expect(DEFAULT_TERMINAL_LAUNCHERS).toEqual([
      { name: "claude", command: "claude", runLoop: "/goal {prompt}" },
      { name: "codex", command: "codex", runLoop: "/goal {prompt}" },
      { name: "opencode", command: "opencode", promptFlag: "--prompt", runLoop: "{prompt}" },
    ]);
    expect(DEFAULT_TERMINAL_LAUNCHERS.map(resolveRunLoop)).toEqual([
      { kind: "ready", runLoop: "/goal {prompt}", promptFlag: "", source: "stored" },
      { kind: "ready", runLoop: "/goal {prompt}", promptFlag: "", source: "stored" },
      { kind: "ready", runLoop: "{prompt}", promptFlag: "--prompt", source: "stored" },
    ]);
  });

  it("a list from before the column resolves the default for a known name", () => {
    expect(resolveRunLoop({ name: "claude", command: "claude" })).toEqual({
      kind: "ready",
      runLoop: "/goal {prompt}",
      promptFlag: "",
      source: "default",
    });
    // The flag's default follows the name too, and a custom command keeps it.
    expect(resolveRunLoop({ name: "opencode", command: "opencode --model x" })).toEqual({
      kind: "ready",
      runLoop: "{prompt}",
      promptFlag: "--prompt",
      source: "default",
    });
  });

  it("an unknown name with no run loop is not offered", () => {
    expect(resolveRunLoop({ name: "resume", command: "claude --continue" })).toEqual({
      kind: "none",
    });
  });

  it("an empty run loop is not offered", () => {
    expect(resolveRunLoop({ name: "claude", command: "claude", runLoop: "" })).toEqual({
      kind: "none",
    });
    expect(resolveRunLoop({ name: "codex", command: "codex", runLoop: "   " })).toEqual({
      kind: "none",
    });
  });

  it("the three old whole-line defaults read as absent", () => {
    expect(
      resolveRunLoop({ name: "claude", command: "claude", runLoop: 'claude "/goal {prompt}"' }),
    ).toEqual({ kind: "ready", runLoop: "/goal {prompt}", promptFlag: "", source: "default" });
    expect(
      resolveRunLoop({ name: "codex", command: "codex", runLoop: 'codex "/goal {prompt}"' }),
    ).toEqual({ kind: "ready", runLoop: "/goal {prompt}", promptFlag: "", source: "default" });
    expect(
      resolveRunLoop({
        name: "opencode",
        command: "opencode",
        runLoop: 'opencode --prompt "{prompt}"',
      }),
    ).toEqual({ kind: "ready", runLoop: "{prompt}", promptFlag: "--prompt", source: "default" });
  });

  it("the old opencode whole line keeps its flag over a stored blank one", () => {
    // `opencode --prompt "{prompt}"` carried the flag inside the line, so a
    // blank `promptFlag` saved next to it (an editor writing the row back)
    // must not turn the default positional.
    expect(
      resolveRunLoop({
        name: "opencode",
        command: "opencode",
        promptFlag: "",
        runLoop: 'opencode --prompt "{prompt}"',
      }),
    ).toEqual({ kind: "ready", runLoop: "{prompt}", promptFlag: "--prompt", source: "default" });
    // A flag the user actually set still wins.
    expect(
      resolveRunLoop({
        name: "opencode",
        command: "opencode",
        promptFlag: "-p",
        runLoop: 'opencode --prompt "{prompt}"',
      }),
    ).toMatchObject({ promptFlag: "-p" });
  });

  it("a run loop starting with its own command is a whole line", () => {
    const stored = 'codex --no-daemon "/goal {prompt}"';
    expect(
      resolveRunLoop({ name: "codex", command: "codex --no-daemon", runLoop: stored }),
    ).toEqual({ kind: "wholeLine", stored });
    // Only the command's first word counts, and it must be a whole word:
    // `codexify` merely starts with the same letters.
    expect(
      resolveRunLoop({ name: "tool", command: "codex", runLoop: "codex --continue" }),
    ).toEqual({ kind: "wholeLine", stored: "codex --continue" });
    expect(
      resolveRunLoop({ name: "tool", command: "codex", runLoop: "codexify {prompt}" }),
    ).toEqual({ kind: "ready", runLoop: "codexify {prompt}", promptFlag: "", source: "stored" });
    // The word alone, with nothing after it, is text the CLI receives.
    expect(resolveRunLoop({ name: "tool", command: "codex", runLoop: "codex" })).toMatchObject({
      kind: "ready",
    });
  });

  it("plain CLI text resolves as stored", () => {
    expect(
      resolveRunLoop({
        name: "opencode",
        command: "opencode",
        runLoop: "goal: pavilio-execute-plan {prompt}",
      }),
    ).toEqual({
      kind: "ready",
      runLoop: "goal: pavilio-execute-plan {prompt}",
      promptFlag: "--prompt",
      source: "stored",
    });
    // A stored flag wins over the name's default, blank included.
    expect(
      resolveRunLoop({ name: "opencode", command: "opencode", promptFlag: "", runLoop: "{prompt}" }),
    ).toMatchObject({ promptFlag: "" });
    expect(
      resolveRunLoop({ name: "tool", command: "tool", promptFlag: " -m ", runLoop: "{prompt}" }),
    ).toMatchObject({ promptFlag: "-m" });
  });

  it("resolving never mutates the stored entry", () => {
    const entries: TerminalLauncher[] = [
      { name: "claude", command: "claude" },
      { name: "codex", command: "codex", runLoop: 'codex "/goal {prompt}"' },
      { name: "codex", command: "codex --no-daemon", runLoop: 'codex --no-daemon "/goal {prompt}"' },
      { name: "tool", command: "tool", runLoop: "" },
    ];
    const before = structuredClone(entries);
    const frozen = entries.map((entry) => Object.freeze({ ...entry }));
    for (const entry of frozen) resolveRunLoop(entry);
    for (const entry of entries) resolveRunLoop(entry);
    expect(entries).toEqual(before);
  });
});

describe("fixWholeLine", () => {
  it("fixing a whole line strips the command and quotes and lifts --prompt", () => {
    const codex: TerminalLauncher = {
      name: "codex",
      command: "codex --no-daemon",
      runLoop: 'codex --no-daemon "/goal {prompt}"',
    };
    const fixed = fixWholeLine(codex);
    expect(fixed).toEqual({ name: "codex", command: "codex --no-daemon", runLoop: "/goal {prompt}" });
    expect(fixed).not.toBe(codex);
    expect(codex.runLoop).toBe('codex --no-daemon "/goal {prompt}"');
    expect(resolveRunLoop(fixed)).toMatchObject({ kind: "ready", runLoop: "/goal {prompt}" });

    expect(
      fixWholeLine({ name: "opencode", command: "opencode", runLoop: 'opencode --prompt "x {prompt}"' }),
    ).toEqual({ name: "opencode", command: "opencode", promptFlag: "--prompt", runLoop: "x {prompt}" });

    // The command did not prefix the loop: only its first word goes.
    // Single quotes are one layer too, and `-p` lifts like `--prompt`.
    expect(
      fixWholeLine({ name: "tool", command: "tool --fast", runLoop: "tool -p '/goal {prompt}'" }),
    ).toEqual({ name: "tool", command: "tool --fast", promptFlag: "-p", runLoop: "/goal {prompt}" });

    // Only ONE layer of quotes.
    expect(
      fixWholeLine({ name: "tool", command: "tool", runLoop: `tool "'{prompt}'"` }).runLoop,
    ).toBe("'{prompt}'");

    // Not a whole line: an equal copy, never the same object.
    const plain: TerminalLauncher = { name: "claude", command: "claude", runLoop: "/goal {prompt}" };
    expect(fixWholeLine(plain)).toEqual(plain);
    expect(fixWholeLine(plain)).not.toBe(plain);
  });
});
