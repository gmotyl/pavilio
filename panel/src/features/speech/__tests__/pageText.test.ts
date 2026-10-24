import { describe, expect, it } from "vitest";
import { pageHasSpeech, pageSpeechText } from "../pageText";

describe("pageSpeechText", () => {
  it("drops a leading frontmatter block", () => {
    expect(pageSpeechText("---\ntitle: X\ntags: [a]\n---\n# Hello\n\nBody.")).toBe(
      "# Hello\n\nBody.",
    );
    expect(pageSpeechText("﻿---\r\ntitle: X\r\n...\r\nBody.")).toBe("Body.");
    expect(pageSpeechText("---\n---\nBody.")).toBe("Body.");
  });

  it("leaves a thematic break further down alone", () => {
    const page = "# Hello\n\n---\n\nAfter.\n\n---\n";
    expect(pageSpeechText(page)).toBe(page);
  });
});

describe("pageHasSpeech", () => {
  it("is false for empty, code-only and frontmatter-only pages", () => {
    expect(pageHasSpeech("")).toBe(false);
    expect(pageHasSpeech("```ts\nconst x = 1;\n```")).toBe(false);
    expect(pageHasSpeech("---\ntitle: X\n---\n")).toBe(false);
    expect(pageHasSpeech("---\ntitle: X\n---\n# Hello")).toBe(true);
  });
});
