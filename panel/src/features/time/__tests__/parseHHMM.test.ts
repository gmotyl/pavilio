import { describe, it, expect } from "vitest";
import { parseHHMM } from "../parseHHMM";

describe("parseHHMM", () => {
  it.each<[label: string, input: string, minutes: number]>([
    ["HH:MM into total minutes", "1:30", 90],
    ["HH:00", "1:00", 60],
    ["0:45", "0:45", 45],
    ["0:00 as 0", "0:00", 0],
    ["a bare integer as minutes", "90", 90],
    ["0 as 0", "0", 0],
    ["HH:MM after trimming whitespace", "  1:30  ", 90],
    ["a bare integer after trimming whitespace", "  90 ", 90],
  ])("parses %s", (_label, input, minutes) => {
    expect(parseHHMM(input)).toBe(minutes);
  });

  it.each<[label: string, input: string]>([
    ["non-numeric input", "abc"],
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["a minutes part >= 60 (1:99)", "1:99"],
    ["a minutes part >= 60 (0:60)", "0:60"],
    ["seconds included", "1:30:00"],
    ["a negative integer", "-5"],
    ["a negative HH:MM", "-1:30"],
    ["a decimal", "1.5"],
    ["a decimal minutes part", "1:3.5"],
    ["a missing minutes part", "1:"],
    ["a missing hours part", ":30"],
  ])("returns null for %s", (_label, input) => {
    expect(parseHHMM(input)).toBeNull();
  });
});
