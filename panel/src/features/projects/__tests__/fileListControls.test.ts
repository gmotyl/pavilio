import { describe, it, expect } from "vitest";
import { filterAndSortFiles } from "../fileListControls";

interface Row { name: string; mtime: number }
const rows: Row[] = [
  { name: "beta.md", mtime: 30 },
  { name: "Alpha.md", mtime: 10 },
  { name: "gamma.md", mtime: 20 },
];
const opts = (over: Partial<Parameters<typeof filterAndSortFiles<Row>>[1]>) => ({
  getName: (r: Row) => r.name,
  getMtime: (r: Row) => r.mtime,
  query: "",
  sortKey: "date" as const,
  sortDir: "desc" as const,
  ...over,
});

describe("filterAndSortFiles", () => {
  it("empty query returns all, does not mutate input", () => {
    const input = [...rows];
    const out = filterAndSortFiles(input, opts({}));
    expect(out).toHaveLength(3);
    expect(input).toEqual(rows); // untouched
    expect(out).not.toBe(input);
  });

  it("filters by case-insensitive substring of the name", () => {
    const out = filterAndSortFiles(rows, opts({ query: "AL" }));
    expect(out.map((r) => r.name)).toEqual(["Alpha.md"]);
  });

  it("sorts by date desc / asc", () => {
    expect(
      filterAndSortFiles(rows, opts({ sortKey: "date", sortDir: "desc" })).map((r) => r.mtime),
    ).toEqual([30, 20, 10]);
    expect(
      filterAndSortFiles(rows, opts({ sortKey: "date", sortDir: "asc" })).map((r) => r.mtime),
    ).toEqual([10, 20, 30]);
  });

  it("sorts by name asc / desc (case-insensitive locale)", () => {
    expect(
      filterAndSortFiles(rows, opts({ sortKey: "name", sortDir: "asc" })).map((r) => r.name),
    ).toEqual(["Alpha.md", "beta.md", "gamma.md"]);
    expect(
      filterAndSortFiles(rows, opts({ sortKey: "name", sortDir: "desc" })).map((r) => r.name),
    ).toEqual(["gamma.md", "beta.md", "Alpha.md"]);
  });
});
