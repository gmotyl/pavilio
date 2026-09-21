import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

interface PendingMigration {
  /** The OLD raw key the exempt call site names. */
  marker: string;
  /** The task that owns moving it. */
  task: string;
}

/**
 * Call sites inside these trees whose declaration belongs to a later task, kept
 * raw on purpose so this commit does not desync a reader from writers it does
 * not own. Matched on the OLD key each one names, not on the file, so anything
 * else in the same module is still guarded.
 *
 * EMPTY, AND DELIBERATELY STILL HERE. The last entry —
 * `panel-terminal-focus-`, which held `LeftSidebar`'s read and write open while
 * Task 8 owned every other writer of the focused session — went with Task 8.
 * The mechanism is kept rather than deleted along with its last entry: the
 * migration is not finished (the time call sites are Task 8b's), and the next
 * task to split a reader from its writers needs exactly this window. Keeping it
 * costs one empty array; re-deriving it under time pressure costs the review
 * that found the two-line-lookahead bug below.
 *
 * `offendingLines` therefore takes the list as a PARAMETER, defaulting to this
 * one. That is what lets "the exemption window" go on proving the window's
 * shape against its own fixture list while the shipped list is empty — the
 * alternative was deleting the tests that cover the machinery, which is how a
 * latent bug gets re-introduced the first time an entry comes back.
 */
const PENDING_MIGRATIONS: readonly PendingMigration[] = [];

/**
 * The one narrow exemption in `features/time`, named file by file rather than
 * by key or by directory.
 *
 * `pavilio.time.<project>` is the busy ACCUMULATOR: minutes worked today, data
 * rather than a preference, deliberately undeclared and deliberately raw. It
 * is per-machine, rewritten every minute, and has no business in a committed
 * workspace file. `useBusyAccumulator` reads and writes it, and
 * `TimeTrackingProvider` scans the same prefix to discover which projects have
 * state from earlier in the day.
 *
 * Everything else under `features/time` is guarded, which is what keeps this
 * an exemption rather than a hole: `ReportBlock` and `ManualEntryForm` live in
 * the same tree, and a raw call reintroduced in either one is an offence here.
 */
