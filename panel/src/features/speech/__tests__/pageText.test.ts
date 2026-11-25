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
    expect(pageHasSpeech("", "en")).toBe(false);
    expect(pageHasSpeech("```ts\nconst x = 1;\n```", "en")).toBe(false);
    expect(pageHasSpeech("---\ntitle: X\n---\n", "pl")).toBe(false);
    expect(pageHasSpeech("---\ntitle: X\n---\n# Hello", "en")).toBe(true);
  });
});

describe("preparePage", () => {
  it("prepares a page in the given language, frontmatter dropped", () => {
    const polish = "---\ntitle: X\n---\n# Zażółć\n\nKod: `const x = 1;` i ![zdjęcie](a.png) dalej.";
    const prepared = preparePage(polish, "pl");
    expect(prepared.language).toBe("pl");
    expect(prepared.units).toEqual(
      prepare(pageSpeechText(polish), { language: "pl" }).units,
    );
  });

  it("page text uses the given language, not its own", () => {
    // Polish by its diacritics, English by its words: each is prepared in the
    // language it is handed, placeholders and every unit's `lang` with it.
    const polish = "# Zażółć gęślą jaźń\n\nZdjęcie: ![zdjęcie](a.png) i dalej po polsku.";
    const english = "# Hello\n\nA picture: ![photo](a.png) and more in English.";

    const polishInEnglish = preparePageText(polish, "en");
    expect(polishInEnglish.language).toBe("en");
    expect(polishInEnglish.units.map((unit) => unit.lang)).toEqual(
      polishInEnglish.units.map(() => "en"),
    );
    expect(polishInEnglish.units).toEqual(prepare(polish, { language: "en" }).units);

    const englishInPolish = preparePageText(english, "pl");
    expect(englishInPolish.language).toBe("pl");
    expect(englishInPolish.units).toEqual(prepare(english, { language: "pl" }).units);

    // The placeholders are what differ, so the two preparations of one text
    // really are different units.
    expect(preparePageText(english, "en").units).not.toEqual(englishInPolish.units);
  });

  it("is memoised on the stripped text and the language", () => {
    const text = "# Memo\n\nOne paragraph to prepare once, with ![an image](a.png).";
    expect(preparePageText(text, "en")).toBe(preparePageText(text, "en"));
    expect(preparePage(`---\ntitle: Y\n---\n${text}`, "en")).toBe(preparePageText(text, "en"));
    // A page prepared under one voice language is never served under the other.
    expect(preparePageText(text, "pl")).not.toBe(preparePageText(text, "en"));
    expect(preparePageText(text, "pl").language).toBe("pl");
  });
});
