import { describe, expect, it } from "vitest";
import { noteTarget } from "../noteTarget";

describe("noteTarget", () => {
  it("noteTarget parses L12, L27–33, L27-33 and base L16", () => {
    expect(noteTarget("L12")).toEqual({ side: "head", from: 12, to: 12 });
    expect(noteTarget("L27–33")).toEqual({ side: "head", from: 27, to: 33 });
    expect(noteTarget("L27-33")).toEqual({ side: "head", from: 27, to: 33 });
    expect(noteTarget("base L16")).toEqual({ side: "base", from: 16, to: 16 });
    expect(noteTarget(" base L16–18 ")).toEqual({ side: "base", from: 16, to: 18 });
  });

  it("noteTarget returns null for other text", () => {
    for (const text of ["", "L", "Line 12", "L12 and more", "see L12", "base", "base L", "l12", "L33–27", "LX"]) {
      expect(noteTarget(text)).toBeNull();
    }
  });
});
