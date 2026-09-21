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
 * for `localStorage` is exactly the case this has to catch. The enumeration is
 * asserted against an independent count for the same reason — a walk that
 * silently matched nothing would turn this into a test that can only pass.
 *
 * WHAT THIS GUARD CANNOT SEE. It is a grep, and two evasions are out of its
 * reach on purpose rather than by oversight:
 *
 * - a computed access — `const LS = "local" + "Storage"; globalThis[LS]` — has
 *   no `localStorage` token to match;
 * - a helper module that wraps storage and is imported. The call site then
 *   names the helper, not the store, and only the helper's own module (which
 *   may live outside these two trees) would be flagged.
 *
 * Catching either needs a type-aware pass over the module graph, not a line
 * scan. Read a green here as "no module under these trees says `localStorage`
 * out loud", not as "no module under these trees reaches browser storage".
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

/**
 * 1-based line numbers of the raw storage uses in `source` that no pending
 * marker excuses. Exported shape rather than inlined into the walk so the
 * exemption window itself can be probed — see "the exemption window".
 */
export function offendingLines(source: string, pattern: RegExp): number[] {
  const lines = withoutComments(source);
  const found: number[] = [];
  lines.forEach((line, index) => {
    if (!pattern.test(line)) return;
    if (PENDING_MIGRATIONS.some((pending) => statementAt(lines, index).includes(pending.marker)))
      return;
    found.push(index + 1);
  });
  return found;
}

/**
 * The statement the identifier at `index` sits in: that line, plus following
 * lines up to and including the first one that closes a statement.
 *
 * A call can wrap across lines, so the pending marker has to be looked for
 * past the identifier's own line — `localStorage.getItem(` and the key it
 * reads are two lines apart in `useRepoSearch`. But the window has to STOP at
 * the statement boundary: a fixed three-line lookahead also swallowed the two
 * lines above any marker, so a brand-new raw call placed just before one was
 * waved through, inside exactly the two files a maintainer will touch next.
 */
function statementAt(lines: string[], index: number): string {
  const parts: string[] = [];
  for (let i = index; i < lines.length; i += 1) {
    parts.push(lines[i]);
    if (lines[i].includes(";")) break;
  }
  return parts.join(" ");
}

function rawStorageUses(dir: string, pattern: RegExp): { files: string[]; offences: Offence[] } {
  const files = sourceFiles(dir);
  const offences: Offence[] = [];

  for (const file of files) {
    const source = readFileSync(join(SRC, file), "utf8");
    const lines = withoutComments(source);
    for (const line of offendingLines(source, pattern)) {
      offences.push({ file, line, text: lines[line - 1].trim() });
    }
  }

  return { files, offences };
}

function report(offences: Offence[]): string[] {
  return offences.map((o) => `${o.file}:${o.line} ${o.text}`);
}

describe("the exemption window", () => {
  /**
   * The window must not reach past the statement the identifier sits in. A
   * fixed N-line lookahead exempts a raw call that merely happens to sit a
   * couple of lines ABOVE an unrelated use of a pending marker — inside
   * exactly the two files a maintainer will touch next.
   */
  it("does not excuse a raw call two lines above an unrelated marker", () => {
    const source = [
      'localStorage.setItem("panel-brand-new-key", value);',
      "doSomethingElse();",
      "readFocus(`panel-terminal-focus-${project}`);",
    ].join("\n");

    expect(offendingLines(source, /\blocalStorage\b/)).toEqual([1]);
  });

  it("still excuses a call whose own statement wraps onto the marker line", () => {
    const source = [
      "const focused = localStorage.getItem(",
      "  `panel-terminal-focus-${project}`,",
      ");",
    ].join("\n");

    expect(offendingLines(source, /\blocalStorage\b/)).toEqual([]);
  });
});

