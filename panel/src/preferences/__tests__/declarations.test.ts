import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_PREFERENCES, preferences } from "../declarations";
import { __resetPreferenceStoreForTests, readPreference, writePreference } from "../store";

/**
 * The portability table from `design.md`, transcribed by hand. It is
 * deliberately a second copy of the decision: reading the registry and
 * comparing it against itself would assert nothing at all.
 */
const PORTABLE = [
  "fileList.paneWidth",
  "fileList.sidebarCollapsed",
  "fileList.sort",
  "git.branchDiff.base",
  "git.branchDiff.open",
  "git.commitsOpen",
  "git.history.paneWidth",
  "git.viewMode",
  "git.worktree.expanded",
  "projects.favorites",
  "repos.searchScope",
  "search.includeArchived",
  "shell.leftSidebar.expanded",
  "shell.leftSidebar.width",
  "shell.project.expanded",
  "shell.rightSidebar.expanded",
  "shell.rightSidebar.section.expanded",
  "shell.rightSidebar.width",
  "speech.answerComposer.on",
  "speech.answerPane.autoOpen",
  "speech.voice",
  "terminal.drawer.open",
  "terminal.drawer.side",
  "terminal.drawer.width",
  "terminal.launchers",
  "terminal.maximized",
  "time.form.resetAutoOnSave",
  "time.report",
  "view.wide",
];

/**
 * Values that name something the other machine does not have — most of them a
 * live session id, with one exception. `speech.answerComposer.height` and
 * `speech.answerPane.height` name no session at all; they are the speech
 * surface's two measurements, kept per browser because each is read against
 * THIS window's viewport — the composer's against the pane it is spent from,
 * the pane's against the terminal area it covers.
 *
 * Both are `project`-scoped as well as machine-local, and the two axes are
 * independent: the scope says how many of these a browser keeps, the
 * portability flag says whether any of them travels. A cell's pane is as tall
 * as the work in it wants — a repository read mostly through its answers
 * deserves a taller pane than one driven from the terminal — so the height is
 * remembered per project, and still never leaves this machine.
 */
const MACHINE_LOCAL = [
  "nav.lastFile",
  "nav.lastPath",
  "nav.lastReposQuery",
  "speech.answerComposer.height",
  "speech.answerPane.height",
  "speech.armedCell",
  "terminal.focus",
  "terminal.grid",
  "terminal.order",
];

/**
 * Rows the design's portability table names that nothing declares yet: no
 * code persists or resizes them today. Listed here so declaring one is a
 * one-line move into PORTABLE rather than a spurious red — which is what
 * `fileList.paneWidth`, the git-history tree's `git.history.paneWidth` and
 * finally the two sidebar widths have each been in turn.
 *
 * EMPTY, and kept rather than deleted: every row of the design's table is
 * declared as of `2026-09-21-panel-ui-polish` Task 4, so this is where the
 * next one goes. The test below it still runs, over nothing — which is the
 * honest reading of "nothing is outstanding".
 */
const NOT_YET_DECLARED: readonly string[] = [];

/**
 * `[key, default, scope]`, transcribed by hand from `declarations.ts` with
 * every value re-derived from the hook it replaces. A second copy on purpose:
 * derived from the registry it would assert nothing, which is exactly how nine
 * mutated defaults once passed green.
 *
 * The one row that deliberately does NOT reproduce today's behavior is
 * `view.wide` — `useWideMode` reads `=== "true"` and so opens compact; this
 * change flips it.
 */
