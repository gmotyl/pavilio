import { describe, expect, it } from "vitest";
import {
  countChanges,
  expandFolds,
  fillGaps,
  foldRows,
  gutterMarks,
  newSide,
  pairRows,
  parseDiff,
  wordMarks,
  type Row,
} from "../diffModel";

const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,4 +1,5 @@",
  " import x from \"x\";",
  "-const a = 1;",
  "+const a = 2;",
  "+const b = 3;",
  " export { a };",
  " // end",
  "\\ No newline at end of file",
].join("\n");

describe("diffModel", () => {
  it("parses a unified diff into numbered rows", () => {
    expect(parseDiff(DIFF)).toEqual([
      { kind: "ctx", old: 1, new: 1, text: 'import x from "x";' },
      { kind: "del", old: 2, text: "const a = 1;" },
      { kind: "add", new: 2, text: "const a = 2;" },
      { kind: "add", new: 3, text: "const b = 3;" },
      { kind: "ctx", old: 3, new: 4, text: "export { a };" },
      { kind: "ctx", old: 4, new: 5, text: "// end" },
    ]);
    expect(countChanges(parseDiff(DIFF))).toEqual({ add: 2, del: 1 });
    // A hunk starting past line 1 leaves a gap the diff does not carry.
    const later = parseDiff("@@ -10,2 +10,2 @@\n-a\n+b\n c");
    expect(later[0]).toEqual({ kind: "gap", count: 9, old: 1, new: 1 });
    expect(newSide(later)).toBeNull();
    // A hunk at line 1 may still omit an unchanged tail, so only a new file is known whole.
    expect(newSide(parseDiff(DIFF))).toBeNull();
    expect(newSide(parseDiff("--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1,2 @@\n+one\n+two"))).toEqual(["one", "two"]);
    // The file's content fills the gap and the tail.
    const filled = fillGaps(later, Array.from({ length: 12 }, (_, i) => `l${i + 1}`).join("\n"));
    expect(filled.filter((r) => r.kind === "gap")).toEqual([]);
    expect(filled[0]).toEqual({ kind: "ctx", old: 1, new: 1, text: "l1" });
    expect(filled.at(-1)).toEqual({ kind: "ctx", old: 12, new: 12, text: "l12" });
  });

  it("pairs deletions with additions for split rows", () => {
    expect(pairRows(parseDiff(DIFF))).toEqual([
      { kind: "ctx", left: { kind: "ctx", old: 1, new: 1, text: 'import x from "x";' }, right: { kind: "ctx", old: 1, new: 1, text: 'import x from "x";' } },
      { kind: "change", del: { kind: "del", old: 2, text: "const a = 1;" }, add: { kind: "add", new: 2, text: "const a = 2;" } },
      { kind: "change", del: undefined, add: { kind: "add", new: 3, text: "const b = 3;" } },
      { kind: "ctx", left: { kind: "ctx", old: 3, new: 4, text: "export { a };" }, right: { kind: "ctx", old: 3, new: 4, text: "export { a };" } },
      { kind: "ctx", left: { kind: "ctx", old: 4, new: 5, text: "// end" }, right: { kind: "ctx", old: 4, new: 5, text: "// end" } },
    ]);
  });

  it("folds unchanged runs longer than six lines", () => {
    const ctx = (n: number): Row => ({ kind: "ctx", old: n, new: n, text: `l${n}` });
    const rows: Row[] = [...Array.from({ length: 10 }, (_, i) => ctx(i + 1)), { kind: "add", new: 11, text: "x" }, ctx(11), ctx(12)];
    const items = foldRows(rows);
    // Leading run of 10: the 3 lines next to the change stay, 7 fold.
    expect(items[0]).toEqual({ kind: "fold", id: 0, rows: rows.slice(0, 7) });
    expect(items.slice(1, 4)).toEqual(rows.slice(7, 10));
    expect(items.length).toBe(1 + 3 + 1 + 2);
    // Runs of six or fewer never fold.
    expect(foldRows(rows.slice(4)).some((r) => r.kind === "fold")).toBe(false);
    expect(expandFolds(items, new Set([0]))).toEqual(rows);
  });

  it("marks only the changed tokens", () => {
    expect(wordMarks("const a = 1;", "const a = 2;")).toEqual({ del: [[10, 11]], add: [[10, 11]] });
    expect(wordMarks("foo(bar, baz)", "foo(bar, qux, baz)")).toEqual({ del: [], add: [[9, 14]] });
    // Nothing in common: the whole line is the change, no token marks.
    expect(wordMarks("alpha", "beta")).toEqual({ del: [], add: [] });
  });

  it("derives added, changed and removed gutter marks", () => {
    const rows = parseDiff(
      ["@@ -1,6 +1,6 @@", " a", "-b", "+B", "+new", " c", "-d", " e", " f"].join("\n"),
    );
    expect(Object.fromEntries(gutterMarks(rows))).toEqual({ 2: "changed", 3: "added", 5: "removed" });
  });

  it("numbers zero-context insertions and deletions after the named line", () => {
    // `git diff -U0`: insert new line 4 after old line 3; then delete old line 8 (after new line 8).
    const rows = parseDiff(["@@ -3,0 +4 @@", "+inserted", "@@ -8 +8,0 @@", "-dropped"].join("\n"));
    expect(rows).toEqual([
      { kind: "gap", count: 3, old: 1, new: 1 },
      { kind: "add", new: 4, text: "inserted" },
      { kind: "gap", count: 4, old: 4, new: 5 },
      { kind: "del", old: 8, text: "dropped" },
    ]);
    const content = ["l1", "l2", "l3", "inserted", "l4", "l5", "l6", "l7", "l9"].join("\n");
    const filled = fillGaps(rows, content);
    expect(filled.find((r) => r.kind === "ctx" && r.text === "l3")).toEqual({ kind: "ctx", old: 3, new: 3, text: "l3" });
    expect(filled.find((r) => r.kind === "ctx" && r.text === "l7")).toEqual({ kind: "ctx", old: 7, new: 8, text: "l7" });
    expect(filled.at(-1)).toEqual({ kind: "ctx", old: 9, new: 9, text: "l9" });
  });

  it("word marks never split a surrogate pair", () => {
    const { del, add } = wordMarks("ok 😀 done", "ok 😁 done");
    expect(del).toEqual([[3, 5]]);
    expect(add).toEqual([[3, 5]]);
  });
});
