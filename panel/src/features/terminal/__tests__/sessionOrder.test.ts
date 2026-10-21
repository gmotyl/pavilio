import { describe, it, expect } from "vitest";
import { reorderIds, swapIds, mergeOrder } from "../sessionOrder";

type Row = [label: string, ids: string[], a: string, b: string, expected: string[]];

describe("reorderIds", () => {
  it.each<Row>([
    ["moves fromId to just before toId", ["A", "B", "C", "D"], "B", "D", ["A", "C", "B", "D"]],
    ["moves the first item to just before the last", ["A", "B", "C", "D"], "A", "D", ["B", "C", "A", "D"]],
    ["no-ops when fromId === toId", ["A", "B", "C"], "B", "B", ["A", "B", "C"]],
    ["no-ops when fromId is already just before toId", ["A", "B", "C"], "A", "B", ["A", "B", "C"]],
    ["returns the original when fromId is not found", ["A", "B"], "X", "B", ["A", "B"]],
    ["returns the original when toId is not found", ["A", "B"], "A", "X", ["A", "B"]],
  ])("%s", (_label, ids, from, to, expected) => {
    expect(reorderIds(ids, from, to)).toEqual(expected);
  });
});

describe("swapIds", () => {
  it.each<Row>([
    ["swaps two items", ["A", "B", "C", "D"], "A", "D", ["D", "B", "C", "A"]],
    ["swaps adjacent items", ["A", "B", "C"], "A", "B", ["B", "A", "C"]],
    ["no-ops when idA === idB", ["A", "B", "C"], "B", "B", ["A", "B", "C"]],
    ["returns the original when idB is not found", ["A", "B"], "A", "X", ["A", "B"]],
    ["returns the original when idA is not found", ["A", "B"], "X", "B", ["A", "B"]],
  ])("%s", (_label, ids, a, b, expected) => {
    expect(swapIds(ids, a, b)).toEqual(expected);
  });
});

describe("mergeOrder", () => {
  it.each<[label: string, stored: string[], server: string[], expected: string[]]>([
    ["preserves stored order for known ids", ["B", "A", "C"], ["A", "B", "C"], ["B", "A", "C"]],
    ["removes ids no longer in the server list", ["A", "B", "C"], ["A", "C"], ["A", "C"]],
    ["appends new ids not in stored order", ["A", "B"], ["A", "B", "C", "D"], ["A", "B", "C", "D"]],
    ["handles an empty stored order (first load)", [], ["A", "B", "C"], ["A", "B", "C"]],
    ["handles all ids being new", ["X", "Y"], ["A", "B"], ["A", "B"]],
  ])("%s", (_label, stored, server, expected) => {
    expect(mergeOrder(stored, server)).toEqual(expected);
  });

  it("returns the same reference when the result is identical", () => {
    const stored = ["A", "B", "C"];
    expect(mergeOrder(stored, ["A", "B", "C"])).toBe(stored);
  });
});
