import { describe, it, expect, afterEach, vi } from "vitest";
import { bool, json, num, oneOf, str } from "../codecs";
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

type HomeGlobals = typeof globalThis & {
  __PAVILIO_HOME__?: string;
  process?: unknown;
};

const globals = globalThis as HomeGlobals;
const realProcess = globals.process;

afterEach(() => {
  // Restore a deleted `process` BEFORE unstubbing envs, which reads `process.env`.
  if (globals.process !== realProcess) globals.process = realProcess;
  delete globals.__PAVILIO_HOME__;
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

  it("an empty or blank scope argument counts as missing and throws", () => {
    // `usePreference(def, name ?? "")` is the live idiom: an unresolved route
    // param must not collapse every project onto one shared key.
    expect(() => storageKey(projectLastView, "")).toThrow();
    expect(() => storageKey(projectLastView, "   ")).toThrow();
    expect(() => storageKey(branchDiffOpen, "")).toThrow();
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

  it("the injected home global expands a tilde and beats process.env.HOME", () => {
    // In the browser bundle `process` is not defined, so the server injects its
    // home directory as `window.__PAVILIO_HOME__`. It is the authority when both
    // are present — the two values differ here so the precedence is real.
    globals.__PAVILIO_HOME__ = "/home/greg";
    vi.stubEnv("HOME", "/root");
    expect(storageKey(branchDiffOpen, "~/git/prv/pavilio")).toBe(
      "repos.branchDiff.open@/home/greg/git/prv/pavilio",
    );
    expect(storageKey(branchDiffOpen, "~")).toBe("repos.branchDiff.open@/home/greg");
  });

  it("process.env.HOME still expands a tilde when the global is absent", () => {
    expect(globals.__PAVILIO_HOME__).toBeUndefined();
    vi.stubEnv("HOME", "/root");
    expect(storageKey(branchDiffOpen, "~/git/prv/pavilio")).toBe(
      "repos.branchDiff.open@/root/git/prv/pavilio",
    );
  });

  it("with neither the global nor process, a tilde is left unexpanded", () => {
    // The honest pre-Task-4 browser behavior: with no home to expand against,
    // a `~` path stays a `~` path rather than being silently mangled. Acceptable
    // only because Task 4's `GET /api/preferences.js` supplies `__PAVILIO_HOME__`;
    // until then a tilde repo and its absolute form remain two keys.
    // `Reflect.deleteProperty`, not `delete`: node's ambient types make
    // `globalThis.process` non-optional, which `delete` refuses.
    Reflect.deleteProperty(globals, "process");
    expect(storageKey(branchDiffOpen, "~/git/prv/pavilio")).toBe(
      "repos.branchDiff.open@~/git/prv/pavilio",
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

describe("oneOf", () => {
  // The whole reason `oneOf` exists rather than `str`: `str` hands back an
  // unknown stored value typed as a union member it is not, and the store has
  // no way to notice. Throwing is what lets the declared default win.
  const side = oneOf(["left", "right"] as const);

  it("accepts a listed member and hands it back unchanged", () => {
    expect(side.parse("left")).toBe("left");
    expect(side.parse("right")).toBe("right");
  });

  it("throws on a value that is not in the list", () => {
    expect(() => side.parse("top")).toThrow();
    expect(() => side.parse("")).toThrow();
    expect(() => side.parse("Left")).toThrow();
    expect(() => side.parse("left ")).toThrow();
  });

  it("names the accepted values in the error, so a bad stored value is diagnosable", () => {
    expect(() => side.parse("top")).toThrow(/left\|right/);
  });

  it("round-trips every member", () => {
    for (const value of ["left", "right"] as const) {
      expect(side.parse(side.serialize(value))).toBe(value);
    }
  });

  it("an empty value list rejects everything", () => {
    const nothing = oneOf([]);
    expect(() => nothing.parse("anything")).toThrow();
  });
});
