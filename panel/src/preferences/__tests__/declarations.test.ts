import { describe, expect, it } from "vitest";
import { ALL_PREFERENCES } from "../declarations";

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
  "git.viewMode",
  "git.worktree.expanded",
  "projects.favorites",
  "repos.searchScope",
  "search.includeArchived",
  "shell.leftSidebar.expanded",
  "shell.project.expanded",
  "shell.rightSidebar.expanded",
  "shell.rightSidebar.section.expanded",
  "speech.answerPane.autoOpen",
  "speech.voice",
  "terminal.drawer.open",
  "terminal.drawer.side",
  "terminal.drawer.width",
  "terminal.maximized",
  "time.form.resetAutoOnSave",
  "time.report",
  "view.wide",
];

/** Values that name something the other machine does not have. */
const MACHINE_LOCAL = [
  "nav.lastFile",
  "nav.lastPath",
  "nav.lastReposQuery",
  "speech.armedCell",
  "terminal.focus",
  "terminal.grid",
  "terminal.order",
];

/**
 * Rows the design's portability table names that nothing declares yet: no
 * code persists or resizes them today. The two sidebar widths arrive with
 * `2026-09-21-panel-ui-polish` Task 4 (defaults 240 and 264); the git-history
 * tree's width arrives with its Task 3. Listed here so declaring them is a
 * one-line move into PORTABLE rather than a spurious red — which is exactly
 * what `fileList.paneWidth` has just been.
 */
const NOT_YET_DECLARED = [
  "shell.leftSidebar.width",
  "shell.rightSidebar.width",
  "git.history.paneWidth",
];

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
  ["git.viewMode", "flat", "global"],
  ["git.worktree.expanded", false, "repo"],
  ["nav.lastFile", null, "project"],
  ["nav.lastPath", null, "project"],
  ["nav.lastReposQuery", null, "project"],
  ["projects.favorites", [], "global"],
  ["repos.searchScope", "changed", "global"],
  ["search.includeArchived", true, "global"],
  ["shell.leftSidebar.expanded", true, "global"],
  ["shell.project.expanded", false, "project"],
  ["shell.rightSidebar.expanded", true, "global"],
  ["shell.rightSidebar.section.expanded", true, "project"],
  ["speech.answerPane.autoOpen", false, "global"],
  ["speech.armedCell", null, "global"],
  ["speech.voice", "en-US-AndrewMultilingualNeural", "global"],
  ["terminal.drawer.open", false, "global"],
  ["terminal.drawer.side", "left", "global"],
  ["terminal.drawer.width", 480, "global"],
  ["terminal.focus", null, "project"],
  ["terminal.grid", [], "project"],
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
