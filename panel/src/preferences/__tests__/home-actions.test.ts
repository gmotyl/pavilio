import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_PREFERENCES, preferences } from "../declarations";
import { __resetPreferenceStoreForTests, readPreference } from "../store";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

const KEYS = [
  "home.actions",
  "home.groupFilter",
  "shell.starredOrder",
  "shell.starredCollapsed",
  "shell.projectsCollapsed",
];

function boot(values: Record<string, unknown> = {}): void {
  globals.__PAVILIO_PREFS__ = { version: 1, global: values };
  __resetPreferenceStoreForTests();
}

describe("home actions and sidebar section preferences", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    boot();
  });

  afterEach(() => {
    delete globals.__PAVILIO_PREFS__;
    localStorage.clear();
    sessionStorage.clear();
    __resetPreferenceStoreForTests();
    vi.unstubAllGlobals();
  });

  it("home.actions defaults to the two shipped actions", () => {
    expect(readPreference(preferences.homeActions)).toEqual([
      { label: "Process meetings", runner: "claude", text: "pavilio-note-batch", project: "workspace" },
      {
        label: "Knowledge harvest",
        runner: "claude",
        text: "pavilio-wiki-ingest-knowledge",
        project: "workspace",
      },
    ]);
  });

  it("shell.starredOrder keeps only string entries and rejects non-lists", () => {
    const codec = preferences.starredOrder.codec;
    expect(codec.parse('["a","b"]')).toEqual(["a", "b"]);
    expect(codec.parse('[1,"a"]')).toEqual(["a"]);
    expect(() => codec.parse("{}")).toThrow();
    expect(() => codec.parse('"x"')).toThrow();
  });

  it("home.actions drops an entry with a blank or missing field", () => {
    const codec = preferences.homeActions.codec;
    const valid = { label: "Go", runner: "shell", text: "ls", project: "pavilio" };
    const decoded = codec.parse(
      JSON.stringify([
        valid,
        { ...valid, project: "  " },
        { label: "No project", runner: "claude", text: "x" },
        { ...valid, text: 5 },
      ]),
    );
    expect(decoded).toEqual([valid]);
  });

  it("new home/shell keys default to null, [], false, false", () => {
    expect(readPreference(preferences.homeGroupFilter)).toBeNull();
    expect(readPreference(preferences.starredOrder)).toEqual([]);
    expect(readPreference(preferences.starredCollapsed)).toBe(false);
    expect(readPreference(preferences.projectsCollapsed)).toBe(false);
  });

  it("new home/shell keys are global and portable", () => {
    const defs = ALL_PREFERENCES.filter((def) => KEYS.includes(def.key));
    expect(defs.map((def) => def.key).sort()).toEqual([...KEYS].sort());
    for (const def of defs) {
      expect(def.scope, def.key).toBe("global");
      expect(def.portable, def.key).toBe(true);
    }
  });
});
