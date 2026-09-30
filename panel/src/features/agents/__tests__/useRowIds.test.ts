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

  /**
   * The probe: `a` removed and `b` renamed in one write. `c` is found by
   * identity; `beta2` sits where `a` was, and handing it `a`'s row would put
   * `a`'s in-progress edit onto `b`. A changed length means entries moved, so
   * no position is trusted to be the same entry.
   */
  it("a changed length makes no in-place match", () => {
    expect(run(["a", "b", "c"], ["b2", "c"])).toEqual([3, 2]);
    expect(run(["a", "b"], ["a2", "b", "x"])).toEqual([2, 1, 3]);
  });

  /**
   * Same length is not enough: `a` removed, `b` renamed and `d` appended in one
   * write keeps the length while `c` moved up. An entry that moved means the
   * positions shifted, so again no in-place match.
   */
  it("a moved entry makes no in-place match, even at the same length", () => {
    expect(run(["a", "b", "c"], ["b2", "c", "d"])).toEqual([3, 2, 4]);
  });

  it("at the same length with nothing moved, an edit in place keeps its row", () => {
    expect(run(["a", "b", "c"], ["a2", "b", "c2"])).toEqual([0, 1, 2]);
  });
});
