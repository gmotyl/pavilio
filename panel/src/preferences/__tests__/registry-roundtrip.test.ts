import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_PREFERENCES } from "../declarations";
import { __resetPreferenceStoreForTests, readPreference, writePreference } from "../store";

/**
 * The registry invariant behind the store's value-shape bridge.
 *
 * The workspace file is hand-readable: a boolean is stored as `true` and a width
 * as `240`, not as `"true"` and `"240"` — while the codecs speak text, because
 * `localStorage` does. `toStored`/`toRaw` bridge the two, and that bridge is the
 * one place where a declaration's codec and its storage tier interact. A
 * declaration whose codec parses JSON but whose payload can be a bare string is
 * exactly where the bridge can lose data silently: the write succeeds, the read
 * answers the default, and nothing warns.
 *
 * So this asserts the property directly, for EVERY declaration, with values
 * chosen to be hostile to the bridge — strings that look like booleans, numbers
 * and JSON; empty strings; nulls; empty collections. A future declaration that
 * breaks the bridge fails here the moment it lands, rather than in a user's
 * file.
 *
 * `SAMPLES` is hand-written on purpose and the count is asserted: derived from
 * the registry it would iterate whatever exists, and a declaration added with no
 * samples would sail through testing nothing.
 */
const PROJECT = "alpha";
const REPO = "/root/git/prv/pavilio";

/** Representative — and deliberately awkward — values per declared key. */
const SAMPLES: Record<string, readonly unknown[]> = {
  // ── bool ────────────────────────────────────────────────────────────────
  "shell.leftSidebar.expanded": [true, false],
  "shell.rightSidebar.expanded": [true, false],
  "shell.rightSidebar.section.expanded": [true, false],
  "shell.project.expanded": [true, false],
  "view.wide": [true, false],
  "fileList.sidebarCollapsed": [true, false],
  "search.includeArchived": [true, false],
  "git.commitsOpen": [true, false],
  "git.branchDiff.open": [true, false],
  "git.worktree.expanded": [true, false],
  "terminal.drawer.open": [true, false],
  "terminal.maximized": [true, false],
  "speech.answerPane.autoOpen": [true, false],
  "time.form.resetAutoOnSave": [true, false],

  // ── num ─────────────────────────────────────────────────────────────────
  "terminal.drawer.width": [480, 0, 1, 1024, 23.5, -1],
  "fileList.paneWidth": [288, 0, 200, 560, 344.5, -1],

  // ── str: the values that would round-trip WRONG through a JSON re-parse ──
  "git.branchDiff.base": ["", "main", "true", "240", "null", "{}", "[]", "release/1.0"],
  "speech.voice": ["en-US-AndrewMultilingualNeural", "", "true", "240", "null"],

  // ── oneOf ───────────────────────────────────────────────────────────────
  "repos.searchScope": ["changed", "branch-diff", "commits"],
  "git.viewMode": ["flat", "tree"],
  "terminal.drawer.side": ["left", "right"],

  // ── json, object- and array-valued ──────────────────────────────────────
  "fileList.sort": [
    { sortKey: "date", sortDir: "desc" },
    { sortKey: "name", sortDir: "asc" },
  ],
  "projects.favorites": [[], ["pavilio"], ["true", "240", ""]],
  "time.report": [
    { period: "this-week", format: "text", detail: "detailed" },
    { period: "today", format: "markdown", detail: "summary" },
  ],
  "terminal.order": [[], ["sess-1"], ["true", "240"]],
  "terminal.grid": [[], [{ id: "sess-1", x: 0, y: 0, w: 1, h: 1 }]],

  // ── json whose payload can be a BARE STRING — the shape that breaks a
  //    bridge keyed off the declared default rather than off the codec ─────
  "terminal.focus": [null, "", "sess-1", "true", "240", "null"],
  "speech.armedCell": [null, "", "sess-1", "true", "240", "null"],
  "nav.lastPath": [null, "", "/notes/today.md", "true", "240", "null"],
  "nav.lastFile": [null, "", "/notes/today.md", "true", "240", "null"],
  "nav.lastReposQuery": [null, "", "pavilio", "true", "240", "null"],
};

/** How many declarations the samples above are known to cover. */
const DECLARATION_COUNT = 31;

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

function scopeArgFor(scope: "global" | "project" | "repo"): string | undefined {
  if (scope === "global") return undefined;
  return scope === "repo" ? REPO : PROJECT;
}

beforeEach(() => {
  globals.__PAVILIO_PREFS__ = { version: 1 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
  );
});

afterEach(() => {
  delete globals.__PAVILIO_PREFS__;
  localStorage.clear();
  sessionStorage.clear();
  __resetPreferenceStoreForTests();
  vi.unstubAllGlobals();
});

describe("every declaration round-trips through the store", () => {
  it("the sample table covers the whole registry, and nothing else", () => {
    // Without this the loop below can pass by iterating nothing — the exact
    // failure mode of a test derived from the thing it is meant to pin.
    expect(ALL_PREFERENCES).toHaveLength(DECLARATION_COUNT);
    expect(Object.keys(SAMPLES).sort()).toEqual(ALL_PREFERENCES.map((d) => d.key).sort());
    for (const [key, values] of Object.entries(SAMPLES)) {
      expect(values.length, `${key} samples`).toBeGreaterThan(0);
    }
  });

  it("writePreference then readPreference returns what was written", () => {
    for (const def of ALL_PREFERENCES) {
      const scopeArg = scopeArgFor(def.scope);
      for (const value of SAMPLES[def.key] ?? []) {
        writePreference(def, value, scopeArg);
        expect(readPreference(def, scopeArg), `${def.key} = ${JSON.stringify(value)}`).toEqual(
          value,
        );
      }
    }
  });

  it("a portable write leaves the document hand-readable", () => {
    // The other half of the bridge's contract, and the reason it cannot simply
    // store every value as its JSON text: a human opens this file. A boolean is
    // `true`, a width is `240`, and a string-valued preference is its own text.
    for (const def of ALL_PREFERENCES) {
      if (!def.portable) continue;
      const scopeArg = scopeArgFor(def.scope);
      for (const value of SAMPLES[def.key] ?? []) {
        writePreference(def, value, scopeArg);
        const stored = globals.__PAVILIO_PREFS__?.[
          scopeArg === undefined ? def.key : `${def.key}@${scopeArg}`
        ];
        if (typeof value === "boolean" || typeof value === "number") {
          expect(stored, `${def.key} = ${JSON.stringify(value)}`).toEqual(value);
        }
        if (typeof value === "string" && def.codec.storesText === true) {
          expect(stored, `${def.key} = ${JSON.stringify(value)}`).toBe(value);
        }
      }
    }
  });
});
