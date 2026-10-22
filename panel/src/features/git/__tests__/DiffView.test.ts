import { describe, it, expect } from "vitest";
import { detectLang, escapeHtml, injectHighlight } from "../DiffView";

describe("detectLang", () => {
  it.each<[label: string, filename: string | undefined, lang: string | undefined]>([
    [".ts files", "src/app.ts", "typescript"],
    [".tsx files", "components/Button.tsx", "typescript"],
    ["Dockerfile", "Dockerfile", "dockerfile"],
    ["unknown extensions", "file.xyz", undefined],
    ["no filename", undefined, undefined],
    ["nested paths", "a/b/c/styles.css", "css"],
    ["filenames case-insensitively", "path/DOCKERFILE", "dockerfile"],
  ])("detects %s", (_label, filename, lang) => {
    expect(detectLang(filename)).toBe(lang);
  });

  it("returns undefined when called with no argument", () => {
    expect(detectLang()).toBeUndefined();
  });
});

describe("escapeHtml", () => {
  it.each([
    ["escapes ampersand, less-than, greater-than", "a < b > c & d", "a &lt; b &gt; c &amp; d"],
    ["returns empty string for empty input", "", ""],
    ["leaves safe text unchanged", "hello world", "hello world"],
  ])("%s", (_label, input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });
});

describe("injectHighlight", () => {
  it("returns html unchanged when term is empty", () => {
    const html = '<span class="kw">const</span>';
    expect(injectHighlight(html, "")).toBe(html);
  });

  it("wraps matching text in mark tags", () => {
    const result = injectHighlight("hello world", "world");
    expect(result).toContain("<mark");
    expect(result).toContain("world</mark>");
  });

  it("does not highlight inside HTML tags", () => {
    const html = '<span class="world">world</span>';
    const result = injectHighlight(html, "world");
    // The "world" in class attribute should be untouched
    expect(result).toContain('class="world"');
  });

  it("is case-insensitive", () => {
    const result = injectHighlight("Hello HELLO hello", "hello");
    const marks = result.match(/<mark/g);
    expect(marks?.length).toBe(3);
  });

  it("escapes regex special characters in term", () => {
    const result = injectHighlight("price is $100 (total)", "$100");
    expect(result).toContain("<mark");
  });
});
