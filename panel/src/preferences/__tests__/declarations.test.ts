import { describe, expect, it } from "vitest";
import { ALL_PREFERENCES } from "../declarations";

/**
 * The portability table from `design.md`, transcribed by hand. It is
 * deliberately a second copy of the decision: reading the registry and
 * comparing it against itself would assert nothing at all.
 */
const PORTABLE = [
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

    expect(portable.sort()).toEqual([...PORTABLE].sort());
    expect(local.sort()).toEqual([...MACHINE_LOCAL].sort());
    // Nothing is declared that the table does not name.
    expect(ALL_PREFERENCES).toHaveLength(PORTABLE.length + MACHINE_LOCAL.length);
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
