import { describe, it, expect } from "vitest";
import { matchProjectFromPath, matchProjectFromViewPath } from "../matchProjectFromPath";

describe("matchProjectFromPath", () => {
  it.each<[label: string, path: string, expected: { name: string; section: string | null } | null]>([
    ["returns null for the root path", "/", null],
    ["returns null for a non-project path", "/settings", null],
    ["parses name with no section", "/project/vector", { name: "vector", section: null }],
    ["parses name + section", "/project/vector/memo", { name: "vector", section: "memo" }],
    ["decodes the project name", "/project/my%20proj/iterm", { name: "my proj", section: "iterm" }],
  ])("%s", (_label, path, expected) => {
    expect(matchProjectFromPath(path)).toEqual(expected);
  });
});

describe("matchProjectFromViewPath", () => {
  it.each<[label: string, path: string, expected: string | null]>([
    ["returns null for a non-view path", "/project/vector/iterm", null],
    ["reads the project of a file view", "/view/vector/notes/a.md", "vector"],
    ["decodes the project name", "/view/my%20proj/a.md", "my proj"],
    ["returns null for a virtual root", "/view/_root/skills/x/SKILL.md", null],
    ["returns null for a malformed escape", "/view/%E0%A4%A/a.md", null],
  ])("%s", (_label, path, expected) => {
    expect(matchProjectFromViewPath(path)).toBe(expected);
  });
});
