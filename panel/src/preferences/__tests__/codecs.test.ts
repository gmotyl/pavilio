import { describe, it, expect, afterEach, vi } from "vitest";
import { bool, json, num, str } from "../codecs";
import { definePreference, storageKey } from "../types";

const leftSidebarExpanded = definePreference({
  key: "shell.leftSidebar.expanded",
  scope: "global",
  default: true,
  codec: bool,
  portable: true,
});

const projectLastView = definePreference({
  key: "project.lastView",
  scope: "project",
  default: "notes",
  codec: str,
  portable: true,
});

const branchDiffOpen = definePreference({
  key: "repos.branchDiff.open",
  scope: "repo",
  default: false,
  codec: bool,
  portable: true,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("storageKey", () => {
  it("global scope produces a bare key", () => {
    expect(storageKey(leftSidebarExpanded)).toBe("shell.leftSidebar.expanded");
  });

  it("project scope appends the scope argument", () => {
    expect(storageKey(projectLastView, "pavilio")).toBe("project.lastView@pavilio");
  });

  it("a non-global preference without a scope argument throws", () => {
    expect(() => storageKey(projectLastView)).toThrow();
    expect(() => storageKey(branchDiffOpen)).toThrow();
  });

  it("a tilde path and its expanded form produce one repo key", () => {
    // The real storage dump held `~/git/prv/pavilio` and `/root/git/prv/pavilio`
    // as two keys with opposite values — the collision this canonicalization exists to stop.
    vi.stubEnv("HOME", "/root");
    expect(storageKey(branchDiffOpen, "~/git/prv/pavilio")).toBe(
      storageKey(branchDiffOpen, "/root/git/prv/pavilio"),
    );
    expect(storageKey(branchDiffOpen, "~/git/prv/pavilio")).toBe(
      "repos.branchDiff.open@/root/git/prv/pavilio",
    );
  });

  it("a trailing slash does not fork a repo key", () => {
    vi.stubEnv("HOME", "/root");
    const canonical = storageKey(branchDiffOpen, "/root/git/prv/pavilio");
    expect(storageKey(branchDiffOpen, "/root/git/prv/pavilio/")).toBe(canonical);
    expect(storageKey(branchDiffOpen, "/root//git/prv//pavilio//")).toBe(canonical);
    expect(storageKey(branchDiffOpen, "~/git/prv/pavilio/")).toBe(canonical);
  });
});

describe("codecs", () => {
  it("bool rejects a value that is neither true nor false", () => {
    expect(() => bool.parse("1")).toThrow();
    expect(() => bool.parse("yes")).toThrow();
    expect(() => bool.parse("")).toThrow();
    expect(() => bool.parse("True")).toThrow();
  });

  it("num rejects a non-numeric string", () => {
    expect(() => num.parse("wide")).toThrow();
    expect(() => num.parse("")).toThrow();
    expect(() => num.parse("240px")).toThrow();
  });

  it("json rejects malformed JSON", () => {
    expect(() => json().parse("{nope")).toThrow();
    expect(() => json().parse("")).toThrow();
  });

  it("every codec round-trips its value", () => {
    for (const value of [true, false]) {
      expect(bool.parse(bool.serialize(value))).toBe(value);
    }
    for (const value of [0, 240, 1.5, -3]) {
      expect(num.parse(num.serialize(value))).toBe(value);
    }
    for (const value of ["", "notes", "a@b/c"]) {
      expect(str.parse(str.serialize(value))).toBe(value);
    }
    const commitsOpen = { pavilio: ["abc123", "def456"], vector: [] };
    const codec = json<typeof commitsOpen>();
    expect(codec.parse(codec.serialize(commitsOpen))).toEqual(commitsOpen);
  });
});
