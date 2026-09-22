import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writeLastPath, writeLastSectionFile } from "../../features/shell/lastPath";

/**
 * The migration's one structural guard: nothing under `src` may reach browser
 * storage behind the registry's back, because a key written raw has no
 * declaration, no default and no portability decision — and so cannot be
 * seeded, synced or kept out of the committed file.
 *
 * It walks the real directory tree rather than a list of modules, and it
 * DISCOVERS the trees it walks rather than naming them. Both for the same
 * reason: a list only guards what someone remembered to add to it. The
 * hand-written version covered seven feature directories in arbitrary pairs,
 * which left `src/components`, `src/pages`, `src/hooks`, `src/lib` and half of
 * `features/` unguarded — clean at the time, and silently open to the next raw
 * call. Coverage now falls out of `readdirSync`, so a directory added tomorrow
 * is guarded the moment it exists. The enumeration is asserted against an
 * independent count for the matching reason — a walk that silently matched
 * nothing would turn this into a test that can only pass.
 *
 * `preferences/` itself is the one tree left out: it IS the storage tier, and
 * `store.ts` is the single module allowed to say `localStorage` out loud and
 * the single one allowed to name the `/api/preferences` route.
 *
 * WHAT THIS GUARD CANNOT SEE. It is a grep, and three evasions are out of its
 * reach on purpose rather than by oversight:
 *
 * - a computed access — `const LS = "local" + "Storage"; globalThis[LS]` — has
 *   no `localStorage` token to match;
 * - a helper module that wraps storage and is imported. The call site then
 *   names the helper, not the store — though now that the walk covers all of
 *   `src`, the helper's own module is at least always flagged wherever it
 *   lives;
 * - the exemption window is a BOUNDED line scan, not a parse. `statementAt`
 *   takes the offending line plus at most `STATEMENT_LOOKAHEAD - 1` more,
 *   stopping at the first `;`. A statement needs no semicolon (ASI), so a raw
 *   call written without one still drags the next few lines into its window
 *   and is excused by a marker sitting in them — it merely can no longer be
 *   excused by a marker anywhere later in the FILE, which is what an unbounded
 *   scan allowed. In the other direction, a genuine call whose statement wraps
 *   past the window loses its exemption and reads as an offence; that failure
 *   is loud, and the fix is to shorten the statement.
 *
 * Catching any of them needs a type-aware pass over the module graph, not a
 * line scan. Read a green here as "no module under `src` says `localStorage`
 * out loud", not as "no module under `src` reaches browser storage".
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Anything that excuses a raw storage statement does so by naming a token the
 * statement must contain. Both exemption lists below are of this shape, and
 * `offendingLines` takes either.
 */
interface StatementMarker {
  marker: string;
}

interface PendingMigration extends StatementMarker {
  /** The OLD raw key the exempt call site names. */
  marker: string;
  /** The task that owns moving it. */
  task: string;
}

interface StatementExemption extends StatementMarker {
  /** The identifier the exempt statement must name. */
  marker: string;
  /** Why this statement is allowed to stay raw, forever rather than for a task. */
  why: string;
}

/**
 * Call sites whose declaration belongs to a later task, kept raw on purpose so
 * this commit does not desync a reader from writers it does not own. Matched on
 * the OLD key each one names, not on the file, so anything else in the same
 * module is still guarded.
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
 * The one narrow exemption in `features/time`, matched on the STATEMENT, the
 * same way `PENDING_MIGRATIONS` is.
 *
 * `pavilio.time.<project>` is the busy ACCUMULATOR: minutes worked today, data
 * rather than a preference, deliberately undeclared and deliberately raw. It
 * is per-machine, rewritten every minute, and has no business in a committed
 * workspace file. `useBusyAccumulator` reads and writes it, and
 * `TimeTrackingProvider` scans the same prefix to discover which projects have
 * state from earlier in the day.
 *
 * IT USED TO EXEMPT THE TWO FILES WHOLE, AND THAT WAS A HOLE. A reviewer added
 * `localStorage.setItem("pavilio.pref.sneaky", v)` to EITHER of them and the
 * guard stayed green — and those are precisely the two files a time-tracking
 * change touches. Matching the statement instead means the exemption covers
 * the accumulator's own two accessors and nothing else: a raw call anywhere
 * else in either file, under any key, is an offence. The markers are the
 * identifiers the accumulator's own code uses for its key and its store, so
 * renaming either turns this red rather than quietly widening it.
 *
 * It applies to ONE tree and ONE tier — `features/time`, `localStorage` — and
 * `exemptionsFor` is what keeps it there. The accumulator lives in the local
 * tier, so nothing on the Time tab may reach the narrower session tier
 * unnoticed either.
 */
