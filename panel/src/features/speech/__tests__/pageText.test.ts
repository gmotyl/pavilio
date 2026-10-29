import { describe, expect, it } from "vitest";
import { pageHasSpeech, pageSpeechText, preparePage, preparePageText } from "../pageText";
import { prepare } from "../prepare";

describe("pageSpeechText", () => {
  it("drops a leading frontmatter block", () => {
    expect(pageSpeechText("---\ntitle: X\ntags: [a]\n---\n# Hello\n\nBody.")).toBe(
      "# Hello\n\nBody.",
    );
    expect(pageSpeechText("﻿---\r\ntitle: X\r\n---\r\nBody.")).toBe("Body.");
    expect(pageSpeechText("---\n---\nBody.")).toBe("Body.");
  });

  it("leaves a YAML `...`-closed block alone, as the server does", () => {
    const page = "---\ntitle: X\n...\nBody.";
    expect(pageSpeechText(page)).toBe(page);
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

describe("preparePage", () => {
  it("prepares a page block-bounded in its own vote's language, frontmatter dropped", () => {
    const polish = "---\ntitle: X\n---\n# Zażółć\n\nKod: `const x = 1;` i ![zdjęcie](a.png) dalej.";
    const prepared = preparePage(polish);
    expect(prepared.language).toBe("pl");
    expect(prepared.units).toEqual(
      prepare(pageSpeechText(polish), { language: "pl", blockBounded: true }).units,
    );
    expect(preparePage("# Hello\n\nPlain English.").language).toBe("en");
  });

  it("is memoised on the stripped text", () => {
    const text = "# Memo\n\nOne paragraph to prepare once.";
    expect(preparePageText(text)).toBe(preparePageText(text));
    expect(preparePage(`---\ntitle: Y\n---\n${text}`)).toBe(preparePageText(text));
  });
});
