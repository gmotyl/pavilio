import { describe, it, expect } from "vitest";
import { parseHHMM } from "../parseHHMM";

describe("parseHHMM", () => {
  it("parses HH:MM into total minutes", () => {
    expect(parseHHMM("1:30")).toBe(90);
  });

  it("parses HH:00", () => {
    expect(parseHHMM("1:00")).toBe(60);
  });

  it("parses 0:45", () => {
    expect(parseHHMM("0:45")).toBe(45);
  });

  it("parses 0:00 as 0", () => {
    expect(parseHHMM("0:00")).toBe(0);
  });

  it("parses a bare integer as minutes", () => {
    expect(parseHHMM("90")).toBe(90);
  });

  it("parses 0 as 0", () => {
    expect(parseHHMM("0")).toBe(0);
  });

  it("trims whitespace before parsing", () => {
    expect(parseHHMM("  1:30  ")).toBe(90);
    expect(parseHHMM("  90 ")).toBe(90);
  });

  it("returns null for non-numeric input", () => {
    expect(parseHHMM("abc")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseHHMM("")).toBeNull();
  });

  it("returns null for whitespace only", () => {
    expect(parseHHMM("   ")).toBeNull();
  });

  it("returns null when minutes part is >= 60", () => {
    expect(parseHHMM("1:99")).toBeNull();
    expect(parseHHMM("0:60")).toBeNull();
  });

  it("returns null when seconds are included", () => {
    expect(parseHHMM("1:30:00")).toBeNull();
  });

  it("returns null for negatives", () => {
    expect(parseHHMM("-5")).toBeNull();
    expect(parseHHMM("-1:30")).toBeNull();
  });

  it("returns null for decimals", () => {
    expect(parseHHMM("1.5")).toBeNull();
    expect(parseHHMM("1:3.5")).toBeNull();
  });

  it("returns null for partial HH:MM", () => {
    expect(parseHHMM("1:")).toBeNull();
    expect(parseHHMM(":30")).toBeNull();
  });
});