const ACCUMULATOR_EXEMPTIONS: readonly StatementExemption[] = [
  {
    marker: "accumulatorKey(",
    why: "useBusyAccumulator's own `pavilio.time.<project>` key helper",
  },
  {
    marker: "accumulatorStorage",
    why: "TimeTrackingProvider's alias for the store it scans for `pavilio.time.` keys",
  },
];

/** The two files the accumulator exemption is expected to (and may only) cover. */
const ACCUMULATOR_FILES: readonly string[] = [
  "features/time/TimeTrackingProvider.tsx",
  "features/time/useBusyAccumulator.ts",
];

/**
 * The storage tier itself — the one tree the sweep skips, because it is what
 * every other tree is required to go through.
 */
const STORAGE_TIER_DIR = "preferences";

/**
 * Not app code, and named here because it does not fall out of the `__tests__`
 * skip: `test-setup.ts` sits directly under `src` and INSTALLS the in-memory
 * `localStorage` / `sessionStorage` the whole suite runs against, so it names
 * both by definition.
 */
const HARNESS_MODULES: ReadonlySet<string> = new Set(["test-setup.ts"]);

/** Label for the loose `.ts`/`.tsx` files sitting directly under `src`. */
const ROOT_TREE = "src/*";

function sourceFiles(dir: string, recurse = true): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(SRC, dir), { withFileTypes: true })) {
    if (entry.name === "__tests__") continue;
    const child = dir === "." ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (recurse) found.push(...sourceFiles(child));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (HARNESS_MODULES.has(child)) continue;
    found.push(child);
  }
  return found;
}

/**
 * Every tree the storage sweep covers, discovered rather than listed.
 *
 * `features/` is expanded one level, so each feature is its own case and a
 * failure names the feature rather than the whole tree. Everything else under
 * `src` is a tree in its own right, plus `ROOT_TREE` for the loose files beside
 * them — `App.tsx` and `main.tsx` are app code and were guarded by nothing.
 */
function guardedTrees(): string[] {
  const trees: string[] = [ROOT_TREE];
  for (const entry of readdirSync(SRC, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "__tests__" || entry.name === STORAGE_TIER_DIR) continue;
    if (entry.name !== "features") {
      trees.push(entry.name);
      continue;
    }
    for (const feature of readdirSync(join(SRC, "features"), { withFileTypes: true })) {
      if (feature.isDirectory() && feature.name !== "__tests__") {
        trees.push(`features/${feature.name}`);
      }
    }
  }
  return trees;
}

/** The source files a guarded tree owns. `ROOT_TREE` owns only `src`'s loose files. */
function filesIn(tree: string): string[] {
  return tree === ROOT_TREE ? sourceFiles(".", false) : sourceFiles(tree);
}

/**
 * Comment lines removed, so prose about `localStorage` — of which the shell has
 * plenty — is not mistaken for a call. Line-based on purpose: stripping block
 * comments by regex would eat any code that merely contains a comment opener in
 * a string.
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
  pending: readonly StatementMarker[] = PENDING_MIGRATIONS,
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
 * The hard ceiling on the exemption window: the offending line plus three
 * more. The longest real wrapped call in any tree is three lines
 * (`localStorage.getItem(` / key / `);`), so this clears every genuine one with
 * a line to spare.
 */
const STATEMENT_LOOKAHEAD = 4;

/**
 * The statement the identifier at `index` sits in: that line, plus following
 * lines up to and including the first one that closes a statement — and never
 * more than `STATEMENT_LOOKAHEAD` lines in total.
 *
 * A call can wrap across lines, so the pending marker has to be looked for
 * past the identifier's own line — `localStorage.getItem(` and the key it
 * reads can be two lines apart. But the window has to STOP:
 *
 * - at the statement boundary, because a fixed lookahead also swallowed the
 *   lines above any marker, so a brand-new raw call placed just before one was
 *   waved through, inside exactly the two files a maintainer will touch next;
 * - and at a fixed ceiling anyway, because the `;` may never come. A statement
 *   needs no semicolon, and the scan ran to EOF looking for one — so a raw
 *   call written without a `;` was excused by ANY marker anywhere later in the
 *   file. Demonstrated at forty lines' distance; the test is below.
 */
