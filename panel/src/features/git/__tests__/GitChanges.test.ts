import { describe, it, expect } from "vitest";
import { statusLabel, statusColor } from "../GitChanges";

describe("statusLabel", () => {
  it.each([
    ["??", "U"], // untracked
    ["M", "M"],
    ["D", "D"],
    ["A", "A"],
    ["R", "R"], // unknown status passes through
  ])("maps %s to %s", (status, label) => {
    expect(statusLabel(status)).toBe(label);
  });
});

describe("statusColor", () => {
  it.each([
    ["??", "var(--green)"], // untracked
    ["M", "var(--yellow)"], // modified
    ["D", "var(--red)"], // deleted
    ["X", "var(--text-tertiary)"], // unknown
  ])("colours %s as %s", (status, color) => {
    expect(statusColor(status)).toBe(color);
  });
});