const DEFAULTS: readonly [string, unknown, "global" | "project" | "repo"][] = [
  ["fileList.paneWidth", 288, "global"],
  ["fileList.sidebarCollapsed", false, "global"],
  ["fileList.sort", { sortKey: "date", sortDir: "desc" }, "global"],
  ["git.branchDiff.base", "", "repo"],
  ["git.branchDiff.open", true, "repo"],
  // `isOpen` reads `map[repoPath] !== false`, so an absent entry is OPEN.
  ["git.commitsOpen", true, "repo"],
  ["git.history.paneWidth", 280, "global"],
  ["git.viewMode", "flat", "global"],
  ["git.worktree.expanded", false, "repo"],
  ["nav.lastFile", null, "project"],
  ["nav.lastPath", null, "project"],
  ["nav.lastReposQuery", null, "project"],
  ["projects.favorites", [], "global"],
  ["repos.searchScope", "changed", "global"],
  ["search.includeArchived", true, "global"],
  ["shell.leftSidebar.expanded", true, "global"],
  // The two fixed sidebar widths the stylesheet used to carry, as numbers.
  ["shell.leftSidebar.width", 240, "global"],
  ["shell.project.expanded", false, "project"],
  ["shell.rightSidebar.expanded", true, "global"],
  ["shell.rightSidebar.section.expanded", true, "project"],
  ["shell.rightSidebar.width", 264, "global"],
  // Per project, both of them: how much of a cell you hand to the answer is a
  // fact about the work, not a habit the whole panel shares.
  ["speech.answerComposer.height", 62, "project"],
  ["speech.answerComposer.on", true, "global"],
  ["speech.answerPane.autoOpen", true, "global"],
  // Not a height so much as the word "full": taller than any terminal area, so
  // the pane clamps to the area it is in and an unresized one covers it.
  ["speech.answerPane.height", 4000, "project"],
  ["speech.armedCell", null, "global"],
  ["speech.voice", "en-US-AndrewMultilingualNeural", "global"],
  ["terminal.drawer.open", false, "global"],
  ["terminal.drawer.side", "left", "global"],
  ["terminal.drawer.width", 480, "global"],
  ["terminal.focus", null, "project"],
  ["terminal.grid", [], "project"],
  [
    "terminal.launchers",
    [
      { name: "claude", command: "claude" },
      { name: "codex", command: "codex" },
      { name: "opencode", command: "opencode" },
    ],
    "global",
  ],
  ["terminal.maximized", false, "project"],
  ["terminal.order", [], "project"],
  ["time.form.resetAutoOnSave", false, "project"],
  ["time.report", { period: "this-week", format: "text", detail: "detailed" }, "project"],
  ["view.wide", true, "project"],
];

function keyOf(key: string) {
  const def = ALL_PREFERENCES.find((d) => d.key === key);
  if (!def) throw new Error(`no declaration for "${key}"`);
  return def;
}

