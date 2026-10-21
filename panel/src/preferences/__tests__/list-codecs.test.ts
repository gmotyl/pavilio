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

const shortcuts = preferences.composerShortcuts;
const launchers = preferences.terminalLaunchers;

describe("composer.shortcuts codec", () => {
  it.each([
    ["a stored null", null],
    ["a non-array stored value", { label: "Yes", text: "yes" }],
    ["an object", {}],
    ["a number", 5],
    ["a string", "yes"],
    ["an array of strings", ["yes"]],
    ["an entry missing its text", [{ label: "X" }]],
    ["an entry of numbers", [{ label: 1, text: 2 }]],
    ["an entry of blanks", [{ label: "", text: "  " }]],
    ["an array of nulls", [null, null]],
  ])("%s falls back to the default", (_, value) => {
    seed(storageKey(shortcuts), value);
    expect(readPreference(shortcuts)).toEqual(DEFAULT_COMPOSER_SHORTCUTS);
  });
});

describe("terminal.launchers codec", () => {
  it.each([
    ["a stored null", null],
    ["a non-array stored value", { name: "claude", command: "claude" }],
    ["an object", {}],
    ["a number", 5],
    ["an array of strings", ["claude"]],
    ["an entry missing its command", [{ name: "claude" }]],
    ["an entry of numbers", [{ name: 1, command: 2 }]],
  ])("%s falls back to the default", (_, value) => {
    seed(storageKey(launchers), value);
    expect(readPreference(launchers)).toEqual(DEFAULT_TERMINAL_LAUNCHERS);
  });
});

describe("list codecs keep the usable entries", () => {
  it.each<[label: string, key: string, read: () => unknown, stored: unknown[], expected: unknown[]]>([
    [
      "shortcuts: an entry whose label or text is only whitespace is dropped",
      storageKey(shortcuts),
      () => readPreference(shortcuts),
      [
        { label: "  ", text: "yes" },
        { label: "OK", text: "ok" },
        { label: "Go", text: " \t " },
      ],
      [{ label: "OK", text: "ok" }],
    ],
    ["shortcuts: an empty list stays empty", storageKey(shortcuts), () => readPreference(shortcuts), [], []],
    [
      "shortcuts: a mixed list keeps its valid entries, in order, and only their fields",
      storageKey(shortcuts),
      () => readPreference(shortcuts),
      [
        { label: "Go on", text: "continue" },
        "nope",
        { label: "X" },
        { label: "Yes", text: "yes", extra: true },
        { label: 1, text: "one" },
      ],
      [
        { label: "Go on", text: "continue" },
        { label: "Yes", text: "yes" },
      ],
    ],
    [
      "launchers: an entry whose name or command is only whitespace is dropped",
      storageKey(launchers),
      () => readPreference(launchers),
      [
        { name: "  ", command: "claude" },
        { name: "codex", command: "codex" },
        { name: "opencode", command: "  " },
      ],
      [{ name: "codex", command: "codex" }],
    ],
    ["launchers: an empty list stays empty", storageKey(launchers), () => readPreference(launchers), [], []],
    [
      "launchers: a mixed list keeps valid entries and drops a non-string optional field",
      storageKey(launchers),
      () => readPreference(launchers),
      [
        { name: "claude", command: "claude", runLoop: "/goal {prompt}" },
        { name: "broken" },
        { name: "codex", command: "codex", promptFlag: 5, runLoop: "" },
        { name: "opencode", command: "opencode", promptFlag: "--prompt", runLoop: null },
      ],
      [
        { name: "claude", command: "claude", runLoop: "/goal {prompt}" },
        { name: "codex", command: "codex", runLoop: "" },
        { name: "opencode", command: "opencode", promptFlag: "--prompt" },
      ],
    ],
  ])("%s", (_label, key, read, stored, expected) => {
    seed(key, stored);
    expect(read()).toEqual(expected);
  });
});
