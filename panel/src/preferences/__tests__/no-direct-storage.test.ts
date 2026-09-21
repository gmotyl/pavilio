import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writeLastPath, writeLastSectionFile } from "../../features/shell/lastPath";

/**
 * The migration's one structural guard: a feature must not reach browser
 * storage behind the registry's back, because a key written raw has no
 * declaration, no default and no portability decision — and so cannot be
 * seeded, synced or kept out of the committed file.
 *
 * It walks the real directory tree rather than a list of modules: a list only
 * guards the files someone remembered to add to it, and a new hook reaching
 * for `localStorage` is exactly the case this has to catch. The file counts
 * below are asserted for the same reason — a glob that silently matches
 * nothing would turn this into a test that can only pass.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Call sites inside these trees whose declaration belongs to a later task, kept
 * raw on purpose so this commit does not desync a reader from writers it does
 * not own. Matched on the OLD key each one names, not on the file, so anything
 * else in the same module is still guarded.
 */
const PENDING_MIGRATIONS = [
  // LeftSidebar reads and writes the focused session; every other writer of it
  // (useTerminalSessions, createTerminalSession, QuickTerminalModal,
  // TerminalsSurface) is Task 8's, and they have to move together.
  { marker: "panel-terminal-focus-", task: "Task 8 — terminal" },
  // The repo-search "branch-diff" scope reads the base GitBranchDiff writes;
  // GitBranchDiff is Task 7's.
  { marker: "panel-branch-diff-base-", task: "Task 7 — git" },
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(SRC, dir), { withFileTypes: true })) {
    if (entry.name === "__tests__") continue;
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sourceFiles(child));
    else if (/\.tsx?$/.test(entry.name)) found.push(child);
  }
  return found;
}

/**
 * Comment lines removed, so prose about `localStorage` — of which the shell has
 * plenty — is not mistaken for a call. Line-based on purpose: stripping block
 * comments by regex would eat any code that merely contains `/*` in a string.
 */
function withoutComments(source: string): string[] {
  return source.split("\n").map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
    return line.replace(/\/\/.*$/, "");
  });
}

interface Offence {
  file: string;
  line: number;
  text: string;
}

function rawStorageUses(dir: string, pattern: RegExp): { files: string[]; offences: Offence[] } {
  const files = sourceFiles(dir);
  const offences: Offence[] = [];

  for (const file of files) {
    const lines = withoutComments(readFileSync(join(SRC, file), "utf8"));
    lines.forEach((line, index) => {
      if (!pattern.test(line)) return;
      // A call can wrap across lines, so the pending marker is looked for in the
      // statement, not just the line the identifier lands on.
      const statement = lines.slice(index, index + 3).join(" ");
      if (PENDING_MIGRATIONS.some((pending) => statement.includes(pending.marker))) return;
      offences.push({ file, line: index + 1, text: line.trim() });
    });
  }

  return { files, offences };
}

function report(offences: Offence[]): string[] {
  return offences.map((o) => `${o.file}:${o.line} ${o.text}`);
}

describe("preferences replace raw browser storage", () => {
  it("no module under features/shell or features/projects references localStorage directly", () => {
    const shell = rawStorageUses("features/shell", /\blocalStorage\b/);
    const projects = rawStorageUses("features/projects", /\blocalStorage\b/);

    expect(shell.files.length).toBeGreaterThanOrEqual(15);
    expect(projects.files.length).toBeGreaterThanOrEqual(25);
    expect(report([...shell.offences, ...projects.offences])).toEqual([]);
  });

  it("no module under features/shell references sessionStorage directly", () => {
    const shell = rawStorageUses("features/shell", /\bsessionStorage\b/);

    expect(shell.files.length).toBeGreaterThanOrEqual(15);
    expect(report(shell.offences)).toEqual([]);
  });

  it("a navigation bookmark does not survive into localStorage", () => {
    writeLastPath("pavilio", "/project/pavilio/notes?note=a.md");
    writeLastSectionFile("pavilio", "plans", "/abs/plan.md");

    expect(sessionStorage.length).toBeGreaterThan(0);
    expect(localStorage.length).toBe(0);
  });
});

describe("the pending call sites are declared, not forgotten", () => {
  it("names the task that owns every raw key still allowed", () => {
    const offenders = [
      ...rawStorageUses("features/shell", /\blocalStorage\b/).files,
      ...rawStorageUses("features/projects", /\blocalStorage\b/).files,
    ].filter((file) => {
      const source = withoutComments(readFileSync(join(SRC, file), "utf8")).join("\n");
      return PENDING_MIGRATIONS.some((pending) => source.includes(pending.marker));
    });

    // Both of them, and nothing else: a third file appearing here means a raw
    // key was waved through under a marker that was never meant to cover it.
    expect(offenders.map((file) => relative("features", file)).sort()).toEqual([
      "projects/useRepoSearch.ts",
      "shell/LeftSidebar.tsx",
    ]);
  });
});
