import { describe, expect, it } from "vitest";

import { reconcileRowIds } from "../useRowIds";

const id = (s: string) => s;

function run(previous: string[], list: string[]): number[] {
  return reconcileRowIds(previous, previous.map((_, i) => i), previous.length, list, id).ids;
}

describe("reconcileRowIds", () => {
  it("an entry removed before a row moves that row, not its neighbour", () => {
    expect(run(["a", "b", "c"], ["b", "c"])).toEqual([1, 2]);
  });

  it("a removed row's id is gone", () => {
    expect(run(["a", "b", "c"], ["a", "c"])).toEqual([0, 2]);
  });

  it("an entry changed in place keeps its row", () => {
    expect(run(["a", "b"], ["a", "b2"])).toEqual([0, 1]);
  });

  it("an edit that duplicates a neighbour keeps both rows in place", () => {
    expect(run(["a", "b"], ["b", "b"])).toEqual([0, 1]);
  });

  it("an appended entry gets a fresh id", () => {
    expect(run(["a"], ["a", "b"])).toEqual([0, 1]);
    expect(run(["a", "b"], ["b", "x", "y"])).toEqual([1, 2, 3]);
  });

  it("between duplicates the earlier one wins", () => {
    expect(run(["x", "y", "x"], ["x", "x"])).toEqual([0, 2]);
    expect(run(["x", "x"], ["x"])).toEqual([0]);
  });
});
