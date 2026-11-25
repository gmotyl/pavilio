import { describe, expect, it } from "vitest";

import { highlightLines } from "../highlight";
import { numberStoryDiff, storyDiffLanguage, type StoryDiffLine } from "../storyDiff";

const block = (...lines: string[]): StoryDiffLine[] => numberStoryDiff(lines.join("\n"))!;
const numbers = (lines: StoryDiffLine[]) => lines.slice(1).map((l) => l.number);
const bases = (lines: StoryDiffLine[]) => lines.slice(1).map((l) => l.base);

describe("storyDiff", () => {
  it("base start numbers context and removed lines", () => {
    const lines = block("@@ src/a.ts L10–12 base L9 @@", " a", "-b", "+c", " d");

    expect(lines[0]).toMatchObject({ kind: "header", number: null, base: null });
    expect(numbers(lines)).toEqual([10, null, 11, 12]);
    expect(bases(lines)).toEqual([9, 10, null, 11]);
  });

  it("no base token leaves base null except under (before)", () => {
    const head = block("@@ src/a.ts L10–12 @@", " a", "-b", "+c", " d");
    expect(numbers(head)).toEqual([10, null, 11, 12]);
    expect(bases(head)).toEqual([null, null, null, null]);

    const before = block("@@ src/a.ts (before) L20–22 @@", " a", "-b", "+c", " d");
    expect(numbers(before)).toEqual([20, 21, null, 22]);
    expect(bases(before)).toEqual(numbers(before));
  });

  it("hyphen range parses like en dash", () => {
    const hyphen = block("@@ src/a.ts L10-12 base L9 @@", " a", "-b", "+c", " d");
    const dash = block("@@ src/a.ts L10–12 base L9 @@", " a", "-b", "+c", " d");

    expect(hyphen[0].kind).toBe("header");
    expect(numbers(hyphen)).toEqual(numbers(dash));
    expect(bases(hyphen)).toEqual(bases(dash));
  });

  it("language from the header path extension", () => {
    expect(storyDiffLanguage(block("@@ src/a.ts L1 @@", " x"))).toBe("typescript");
    expect(storyDiffLanguage(block("@@ panel/src/x.tsx L40–41 @@", "+y"))).toBe("typescript");
    expect(storyDiffLanguage(block("@@ src/a.ts (before) L3 base L3 @@", "-x"))).toBe("typescript");
  });

  it("language for any extension highlight.js knows, beyond the hand map", () => {
    expect(storyDiffLanguage(block("@@ src/main.c L1 @@", " x"))).toBe("c");
    expect(storyDiffLanguage(block("@@ web/index.php L1 @@", " x"))).toBe("php");
  });

  it("unknown or missing extension gives no language", () => {
    expect(storyDiffLanguage(block("@@ pnpm.lock L1 @@", " x"))).toBeNull();
    expect(storyDiffLanguage(block("@@ bin/sh L1 @@", " x"))).toBeNull();
    expect(storyDiffLanguage(block("@@ vendor/LICENSE (dependency: lodash.debounce) L1 @@", " x"))).toBeNull();
  });

  it("highlightLines reopens a comment span on every line", () => {
    const { html, tokens } = highlightLines(["/**", " * doc", " */"], "typescript");

    expect(tokens).toBe(true);
    expect(html).toHaveLength(3);
    for (const line of html) expect(line).toMatch(/^<span class="hljs-comment">/);
  });
});