/**
 * An independent count of the `.tsx?` files under `dir`, walked here rather
 * than by `sourceFiles`, so the enumeration is checked against something other
 * than itself. A floor alone is decorative: every file under
 * `features/projects` is top-level, so no plausible way for the walk to break
 * lands between a floor of 25 and the real 35 — it would drop to zero.
 */
function countSourceFiles(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(join(SRC, dir), { withFileTypes: true })) {
    if (entry.name === "__tests__") continue;
    if (entry.isDirectory()) total += countSourceFiles(`${dir}/${entry.name}`);
    else if (/\.tsx?$/.test(entry.name)) total += 1;
  }
  return total;
}

describe("the enumeration the guard rests on", () => {
  it("finds every source file in both trees, nested ones included", () => {
    const shell = sourceFiles("features/shell");
    const projects = sourceFiles("features/projects");
    const git = sourceFiles("features/git");
    const search = sourceFiles("features/search");

    expect(shell.length).toBe(countSourceFiles("features/shell"));
    expect(projects.length).toBe(countSourceFiles("features/projects"));
    expect(git.length).toBe(countSourceFiles("features/git"));
    expect(search.length).toBe(countSourceFiles("features/search"));
    // Not merely non-empty: the trees are large, and a walk that stopped at
    // the first directory would still clear a floor.
    expect(shell.length).toBeGreaterThanOrEqual(21);
    expect(projects.length).toBeGreaterThanOrEqual(35);
    expect(git.length).toBeGreaterThanOrEqual(12);
    expect(search.length).toBeGreaterThanOrEqual(3);
    // `features/shell` has subdirectories (Layout, Breadcrumbs); a walk that
    // did not descend would miss them and this is what says so.
    expect(shell.some((file) => file.split("/").length > 3)).toBe(true);
  });
});

describe("preferences replace raw browser storage", () => {
  it("no module under features/shell or features/projects references localStorage directly", () => {
    const shell = rawStorageUses("features/shell", /\blocalStorage\b/);
    const projects = rawStorageUses("features/projects", /\blocalStorage\b/);

    expect(report([...shell.offences, ...projects.offences])).toEqual([]);
  });

  it("no module under features/git or features/search references localStorage directly", () => {
    const git = rawStorageUses("features/git", /\blocalStorage\b/);
    const search = rawStorageUses("features/search", /\blocalStorage\b/);

    expect(report([...git.offences, ...search.offences])).toEqual([]);
  });

  it("no module under features/git or features/search references sessionStorage directly", () => {
    const git = rawStorageUses("features/git", /\bsessionStorage\b/);
    const search = rawStorageUses("features/search", /\bsessionStorage\b/);

    expect(report([...git.offences, ...search.offences])).toEqual([]);
  });

  it("no module under features/shell or features/projects references sessionStorage directly", () => {
    // Both trees, not just the shell: `features/projects` reaches navigation
    // memory too (`useReposTabMemory`, the section-file bookmarks), and the
    // session tier is exactly where a raw call would look harmless.
    const shell = rawStorageUses("features/shell", /\bsessionStorage\b/);
    const projects = rawStorageUses("features/projects", /\bsessionStorage\b/);

    expect(report([...shell.offences, ...projects.offences])).toEqual([]);
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
      ...rawStorageUses("features/git", /\blocalStorage\b/).files,
      ...rawStorageUses("features/search", /\blocalStorage\b/).files,
    ].filter((file) => {
      const source = withoutComments(readFileSync(join(SRC, file), "utf8")).join("\n");
      return PENDING_MIGRATIONS.some((pending) => source.includes(pending.marker));
    });

    // That one, and nothing else: a second file appearing here means a raw key
    // was waved through under a marker that was never meant to cover it.
    // `useRepoSearch` used to sit here too — Task 7 owns the writer of the
    // branch-diff base now, so reader and writer moved together and the
    // exemption went with them.
    expect(offenders.map((file) => relative("features", file)).sort()).toEqual([
      "shell/LeftSidebar.tsx",
    ]);
  });
});
