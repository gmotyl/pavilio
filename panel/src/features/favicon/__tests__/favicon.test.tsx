import { describe, it, expect } from "vitest";
import {
  buildFaviconSvg,
  buildFaviconDataUrl,
  type FaviconState,
} from "../faviconSvg";
import { __reduceForTests as reduce } from "../useAggregateActivity";
import type { ActivityState } from "../../terminal/useTerminalActivityChannel";

describe("buildFaviconSvg", () => {
  const cases: Array<[FaviconState, string]> = [
    ["busy", "#ef4444"],
    ["attention", "#22c55e"],
    ["idle", "#ca8a04"],
  ];
  it.each(cases)("for %s state embeds the %s color", (state, color) => {
    const svg = buildFaviconSvg(state);
    expect(svg).toContain(color);
    expect(svg).toContain("<svg");
    expect(svg).toContain("<circle");
  });

  it("includes a glow layer for busy and attention, not for idle", () => {
    expect(buildFaviconSvg("busy")).toMatch(/opacity="0\.35"/);
    expect(buildFaviconSvg("attention")).toMatch(/opacity="0\.35"/);
    expect(buildFaviconSvg("idle")).not.toMatch(/opacity="0\.35"/);
  });
});

describe("buildFaviconDataUrl", () => {
  it("returns a data URL with image/svg+xml mime", () => {
    const url = buildFaviconDataUrl("busy");
    expect(url.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(decodeURIComponent(url)).toContain("#ef4444");
  });
});

describe("reduce (aggregate)", () => {
  const cases: Array<[ActivityState[], "busy" | "attention" | "idle"]> = [
    [[], "idle"],
    [["idle", "idle"], "idle"],
    [["idle", "attention"], "attention"],
    [["attention", "attention"], "attention"],
    [["busy", "idle"], "busy"],
    [["attention", "busy"], "busy"],
    [["busy", "attention", "idle"], "busy"],
  ];
  it.each(cases)("reduce(%j) === %s", (input, expected) => {
    expect(reduce(input)).toBe(expected);
  });
});
