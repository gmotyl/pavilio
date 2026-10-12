import { describe, expect, it } from "vitest";

import {
  PROJECT_COLOR_PRESETS,
  PROJECT_MARK_ICONS,
  derivedProjectColor,
  parseProjectMark,
} from "../projectMark";

describe("unset colour derives from the project name and is stable", () => {
  it("returns a preset colour, the same one on every call", () => {
    const hexes = PROJECT_COLOR_PRESETS.map((p) => p.hex);
    expect(hexes).toContain(derivedProjectColor("pavilio"));
    expect(derivedProjectColor("pavilio")).toBe(derivedProjectColor("pavilio"));
  });

  it("is pinned to fixed values so it cannot drift between machines", () => {
    // FNV-1a over UTF-16 code units, modulo the 12 presets.
    expect(derivedProjectColor("")).toBe(PROJECT_COLOR_PRESETS[(2166136261 >>> 0) % 12].hex);
    expect(derivedProjectColor("alpha")).toBe("#8fa3bf");
    expect(derivedProjectColor("pavilio")).toBe("#98c379");
    expect(derivedProjectColor("gamma")).toBe("#d19a66");
  });

  it("spreads different names over the palette", () => {
    const names = Array.from({ length: 60 }, (_, i) => `project-${i}`);
    expect(new Set(names.map(derivedProjectColor)).size).toBeGreaterThan(6);
  });
});

describe("mark parser accepts registered icons and a single emoji only", () => {
  it("has the 23 curated icons", () => {
    expect(PROJECT_MARK_ICONS).toHaveLength(23);
    expect(new Set(PROJECT_MARK_ICONS).size).toBe(23);
  });

  it("accepts every registered icon", () => {
    for (const name of PROJECT_MARK_ICONS) {
      expect(parseProjectMark(`lucide:${name}`)).toBe(`lucide:${name}`);
    }
  });

  it("accepts one emoji", () => {
    expect(parseProjectMark("emoji:🚀")).toBe("emoji:🚀");
  });

  it("rejects everything else to the empty mark", () => {
    for (const bad of [
      "",
      "lucide:nope",
      "lucide:",
      "emoji:",
      "emoji:🚀🚀",
      "emoji:ab",
      "emoji:a",
      "emoji:1",
      "rocket",
      "foo:🚀",
      "lucide:rocket ",
      42,
      null,
      undefined,
    ]) {
      expect(parseProjectMark(bad)).toBe("");
    }
  });
});

describe("a flag or skin-tone emoji counts as one grapheme", () => {
  it("accepts flags, skin tones, ZWJ sequences and variation selectors", () => {
    for (const e of ["🇵🇱", "👍🏽", "👨‍👩‍👧‍👦", "❤️"]) {
      expect(parseProjectMark(`emoji:${e}`)).toBe(`emoji:${e}`);
    }
  });
});

describe("emoji presentation", () => {
  it("rejects text-default symbols without a variation selector", () => {
    for (const e of ["©", "™", "▶", "❤", "☺"]) {
      expect(parseProjectMark(`emoji:${e}`)).toBe("");
    }
  });

  it("accepts keycaps, the same symbols with VS16, and default-emoji glyphs", () => {
    for (const e of ["1️⃣", "#️⃣", "©️", "™️", "▶️", "❤️", "🚀", "🇵🇱", "👍🏽", "👨‍👩‍👧‍👦"]) {
      expect(parseProjectMark(`emoji:${e}`)).toBe(`emoji:${e}`);
    }
  });
});