function statementAt(lines: string[], index: number): string {
  const parts: string[] = [];
  const end = Math.min(lines.length, index + STATEMENT_LOOKAHEAD);
  for (let i = index; i < end; i += 1) {
    parts.push(lines[i]);
    if (lines[i].includes(";")) break;
  }
  return parts.join(" ");
}

function rawStorageUses(
  files: readonly string[],
  pattern: RegExp,
  exemptions: readonly StatementMarker[] = PENDING_MIGRATIONS,
): Offence[] {
  const offences: Offence[] = [];

  for (const file of files) {
    const source = readFileSync(join(SRC, file), "utf8");
    const lines = withoutComments(source);
    for (const line of offendingLines(source, pattern, exemptions)) {
      offences.push({ file, line, text: lines[line - 1].trim() });
    }
  }

  return offences;
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

  /**
   * ASI. A statement needs no semicolon, and the scan looked for one all the
   * way to EOF — so a raw call written without one was excused by ANY pending
   * marker anywhere later in the file, however far away.
   */
  it("does not excuse a semicolonless raw call by a marker 40 lines later", () => {
    const source = [
      'localStorage.setItem("panel-brand-new-key", value)',
      ...Array.from({ length: 40 }, () => "// filler"),
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
   * offence" by every tree case below.
   */
  it("excuses nothing at all now that the shipped list is empty", () => {
    const source = ["const focused = localStorage.getItem(", '  "anything",', ");"].join("\n");

    expect(PENDING_MIGRATIONS).toEqual([]);
    expect(offendingLines(source, /\blocalStorage\b/)).toEqual([1]);
  });
});

/**
 * A genuinely independent count of the `.tsx?` files under `dir`.
 *
 * It used to be a hand-rolled recursion — the same `readdirSync`, the same
 * `__tests__` skip, the same regex, the same shape as `sourceFiles` — so its
 * comment's claim that the enumeration was "checked against something other
 * than itself" was false: a bug in the walk was reproduced faithfully in its
 * own check, and both sides moved together.
 *
 * `recursive: true` hands the descent to node. There is no loop, no recursion
 * and no directory handling here to get wrong, so the two now disagree about
 * anything `sourceFiles` mis-walks — which is the whole point of the
 * assertion.
 */
function countSourceFiles(dir: string): number {
  return readdirSync(join(SRC, dir), { recursive: true, encoding: "utf8" }).filter((entry) => {
    // node joins with the platform separator; posix everywhere this runs.
    const parts = entry.split(/[\\/]/);
    return (
      /\.tsx?$/.test(entry) && !parts.includes("__tests__") && !HARNESS_MODULES.has(parts.join("/"))
    );
  }).length;
}

describe("the enumeration the guard rests on", () => {
  /**
   * The staleness assertion, and the reason the sweep below can be trusted to
   * cover a directory nobody remembered: every source file under `src` is
   * either owned by exactly one guarded tree or by the storage tier. A new
   * directory lands in `guardedTrees` on its own; a walk that stopped
   * descending, or a tree that quietly stopped being enumerated, makes these
   * two totals disagree.
   */
  it("partitions every source file under src into a guarded tree or the storage tier", () => {
    const guarded = guardedTrees().flatMap(filesIn);
    const tier = sourceFiles(STORAGE_TIER_DIR);

    // No file counted twice — the trees are disjoint.
    expect(new Set([...guarded, ...tier]).size).toBe(guarded.length + tier.length);
    // And none missed.
    expect(guarded.length + tier.length).toBe(countSourceFiles("."));
  });

  it("discovers the trees rather than listing them", () => {
    const trees = guardedTrees();

    // The seven the hand-written version happened to name...
    for (const tree of [
      "features/shell",
      "features/projects",
      "features/git",
      "features/search",
      "features/terminal",
      "features/speech",
      "features/time",
    ]) {
      expect(trees).toContain(tree);
    }
    // ...and the ones it did not, which a new raw call used to walk straight
    // past. These are named as documentation of the widening, not as the
    // mechanism: the mechanism is `readdirSync`.
    for (const tree of [
      ROOT_TREE,
      "components",
      "pages",
      "hooks",
      "lib",
      "features/explorer",
      "features/markdown",
      "features/auth",
      "features/mobile-auth",
      "features/realtime",
    ]) {
      expect(trees).toContain(tree);
    }
    expect(trees).not.toContain(STORAGE_TIER_DIR);
  });

  it("descends into nested directories", () => {
    // `features/shell` has subdirectories (Layout, Breadcrumbs); a walk that
    // did not descend would miss them and this is what says so.
    expect(filesIn("features/shell").some((file) => file.split("/").length > 3)).toBe(true);
    // And `ROOT_TREE` must NOT descend, or it would swallow every other tree.
    expect(filesIn(ROOT_TREE).every((file) => !file.includes("/"))).toBe(true);
  });
});

const STORAGE_TIERS = [
  { tier: "localStorage", pattern: /\blocalStorage\b/ },
  { tier: "sessionStorage", pattern: /\bsessionStorage\b/ },
] as const;

/**
 * The accumulator is the only standing exemption, and it belongs to one tree
 * and one tier. Everything else gets the shipped pending list, which is empty.
 */
function exemptionsFor(tree: string, tier: string): readonly StatementMarker[] {
  return tree === "features/time" && tier === "localStorage"
    ? [...PENDING_MIGRATIONS, ...ACCUMULATOR_EXEMPTIONS]
    : PENDING_MIGRATIONS;
}

const SWEEP = guardedTrees().flatMap((tree) =>
  STORAGE_TIERS.map(({ tier, pattern }) => ({ tree, tier, pattern })),
);

describe("preferences replace raw browser storage", () => {
  it.each(SWEEP)("no module under $tree references $tier directly", ({ tree, tier, pattern }) => {
    const files = filesIn(tree);

    // Non-vacuity, per case: a tree that enumerated nothing would pass by
    // finding nothing, and the sweep would grow a silent hole one directory
    // wide the first time a walk broke.
    expect(files.length).toBeGreaterThan(0);
    expect(report(rawStorageUses(files, pattern, exemptionsFor(tree, tier)))).toEqual([]);
  });

  it("the accumulator exemption is real, and covers only the two files it claims", () => {
    // Without the markers the tree does offend — so the green above means the
    // exemption held, not that the walk found nothing. And the offences are
    // confined to the two accumulator files: a third file reaching raw
    // storage would show up here even before its statement is judged.
    const unexempt = rawStorageUses(filesIn("features/time"), /\blocalStorage\b/, []);

    expect(unexempt.length).toBeGreaterThan(0);
    expect([...new Set(unexempt.map((offence) => offence.file))].sort()).toEqual(
      [...ACCUMULATOR_FILES].sort(),
    );
  });

  /**
   * The evasion the guard's own preamble names: a helper module that wraps
   * storage. `features/speech/voices.ts` exported exactly that —
   * `getBrowserStorage()` — and `autoOpenAnswer.ts` imported it, so a plain
   * `localStorage` grep counted two modules short. The helper is gone rather
   * than re-pointed at the registry, and this is what says so: the identifier
   * must not appear ANYWHERE under `src`, definition included and
   * `preferences/` included, because a surviving definition is an invitation
   * to import it again.
   */
  it("no module reaches storage through getBrowserStorage once the migration lands", () => {
    expect(report(rawStorageUses(sourceFiles("."), /\bgetBrowserStorage\b/))).toEqual([]);
  });

  /**
   * The server half of the same structural rule, which had no guard at all.
   *
   * Browser storage is fenced off above; the preferences ROUTE was not. A
   * feature that fetches `/api/preferences` directly bypasses the whole store
   * — the injected document, the unchanged-value skip, the debounce, the
   * in-flight/pending overlay a refetch merges against — and writes a key with
   * no declaration into the committed workspace file. Exactly the failure the
   * `localStorage` guard exists to prevent, one tier down.
   *
   * Scoped to `src`, and `preferences/` is the only tree allowed to say it:
   * `store.ts` owns both the PATCH and the script URL.
   */
  it("nothing outside preferences/ references the /api/preferences route", () => {
    const offences = rawStorageUses(sourceFiles("."), /\/api\/preferences/);
    const inStore = (offence: Offence): boolean => offence.file.startsWith(`${STORAGE_TIER_DIR}/`);

    expect(report(offences.filter((offence) => !inStore(offence)))).toEqual([]);
    // Not vacuous: `preferences/` itself must still name the route, or the
    // walk matched nothing and this proves only that the grep is broken.
    expect(offences.filter(inStore).length).toBeGreaterThan(0);
  });

  it("a navigation bookmark does not survive into localStorage", () => {
    writeLastPath("pavilio", "/project/pavilio/notes?note=a.md");
    writeLastSectionFile("pavilio", "plans", "/abs/plan.md");

    expect(sessionStorage.length).toBeGreaterThan(0);
    expect(localStorage.length).toBe(0);
  });
});
