import { describe, it, expect } from "vitest";
import { matchProjectFromPath } from "../matchProjectFromPath";

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
