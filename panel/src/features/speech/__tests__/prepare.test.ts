import { describe, expect, it } from "vitest";
import { SPEECH_BUDGET_CHARS, UNIT_MAX_CHARS, UNIT_MIN_CHARS, prepare } from "../prepare";

/** Five short paragraphs, each well under the packing floor. */
const short = (n: number): string => `Short paragraph ${n} about the panel and its speech units.`;

/** One paragraph comfortably over the ceiling, made of whole sentences. */
const longParagraph = "This sentence exists to push the paragraph past the ceiling. ".repeat(12);

const packingResponse = [
  "# Packing",
  "",
  "Opening sentence.",
  "",
  short(1),
  "",
  short(2),
  "",
  short(3),
  "",
  short(4),
  "",
  short(5),
  "",
  longParagraph.trim(),
  "",
].join("\n");

describe("prepare", () => {
  it("unit 0 is the heading when there is one", () => {
    const { units } = prepare("## What changed\n\nThe panel now speaks the last response.\n");

    expect(units[0].text).toBe("What changed");
    expect(units[0].chars).toBe("What changed".length);
    expect(units[1].text).toBe("The panel now speaks the last response.");
  });

  it("unit 0 is the first sentence when there is no heading", () => {
    const { units } = prepare(
      "The panel now speaks the last response. It chunks it first so playback starts fast.\n",
    );

    expect(units[0].text).toBe("The panel now speaks the last response.");
    expect(units[1].text).toBe("It chunks it first so playback starts fast.");
  });

  it("a leading TLDR paragraph becomes its own second unit", () => {
    const { units } = prepare(
      [
        "## What changed",
        "",
        "**TLDR:** Responses are spoken aloud now.",
        "",
        "The panel prepares the markdown into units and plays them in order.",
        "",
      ].join("\n"),
    );

    expect(units[0].text).toBe("What changed");
    expect(units[1].text).toBe("TLDR: Responses are spoken aloud now.");
    expect(units[2].text).toBe("The panel prepares the markdown into units and plays them in order.");
  });

  it("a TLDR paragraph that is not first is not hoisted", () => {
    const { units } = prepare(
      [
        "## What changed",
        "",
        "First body paragraph here.",
        "",
        "**TLDR:** this one arrived late.",
        "",
      ].join("\n"),
    );

    expect(units[0].text).toBe("What changed");
    expect(units[1].text).toBe("First body paragraph here.");
    // Spoken in document order as ordinary body, not hoisted to index 1.
    expect(units[2].text).toBe("TLDR: this one arrived late.");
  });

  it("packs short paragraphs to the floor and cuts long ones at the ceiling", () => {
    const { units } = prepare(packingResponse);

    for (const unit of units) {
      expect(unit.chars).toBe(unit.text.length);
      expect(unit.chars).toBeLessThanOrEqual(UNIT_MAX_CHARS);
    }

    // Short neighbours merge into one unit, and that unit reaches the floor.
    const merged = units.find((unit) => unit.text.includes("Short paragraph 1"));
    expect(merged).toBeDefined();
    expect(merged?.text).toContain("Short paragraph 4");
    expect(merged?.chars).toBeGreaterThanOrEqual(UNIT_MIN_CHARS);

    // The oversized paragraph is cut into more than one unit.
    const cut = units.filter((unit) => unit.text.includes("push the paragraph past the ceiling"));
    expect(cut.length).toBeGreaterThan(1);
  });

  it("stops at the budget and counts the remaining paragraphs", () => {
    expect(SPEECH_BUDGET_CHARS).toBe(1300);

    const { units, spokenUnits, remainderParagraphs } = prepare(packingResponse, {
      budgetChars: 300,
    });

    expect(spokenUnits).toBeGreaterThan(0);
    expect(spokenUnits).toBeLessThan(units.length);

    const spent = units.slice(0, spokenUnits).reduce((sum, unit) => sum + unit.chars, 0);
    expect(spent).toBeLessThanOrEqual(300);
    expect(spent + units[spokenUnits].chars).toBeGreaterThan(300);
    expect(remainderParagraphs).toBe(units.length - spokenUnits);

    // Without the cut the whole response is spoken and nothing remains.
    const full = prepare(packingResponse);
    expect(full.spokenUnits).toBe(full.units.length);
    expect(full.remainderParagraphs).toBe(0);
  });

  it("spends the budget on prose in a diff-heavy response", () => {
    const diff = ["```diff", ...Array.from({ length: 200 }, (_, i) => `-  const old${i} = 1;`), "```"];
    const { units, spokenUnits, remainderParagraphs } = prepare(
      [
        "# Fix",
        "",
        ...diff,
        "",
        "The ordering hook no longer drops the last cell when a session closes.",
        "",
        "The regression test covers the closing cell and the one after it.",
        "",
      ].join("\n"),
    );

    const spoken = units.map((unit) => unit.text).join(" ");
    expect(spoken).not.toContain("const old");
    expect(spoken).toContain("The ordering hook no longer drops the last cell");
    expect(spoken).toContain("The regression test covers the closing cell");
    // Stripping precedes the cut, so the diff costs the budget nothing.
    expect(spokenUnits).toBe(units.length);
    expect(remainderParagraphs).toBe(0);
  });

  it("applies the pronunciation map only on the Polish branch", () => {
    const polish = "Zrobiłem deploy na Cloudflare.";

    const spoken = prepare(polish, { language: "pl" });
    expect(spoken.language).toBe("pl");
    expect(spoken.units[0].text).toBe("Zrobiłem diploj na klałdfler.");

    // The same text on the English branch is left exactly as it is...
    const unmapped = prepare(polish, { language: "en" });
    expect(unmapped.language).toBe("en");
    expect(unmapped.units[0].text).toBe(polish);

    // ...and English is the default, so ordinary English prose is never mangled
    // by map keys that are ordinary English words.
    const english = prepare("We build and update the dashboard.");
    expect(english.language).toBe("en");
    expect(english.units[0].text).toBe("We build and update the dashboard.");
    expect(prepare("We build and update the dashboard.", { language: "pl" }).units[0].text).toBe(
      "We bild and apdejt the daszbord.",
    );
  });

  it("returns no units for a response that is only code", () => {
    const result = prepare("```ts\nconst x = 1;\n```\n");

    expect(result.units).toEqual([]);
    expect(result.spokenUnits).toBe(0);
    expect(result.remainderParagraphs).toBe(0);
    expect(result.language).toBe("en");
  });

  it("no marker is ever spoken", () => {
    const { units } = prepare(
      [
        "## Heading with **bold**",
        "",
        "**TLDR:** A *bold* claim about the __panel__.",
        "",
        "- A list item with **emphasis**",
        "- Another *item* entirely",
        "",
        "### A later heading",
        "",
        "Closing paragraph with _stress_ on it.",
        "",
      ].join("\n"),
    );

    expect(units.length).toBeGreaterThan(0);
    for (const unit of units) {
      expect(unit.text).not.toMatch(/[#*]/);
      expect(unit.text).not.toContain("__");
    }
    expect(units[0].text).toBe("Heading with bold");
    expect(units.map((unit) => unit.text).join(" ")).toContain("A later heading");
  });
});