const ACCUMULATOR_FILES: readonly string[] = [
  "features/time/useBusyAccumulator.ts",
  "features/time/TimeTrackingProvider.tsx",
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
export function offendingLines(
  source: string,
  pattern: RegExp,
  pending: readonly PendingMigration[] = PENDING_MIGRATIONS,
): number[] {
  const lines = withoutComments(source);
  const found: number[] = [];
  lines.forEach((line, index) => {
    if (!pattern.test(line)) return;
    if (pending.some((entry) => statementAt(lines, index).includes(entry.marker))) return;
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

/**
 * A stand-in for a real entry, so the window keeps being proved while the
 * shipped list is empty. Deleting these tests along with the last entry would
 * retire the only cover the machinery has — and the bug the second one catches
 * was a live one, not a hypothetical.
 */
const FIXTURE_PENDING: readonly PendingMigration[] = [
  { marker: "panel-example-pending-", task: "a hypothetical later task" },
];

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
      "readFocus(`panel-example-pending-${project}`);",
    ].join("\n");

    expect(offendingLines(source, /\blocalStorage\b/, FIXTURE_PENDING)).toEqual([1]);
  });

  it("still excuses a call whose own statement wraps onto the marker line", () => {
    const source = [
      "const focused = localStorage.getItem(",
      "  `panel-example-pending-${project}`,",
      ");",
    ].join("\n");

    expect(offendingLines(source, /\blocalStorage\b/, FIXTURE_PENDING)).toEqual([]);
  });

  /**
   * The only assertion left that the SHIPPED list is empty.
   *
   * "names the task that owns every raw key still allowed" used to say it too,
   * and was removed here: with `PENDING_MIGRATIONS` empty both of its sides
   * reduced to `expect([]).toEqual([])`, so it could not fail. Everything it
   * covered is covered twice over — the emptiness by this test, the marker
   * machinery by the two `FIXTURE_PENDING` tests above, and "a raw key is an
   * offence" by every tree test below.
   */
  it("excuses nothing at all now that the shipped list is empty", () => {
    const source = ["const focused = localStorage.getItem(", '  "anything",', ");"].join("\n");

    expect(PENDING_MIGRATIONS).toEqual([]);
    expect(offendingLines(source, /\blocalStorage\b/)).toEqual([1]);
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
    const terminal = sourceFiles("features/terminal");
    const speech = sourceFiles("features/speech");
    const time = sourceFiles("features/time");

    expect(shell.length).toBe(countSourceFiles("features/shell"));
    expect(projects.length).toBe(countSourceFiles("features/projects"));
    expect(git.length).toBe(countSourceFiles("features/git"));
    expect(search.length).toBe(countSourceFiles("features/search"));
    expect(terminal.length).toBe(countSourceFiles("features/terminal"));
    expect(speech.length).toBe(countSourceFiles("features/speech"));
    expect(time.length).toBe(countSourceFiles("features/time"));
    // Not merely non-empty: the trees are large, and a walk that stopped at
    // the first directory would still clear a floor.
    expect(shell.length).toBeGreaterThanOrEqual(21);
    expect(projects.length).toBeGreaterThanOrEqual(35);
    expect(git.length).toBeGreaterThanOrEqual(12);
    expect(search.length).toBeGreaterThanOrEqual(3);
    expect(terminal.length).toBeGreaterThanOrEqual(50);
    expect(speech.length).toBeGreaterThanOrEqual(16);
    expect(time.length).toBeGreaterThanOrEqual(12);
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

  it("no module under features/terminal or features/speech references localStorage directly", () => {
    const terminal = rawStorageUses("features/terminal", /\blocalStorage\b/);
    const speech = rawStorageUses("features/speech", /\blocalStorage\b/);

    expect(report([...terminal.offences, ...speech.offences])).toEqual([]);
  });

  it("no module under features/terminal or features/speech references sessionStorage directly", () => {
    const terminal = rawStorageUses("features/terminal", /\bsessionStorage\b/);
    const speech = rawStorageUses("features/speech", /\bsessionStorage\b/);

    expect(report([...terminal.offences, ...speech.offences])).toEqual([]);
  });

  it("no module under features/time references localStorage except the busy accumulator", () => {
    const time = rawStorageUses("features/time", /\blocalStorage\b/);
    const exempt = (offence: Offence): boolean =>
      ACCUMULATOR_FILES.includes(offence.file);

    expect(report(time.offences.filter((offence) => !exempt(offence)))).toEqual(
      [],
    );
    // The exemption is narrow because it is also REAL: both named files do
    // reach `localStorage`, so an empty offence list here would mean the walk
    // found nothing rather than that the guard held.
    expect(
      ACCUMULATOR_FILES.filter((file) =>
        time.offences.some((offence) => offence.file === file),
      ),
    ).toEqual(ACCUMULATOR_FILES);
  });

  it("no module under features/time references sessionStorage directly", () => {
    // Nothing on the Time tab is session-scoped; the accumulator is not
    // exempt here, because it uses the local tier and nothing else should
    // reach for the narrower one unnoticed.
    const time = rawStorageUses("features/time", /\bsessionStorage\b/);

    expect(report(time.offences)).toEqual([]);
  });

  /**
   * The evasion the guard's own preamble names: a helper module that wraps
   * storage. `features/speech/voices.ts` exported exactly that —
   * `getBrowserStorage()` — and `autoOpenAnswer.ts` imported it, so a plain
   * `localStorage` grep counted two modules short. The helper is gone rather
   * than re-pointed at the registry, and this is what says so: the identifier
   * must not appear ANYWHERE under `src`, definition included, because a
   * surviving definition is an invitation to import it again.
   */
  it("no module reaches storage through getBrowserStorage once the migration lands", () => {
    const { offences } = rawStorageUses(".", /\bgetBrowserStorage\b/);

    expect(report(offences)).toEqual([]);
  });

  it("a navigation bookmark does not survive into localStorage", () => {
    writeLastPath("pavilio", "/project/pavilio/notes?note=a.md");
    writeLastSectionFile("pavilio", "plans", "/abs/plan.md");

    expect(sessionStorage.length).toBeGreaterThan(0);
    expect(localStorage.length).toBe(0);
  });
});
