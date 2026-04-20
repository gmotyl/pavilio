import { describe, it, expect } from "vitest";
import { reorderIds, swapIds, mergeOrder } from "../sessionOrder";

describe("reorderIds", () => {
  it("moves fromId to just before toId", () => {
    expect(reorderIds(["A","B","C","D"], "B", "D")).toEqual(["A","C","B","D"]);
  });

  it("moves first item to last position (before last)", () => {
    expect(reorderIds(["A","B","C","D"], "A", "D")).toEqual(["B","C","A","D"]);
  });

  it("no-ops when fromId === toId", () => {
    expect(reorderIds(["A","B","C"], "B", "B")).toEqual(["A","B","C"]);
  });

  it("no-ops when fromId is already just before toId", () => {
    expect(reorderIds(["A","B","C"], "A", "B")).toEqual(["A","B","C"]);
  });

  it("returns original array if fromId not found", () => {
    expect(reorderIds(["A","B"], "X", "B")).toEqual(["A","B"]);
  });

  it("returns original array if toId not found", () => {
    expect(reorderIds(["A","B"], "A", "X")).toEqual(["A","B"]);
  });
});

describe("swapIds", () => {
  it("swaps two items", () => {
    expect(swapIds(["A","B","C","D"], "A", "D")).toEqual(["D","B","C","A"]);
  });

  it("swaps adjacent items", () => {
    expect(swapIds(["A","B","C"], "A", "B")).toEqual(["B","A","C"]);
  });

  it("no-ops when idA === idB", () => {
    expect(swapIds(["A","B","C"], "B", "B")).toEqual(["A","B","C"]);
  });

  it("returns original if either id not found", () => {
    expect(swapIds(["A","B"], "A", "X")).toEqual(["A","B"]);
    expect(swapIds(["A","B"], "X", "B")).toEqual(["A","B"]);
  });
});

describe("mergeOrder", () => {
  it("preserves stored order for known ids", () => {
    expect(mergeOrder(["B","A","C"], ["A","B","C"])).toEqual(["B","A","C"]);
  });

  it("removes ids no longer in server list", () => {
    expect(mergeOrder(["A","B","C"], ["A","C"])).toEqual(["A","C"]);
  });

  it("appends new ids not in stored order", () => {
    expect(mergeOrder(["A","B"], ["A","B","C","D"])).toEqual(["A","B","C","D"]);
  });

  it("handles empty stored order (first load)", () => {
    expect(mergeOrder([], ["A","B","C"])).toEqual(["A","B","C"]);
  });

  it("handles all ids being new", () => {
    expect(mergeOrder(["X","Y"], ["A","B"])).toEqual(["A","B"]);
  });

  it("returns the same reference when the result is identical", () => {
    const stored = ["A", "B", "C"];
    expect(mergeOrder(stored, ["A", "B", "C"])).toBe(stored);
  });
});
