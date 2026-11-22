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
    expect(newSide(parseDiff(DIFF))).toEqual(['import x from "x";', "const a = 2;", "const b = 3;", "export { a };", "// end"]);
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
});
