import { describe, expect, it } from "vitest";
import type { HomeAction, TerminalLauncher } from "../../../preferences/declarations";
import { actionBlocker, actionRunLine } from "../homeActions";

const LAUNCHERS: TerminalLauncher[] = [
  { name: "claude", command: "claude", runLoop: 'claude "/goal {prompt}"' },
  { name: "opencode", command: "opencode", promptFlag: "--prompt" },
];

const action = (runner: string, text: string, project = "workspace"): HomeAction => ({
  label: "x",
  runner,
  text,
  project,
});

describe("actionRunLine", () => {
  it("agent action line has no run loop", () => {
    expect(actionRunLine(action("claude", "pavilio-note-batch"), LAUNCHERS)).toBe(
      "claude 'pavilio-note-batch'",
    );
  });

  it("prompt flag is used for opencode", () => {
    expect(actionRunLine(action("opencode", "hello"), LAUNCHERS)).toBe("opencode --prompt 'hello'");
  });

  it("shell action line is the text verbatim", () => {
    expect(actionRunLine(action("shell", "pnpm pull"), LAUNCHERS)).toBe("pnpm pull");
  });

  it("is null for an unknown runner", () => {
    expect(actionRunLine(action("nope", "x"), LAUNCHERS)).toBeNull();
  });
});

describe("actionBlocker", () => {
  it("blocker reports project missing and runner missing", () => {
    const projects = new Set(["workspace"]);
    expect(actionBlocker(action("claude", "x", "gone"), LAUNCHERS, projects)).toBe(
      "project missing",
    );
    expect(actionBlocker(action("nope", "x"), LAUNCHERS, projects)).toBe("runner missing");
    expect(actionBlocker(action("shell", "x"), LAUNCHERS, projects)).toBeNull();
    expect(actionBlocker(action("claude", "x"), LAUNCHERS, projects)).toBeNull();
  });
});
