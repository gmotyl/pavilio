import { describe, it, expect } from "vitest";
import {
  defaultColumnSizes,
  columnsFromSizes,
  mergeColumnSizes,
  joinColumn,
  splitToColumn,
  type ColumnSizes,
} from "../columnLayout";

describe("defaultColumnSizes", () => {
  it("returns the documented shape for counts 0-9", () => {
    expect(defaultColumnSizes(0)).toEqual([]);
    expect(defaultColumnSizes(1)).toEqual([1]);
    expect(defaultColumnSizes(2)).toEqual([1, 1]);
    expect(defaultColumnSizes(3)).toEqual([1, 2]);
    expect(defaultColumnSizes(4)).toEqual([2, 2]);
    expect(defaultColumnSizes(5)).toEqual([2, 3]);
    expect(defaultColumnSizes(6)).toEqual([2, 2, 2]);
    expect(defaultColumnSizes(7)).toEqual([3, 2, 2]);
    expect(defaultColumnSizes(8)).toEqual([3, 3, 2]);
    expect(defaultColumnSizes(9)).toEqual([3, 3, 3]);
  });
});

describe("columnsFromSizes", () => {
  it("slices order into per-column id arrays", () => {
    expect(columnsFromSizes(["a", "b", "c"], [1, 2])).toEqual([["a"], ["b", "c"]]);
  });

  it("ignores ids beyond the sum of sizes", () => {
    expect(columnsFromSizes(["a", "b", "c", "d"], [1, 2])).toEqual([["a"], ["b", "c"]]);
  });
});

describe("mergeColumnSizes", () => {
  it("returns the same reference when prevSizes is empty", () => {
    const prevSizes: ColumnSizes = [];
    expect(mergeColumnSizes(["A", "B"], prevSizes, ["A", "B"])).toBe(prevSizes);
  });

  it("drops a column emptied by a closed session", () => {
    expect(mergeColumnSizes(["A", "B", "C"], [1, 2], ["B", "C"])).toEqual([2]);
  });

  it("shrinks a shared column when one of its sessions closes", () => {
    expect(mergeColumnSizes(["A", "B", "C"], [1, 2], ["A", "C"])).toEqual([1, 1]);
  });

  it("grows the last column when a new session opens", () => {
    expect(mergeColumnSizes(["A", "B"], [1, 1], ["A", "B", "C"])).toEqual([1, 2]);
  });

  it("returns [] when every column is emptied", () => {
    expect(mergeColumnSizes(["A", "B"], [1, 1], [])).toEqual([]);
  });
});

describe("joinColumn", () => {
  it("is a no-op when session and target already share a column", () => {
    const order = ["A", "B", "C"];
    const sizes: ColumnSizes = [2, 1];
    const result = joinColumn(order, sizes, "A", "B");
    expect(result.order).toBe(order);
    expect(result.sizes).toBe(sizes);
  });

  it("moves a session into a different column and updates both sizes", () => {
    const result = joinColumn(["A", "B", "C", "D"], [2, 2], "B", "D");
    expect(result.order).toEqual(["A", "C", "D", "B"]);
    expect(result.sizes).toEqual([1, 3]);
  });

  it("drops the source column when it was the sole occupant", () => {
    const result = joinColumn(["A", "B", "C"], [1, 2], "A", "C");
    expect(result.order).toEqual(["B", "C", "A"]);
    expect(result.sizes).toEqual([3]);
  });
});

describe("splitToColumn", () => {
  it("inserts a new size-1 column at gutterIndex", () => {
    const result = splitToColumn(["A", "B", "C", "D"], [2, 2], "B", 1);
    expect(result.order).toEqual(["A", "B", "C", "D"]);
    expect(result.sizes).toEqual([1, 1, 2]);
  });

  it("accounts for index shift when the source column precedes gutterIndex", () => {
    const result = splitToColumn(["A", "B", "C"], [1, 1, 1], "A", 2);
    expect(result.order).toEqual(["B", "A", "C"]);
    expect(result.sizes).toEqual([1, 1, 1]);
  });

  it("is a no-op when sessionId is not found in order", () => {
    const order = ["A", "B"];
    const sizes: ColumnSizes = [1, 1];
    const result = splitToColumn(order, sizes, "Z", 1);
    expect(result.order).toBe(order);
    expect(result.sizes).toBe(sizes);
  });
});