describe("the declaration table", () => {
  it("every declared key is unique", () => {
    const keys = ALL_PREFERENCES.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("no declared key embeds a scope separator", () => {
    // `storageKey` joins key and scope argument with "@". A key carrying one of
    // its own would make `shell.project.expanded@a@b` ambiguous to any reader.
    expect(ALL_PREFERENCES.filter((d) => d.key.includes("@"))).toEqual([]);
  });

  it("session-scoped preferences are declared non-portable", () => {
    // Each of these names a live session id — meaningless on another machine,
    // and the one class of value that must never reach the committed file.
    for (const key of [
      "terminal.focus",
      "terminal.order",
      "terminal.grid",
      "speech.armedCell",
      "nav.lastPath",
      "nav.lastFile",
      "nav.lastReposQuery",
    ]) {
      expect(keyOf(key).portable).toBe(false);
    }
  });

  it("the portable set matches the design's portability table", () => {
    const portable = ALL_PREFERENCES.filter((d) => d.portable).map((d) => d.key);
    const local = ALL_PREFERENCES.filter((d) => !d.portable).map((d) => d.key);

    // Everything the table names is declared...
    expect(portable.sort()).toEqual(
      [...PORTABLE].filter((k) => !NOT_YET_DECLARED.includes(k)).sort(),
    );
    expect(local.sort()).toEqual([...MACHINE_LOCAL].sort());
    // ...and nothing is declared that the table does not name. Stated as a
    // subset rather than a length, so that moving a key out of
    // NOT_YET_DECLARED is the whole diff when its feature lands.
    for (const key of portable) expect(PORTABLE).toContain(key);
    for (const key of local) expect(MACHINE_LOCAL).toContain(key);
  });

  it("the rows the design names but nothing persists yet are undeclared", () => {
    // Guards the tolerance above from rotting into a blanket exemption: a key
    // listed as not-yet-declared must actually be absent.
    const keys = ALL_PREFERENCES.map((d) => d.key);
    // Stated, not just looped over: the list is empty today, so the loop below
    // runs zero times and on its own this test would assert nothing at all.
    // Every row the design names is declared — that is the fact, and it is the
    // one that breaks if a key is parked here instead of built.
    expect(NOT_YET_DECLARED).toEqual([]);
    for (const key of NOT_YET_DECLARED) expect(keys).not.toContain(key);
  });

  it("session-backed navigation preferences declare browserStore: session", () => {
    // `lastPath.ts` uses sessionStorage, so routing these to localStorage
    // would break panel-shell spec.md's "a second browser tab keeps its own
    // independent bookmark, and a fully closed browser starts fresh".
    for (const key of ["nav.lastPath", "nav.lastFile", "nav.lastReposQuery"]) {
      expect(keyOf(key).browserStore, key).toBe("session");
    }

    // The tier stays narrow: nothing else opts in, and every opt-in is
    // machine-local (a portable value has no browser store to choose).
    const session = ALL_PREFERENCES.filter((d) => d.browserStore !== undefined);
    expect(session.map((d) => d.key).sort()).toEqual([
      "nav.lastFile",
      "nav.lastPath",
      "nav.lastReposQuery",
    ]);
    expect(session.filter((d) => d.portable)).toEqual([]);
  });

  it("every declaration's default and scope match a hand-written table", () => {
    // AC 4, and the only test that bites it: nine mutated defaults — the
    // wide-mode flip among them — once passed green because every other
    // assertion here reads the registry and compares it against itself.
    // Transcribed by hand from the declarations, each value re-derived from
    // the hook it replaces. Do NOT generate this from `ALL_PREFERENCES`.
    for (const [key, value, scope] of DEFAULTS) {
      const def = keyOf(key);
      expect(def.default, `${key} default`).toEqual(value);
      expect(def.scope, `${key} scope`).toBe(scope);
    }
    // Deliberately strict, unlike the portability list: a new declaration is
    // exactly the moment its default is worth pinning, so landing one without
    // a row here should fail.
    expect(ALL_PREFERENCES.map((d) => d.key).sort()).toEqual(
      DEFAULTS.map(([key]) => key).sort(),
    );
  });

  it("keys of removed features are not declared", () => {
    const keys = ALL_PREFERENCES.map((d) => d.key);

    // Residue found in a real browser's storage dump, with no writer left in
    // the source. Declaring either would resurrect dead state.
    for (const dead of ["panel-archived-projects", "panel:cellReader:tab"]) {
      expect(keys).not.toContain(dead);
    }
    expect(keys.filter((k) => /archivedProjects|cellReader/i.test(k))).toEqual([]);
    // The quick finder's live archive toggle is a different setting, and stays.
    expect(keyOf("search.includeArchived").portable).toBe(true);

    // `pavilio.time.<project>` is the busy accumulator — data, not a choice.
    // Only the report options and the manual-entry reset flag are declared, and
    // both are portable despite sharing the accumulator's old key prefix.
    expect(keys.filter((k) => k.startsWith("time.")).sort()).toEqual([
      "time.form.resetAutoOnSave",
      "time.report",
    ]);
    expect(keyOf("time.report").portable).toBe(true);
    expect(keyOf("time.form.resetAutoOnSave").portable).toBe(true);
  });
});

/**
 * The three declarations the speech surface adds, asserted through the store
 * rather than off the table above: "the default is 62" is a fact about the
 * declaration, but "nothing stored yields the three launchers" is a fact about
 * what a reader gets, and only a read proves it.
 */
type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

/** Two projects, so that "per project" is a claim about telling them apart. */
const ALPHA = "alpha";
const BETA = "beta";

describe("the launcher list and the answer composer", () => {
  beforeEach(() => {
    globals.__PAVILIO_PREFS__ = { version: 1 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });

  afterEach(() => {
    delete globals.__PAVILIO_PREFS__;
    localStorage.clear();
    sessionStorage.clear();
    __resetPreferenceStoreForTests();
    vi.unstubAllGlobals();
  });

  it("terminalLaunchers defaults to claude, codex and opencode in order", () => {
    // Written out rather than compared against `DEFAULT_TERMINAL_LAUNCHERS`:
    // that export IS the declared default, so comparing it to itself would
    // assert nothing — including that the order survived the read.
    expect(readPreference(preferences.terminalLaunchers)).toEqual([
      { name: "claude", command: "claude" },
      { name: "codex", command: "codex" },
      { name: "opencode", command: "opencode" },
    ]);
  });

  it("terminalLaunchers round-trips entries, order, names and commands", () => {
    // Deliberately unlike the default in every respect a JSON codec could lose:
    // a different order, a name that is not its command, and commands carrying
    // arguments and spaces.
    const launchers = [
      { name: "opencode", command: "opencode" },
      { name: "resume", command: "codex resume --last" },
      { name: "claude", command: "claude --dangerously-skip-permissions" },
    ];

    writePreference(preferences.terminalLaunchers, launchers);

    expect(readPreference(preferences.terminalLaunchers)).toEqual(launchers);
  });

  it("answerComposerEnabled defaults to on", () => {
    expect(readPreference(preferences.answerComposerEnabled)).toBe(true);
  });

  it("answerComposerHeight is the first pane measurement declared non-portable", () => {
    const def = keyOf("speech.answerComposer.height");
    expect(def.portable).toBe(false);
    // The local tier, not the narrower session one: a remembered height should
    // survive closing the browser.
    expect(def.browserStore).toBeUndefined();

    writePreference(preferences.answerComposerHeight, 120, ALPHA);

    // On this machine, and nowhere else — the workspace file is untouched.
    // The stored key carries the project it was measured in, because the
    // declaration is `project`-scoped.
    expect(localStorage.getItem(`speech.answerComposer.height@${ALPHA}`)).toBe("120");
    expect(globals.__PAVILIO_PREFS__).toEqual({ version: 1 });
  });
});

/**
 * The speech surface's two heights, read and written the way the panes do.
 *
 * Asserted through the store rather than off the declaration table above: that
 * the scope reads `"project"` is a fact about the table, while "a height
 * measured in one project leaves the other one's alone" is a fact about what a
 * reader gets, and only a write followed by two reads proves it.
 */
describe("the answer surface's heights are kept per project", () => {
  beforeEach(() => {
    globals.__PAVILIO_PREFS__ = { version: 1 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });

  afterEach(() => {
    delete globals.__PAVILIO_PREFS__;
    localStorage.clear();
    sessionStorage.clear();
    __resetPreferenceStoreForTests();
    vi.unstubAllGlobals();
  });

  it("keeps a composer height per project", () => {
    writePreference(preferences.answerComposerHeight, 148, ALPHA);

    expect(readPreference(preferences.answerComposerHeight, ALPHA)).toBe(148);
    // The other project never asked for a taller box, and does not get one.
    expect(readPreference(preferences.answerComposerHeight, BETA)).toBe(62);
    // The project is in the KEY, which is the mechanism that keeps them apart
    // — asserted so that a scope quietly reverted to `global` fails here with
    // the reason rather than only as a puzzling shared height.
    expect(localStorage.getItem(`speech.answerComposer.height@${ALPHA}`)).toBe("148");
    expect(localStorage.getItem("speech.answerComposer.height")).toBeNull();
  });

  it("keeps an answer pane height per project", () => {
    writePreference(preferences.answerPaneHeight, 412, ALPHA);

    expect(readPreference(preferences.answerPaneHeight, ALPHA)).toBe(412);
    // 4000 is the declared "full", written out rather than read back off the
    // declaration: comparing the registry against itself would assert nothing.
    expect(readPreference(preferences.answerPaneHeight, BETA)).toBe(4000);
    expect(localStorage.getItem(`speech.answerPane.height@${ALPHA}`)).toBe("412");
    expect(localStorage.getItem("speech.answerPane.height")).toBeNull();
  });

  it("writes neither height to the portable document", () => {
    writePreference(preferences.answerComposerHeight, 148, ALPHA);
    writePreference(preferences.answerPaneHeight, 412, ALPHA);

    // Becoming `project`-scoped is a change to how many of these a browser
    // keeps, never to whether one of them travels. A height measured against
    // this window is a lie on a machine with a different one, so the workspace
    // file stays exactly as it booted.
    expect(globals.__PAVILIO_PREFS__).toEqual({ version: 1 });
    expect(keyOf("speech.answerComposer.height").portable).toBe(false);
    expect(keyOf("speech.answerPane.height").portable).toBe(false);
  });

  it("falls back to the declared default for a project with nothing stored", () => {
    // A project the user has never dragged either handle in reads the
    // declared defaults — 62, the two-line box, and the word "full" — rather
    // than inheriting whatever the last project was left at.
    expect(readPreference(preferences.answerComposerHeight, BETA)).toBe(62);
    expect(readPreference(preferences.answerPaneHeight, BETA)).toBe(4000);

    writePreference(preferences.answerComposerHeight, 148, ALPHA);
    writePreference(preferences.answerPaneHeight, 412, ALPHA);

    expect(readPreference(preferences.answerComposerHeight, BETA)).toBe(62);
    expect(readPreference(preferences.answerPaneHeight, BETA)).toBe(4000);
  });
});
