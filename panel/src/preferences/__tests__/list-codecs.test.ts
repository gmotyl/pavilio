import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMPOSER_SHORTCUTS,
  DEFAULT_TERMINAL_LAUNCHERS,
  preferences,
} from "../declarations";
import { readPreference } from "../store";
import { storageKey } from "../types";

/**
 * The launcher and shortcut lists are hand-editable JSON in the workspace file,
 * and every consumer `.map`s them. A value that is not an array of usable
 * entries must never reach one: a non-array falls back to the shipped default,
 * an invalid entry is dropped, and a list with entries of which none is usable
 * is corruption rather than a choice, so it falls back too. An EMPTY array is a
 * choice — the user cleared the list — and stays empty.
 */
type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

function seed(key: string, value: unknown): void {
  globals.__PAVILIO_PREFS__![key] = value;
}

describe("composer.shortcuts codec", () => {
  const def = preferences.composerShortcuts;
  const KEY = storageKey(def);
  const read = () => readPreference(def);

  it.each([
    ["an object", {}],
    ["a number", 5],
    ["a string", "yes"],
    ["an array of strings", ["yes"]],
    ["an entry missing its text", [{ label: "X" }]],
    ["an entry of numbers", [{ label: 1, text: 2 }]],
    ["an entry of blanks", [{ label: "", text: "  " }]],
    ["an array of nulls", [null, null]],
  ])("%s falls back to the default", (_, value) => {
    seed(KEY, value);
    expect(read()).toEqual(DEFAULT_COMPOSER_SHORTCUTS);
  });

  it("a stored null falls back to the default", () => {
    seed(KEY, null);
    expect(read()).toEqual(DEFAULT_COMPOSER_SHORTCUTS);
  });

  it("an empty list stays empty", () => {
    seed(KEY, []);
    expect(read()).toEqual([]);
  });

  it("a mixed list keeps its valid entries, in order, and only their fields", () => {
    seed(KEY, [
      { label: "Go on", text: "continue" },
      "nope",
      { label: "X" },
      { label: "Yes", text: "yes", extra: true },
      { label: 1, text: "one" },
    ]);
    expect(read()).toEqual([
      { label: "Go on", text: "continue" },
      { label: "Yes", text: "yes" },
    ]);
  });
});

describe("terminal.launchers codec", () => {
  const def = preferences.terminalLaunchers;
  const KEY = storageKey(def);
  const read = () => readPreference(def);

  it.each([
    ["an object", {}],
    ["a number", 5],
    ["an array of strings", ["claude"]],
    ["an entry missing its command", [{ name: "claude" }]],
    ["an entry of numbers", [{ name: 1, command: 2 }]],
  ])("%s falls back to the default", (_, value) => {
    seed(KEY, value);
    expect(read()).toEqual(DEFAULT_TERMINAL_LAUNCHERS);
  });

  it("a stored null falls back to the default", () => {
    seed(KEY, null);
    expect(read()).toEqual(DEFAULT_TERMINAL_LAUNCHERS);
  });

  it("an empty list stays empty", () => {
    seed(KEY, []);
    expect(read()).toEqual([]);
  });

  it("a mixed list keeps valid entries and drops a non-string optional field", () => {
    seed(KEY, [
      { name: "claude", command: "claude", runLoop: "/goal {prompt}" },
      { name: "broken" },
      { name: "codex", command: "codex", promptFlag: 5, runLoop: "" },
      { name: "opencode", command: "opencode", promptFlag: "--prompt", runLoop: null },
    ]);
    expect(read()).toEqual([
      { name: "claude", command: "claude", runLoop: "/goal {prompt}" },
      { name: "codex", command: "codex", runLoop: "" },
      { name: "opencode", command: "opencode", promptFlag: "--prompt" },
    ]);
  });
});
