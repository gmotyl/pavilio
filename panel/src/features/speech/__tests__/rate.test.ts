import { describe, expect, it } from "vitest";

import { clampRate, preferences } from "../../../preferences/declarations";
import { nextRatePreset, rateFor, setProjectRate } from "../rate";

describe("per-project playback rate", () => {
  it("nextRatePreset cycles the presets and wraps", () => {
    expect([1.0, 1.2, 1.5, 2.0, 1.3].map(nextRatePreset)).toEqual([1.2, 1.5, 2.0, 0.8, 1.5]);
  });

  it("the rate codec clamps and rounds", () => {
    expect([3, 0.1, 1.27, "x", Number.NaN].map(clampRate)).toEqual([2.0, 0.5, 1.3, 1.0, 1.0]);
    const parsed = preferences.speechRateByProject.codec.parse(
      JSON.stringify({ a: 3, b: 0.1, c: 1.27, d: "x" }),
    );
    expect(parsed).toEqual({ a: 2.0, b: 0.5, c: 1.3, d: 1.0 });
  });

  it("stores a project's rate and reads 1.0 for others and for no project", () => {
    setProjectRate("p", 1.5);
    expect(rateFor("p")).toBe(1.5);
    expect(rateFor("q")).toBe(1.0);
    expect(rateFor(undefined)).toBe(1.0);
    setProjectRate("p", 1.0);
    expect(rateFor("p")).toBe(1.0);
  });
});
