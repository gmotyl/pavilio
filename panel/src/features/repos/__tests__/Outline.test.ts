import { describe, expect, it } from "vitest";
import { outlineOf } from "../Outline";

describe("outlineOf", () => {
  it("a call whose name starts with a keyword is not a declaration", () => {
    expect(outlineOf(["functionality();", "classify(x);", "function* gen() {}", "async function  go() {}", "function*walk() {}"].join("\n"))).toEqual([
      { name: "gen", kind: "function", line: 3 },
      { name: "go", kind: "function", line: 4 },
      { name: "walk", kind: "function", line: 5 },
    ]);
  });
});
