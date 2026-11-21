import { describe, it, expect } from "vitest";
import { orderStarred } from "../starredOrder";

describe("orderStarred", () => {
  it("orderStarred puts unknown names last and ignores stale ones", () => {
    // `gone` is saved but no longer starred; `c` and `a` are starred and unsaved.
    expect(orderStarred(["b", "gone", "a"], ["a", "b", "c", "d"].filter((n) => n !== "d"))).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("keeps unknown names in their current order and drops duplicate saved names", () => {
    expect(orderStarred(["z", "z"], ["x", "z", "y"])).toEqual(["z", "x", "y"]);
  });

  it("tolerates a saved order that is not a string array", () => {
    expect(orderStarred({} as unknown as string[], ["a", "b"])).toEqual(["a", "b"]);
    expect(orderStarred("x" as unknown as string[], ["a"])).toEqual(["a"]);
    expect(orderStarred([1, "b"] as unknown as string[], ["a", "b"])).toEqual(["b", "a"]);
  });
});
