import { describe, expect, it } from "vitest";
import { applyPronunciation } from "../pronunciation";
import { UNIT_MAX_CHARS, UNIT_MIN_CHARS, prepare } from "../prepare";

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

/**
 * One response carrying every sentinel `strip.ts` can emit: a fence, a table, an
 * HTML block, an image, a bare address, and an inline span too long to speak.
 */
const everySentinelResponse = [
  "# Przegląd",
  "",
  "Zaczynamy od tego. Kod poniżej:",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "Tabela poniżej:",
  "",
  "| a | b |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "<details>",
  "<summary>x</summary>",
  "</details>",
  "",
  "Obrazek ![alt](http://x/y.png) w środku, adres https://example.com/a też.",
  "",
  "Wyrażenie `alfa.beta.gamma.delta.epsilon` w zdaniu.",
  "",
].join("\n");

/**
 * A response with nothing removable in it — the control for "substitution is a
 * no-op when there is nothing to substitute". Its expected units below were
 * captured from the build before placeholders were spoken at all, so the
 * assertion is literally "byte-identical to what this used to produce".
 */
const noSentinelResponse = [
  "# Co się zmieniło",
  "",
  "Panel mówi ostatnią odpowiedź na głos. Dzieli ją najpierw na jednostki, żeby odtwarzanie ruszało szybko.",
  "",
  "Druga część jest krótka i nie ma w niej niczego do usunięcia.",
  "",
  // A mid-body heading: `removeMarkers` strips the `##`, so this paragraph
  // reaches the packer with no terminator. It is the shape that made a
  // placeholder behind it lose its pause — and it is here so that no fix for
  // that may pay for itself by rewriting prose that has no placeholder in it.
  "## Trzecia część",
  "",
  // The trailing comma is the point of this line, not a typo. Tidy rule "a
  // placeholder closing the paragraph becomes a full stop" would rewrite it,
  // so this paragraph is what makes the byte-identity guard in
  // `speakSentinels` load-bearing: delete the early `return text` and this
  // comma becomes a period.
  "Ostatni akapit urywa się przecinkiem,",
  "",
].join("\n");

const NO_SENTINEL_UNITS = [
  { text: "Co się zmieniło", chars: 15 },
  { text: "Panel mówi ostatnią odpowiedź na głos.", chars: 38 },
  {
    text:
      "Dzieli ją najpierw na jednostki, żeby odtwarzanie ruszało szybko. " +
      "Druga część jest krótka i nie ma w niej niczego do usunięcia. " +
      "Trzecia część Ostatni akapit urywa się przecinkiem,",
    chars: 179,
  },
];

/** Everything the voice will say, in order — the only thing these tests judge. */
const spoken = (markdown: string, language: "pl" | "en"): string =>
  prepare(markdown, { language })
    .units.map((unit) => unit.text)
    .join(" ");

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

  it("a leading removed block does not cost the response its fast start", () => {
    // A response that opens with a fence, a table or an HTML block starts with
    // a sentinel paragraph. A sentinel carries no sentence terminator, so the
    // first-sentence rule found nothing in it and the sentinel packed together
    // with the whole first prose paragraph into one long unit 0 — the first
    // synthesis, the one playback waits on, tripled in length.
    const body =
      "The grid keeps its own ordering. It is stored per cell and never derived from the " +
      "DOM, so a reorder survives a reload and two cells never disagree about which of " +
      "them comes first in the list the panel renders.";

    const { units } = prepare(
      ["```ts", "const order = useTerminalOrdering();", "```", "", body, ""].join("\n"),
    );

    expect(units[0].text).toBe("code block.");
    expect(units[1].text).toBe("The grid keeps its own ordering.");
    expect(units[0].chars).toBeLessThan(UNIT_MIN_CHARS);
    expect(units[1].chars).toBeLessThan(UNIT_MIN_CHARS);

    // Same for a leading table, and the sentinel still stands before the prose
    // it replaced rather than being hoisted past it.
    const table = prepare(["| a | b |", "| - | - |", "", body, ""].join("\n"));

    expect(table.units[0].text).toBe("table.");
    expect(table.units[1].text).toBe("The grid keeps its own ordering.");
  });

  it("a leading removed block still lets the TLDR behind it be hoisted", () => {
    const { units } = prepare(
      [
        "```ts",
        "const x = 1;",
        "```",
        "",
        "**TLDR:** the fence above is noise. The sentence after it is not, and both of",
        "them have to reach the listener in the order the answer wrote them.",
        "",
        "Body paragraph that follows the summary.",
        "",
      ].join("\n"),
    );

    expect(units[0].text).toBe("code block.");
    expect(units[1].text).toMatch(/^TLDR: the fence above is noise\./);
    expect(units[1].text).toContain("in the order the answer wrote them.");
  });

  it("a leading TLDR paragraph becomes its own second unit", () => {
    // The TLDR is deliberately MORE than one sentence: a single-sentence TLDR
    // is indistinguishable from the generic first-sentence fast start, so a
    // fixture built on one would pass with the TLDR branch deleted. The whole
    // paragraph must ride in unit 1 — not just its opening sentence.
    const { units } = prepare(
      [
        "## What changed",
        "",
        "**TLDR:** Responses are spoken. A second sentence rides along in the same TLDR paragraph.",
        "",
        "Body paragraph follows here.",
        "",
      ].join("\n"),
    );

    expect(units[0].text).toBe("What changed");
    expect(units[1].text).toBe(
      "TLDR: Responses are spoken. A second sentence rides along in the same TLDR paragraph.",
    );
    expect(units[2].text).toBe("Body paragraph follows here.");
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

  it("a heading that is not first is not hoisted", () => {
    const { units } = prepare(
      [
        "First body paragraph here. It runs on a little.",
        "",
        "## A later heading",
        "",
        "Body after the heading.",
        "",
      ].join("\n"),
    );

    // Unit 0 is the body's opening sentence, not the heading further down.
    expect(units[0].text).toBe("First body paragraph here.");

    const spoken = units.map((unit) => unit.text).join(" ");
    expect(spoken).toContain("A later heading");
    // Spoken in document order as a section marker inside the body.
    expect(spoken.indexOf("A later heading")).toBeGreaterThan(spoken.indexOf("It runs on a little."));
    expect(spoken.indexOf("A later heading")).toBeLessThan(spoken.indexOf("Body after the heading."));
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

  it("speaks a response longer than the old budget in full", () => {
    // Twelve paragraphs of ~240 characters — several times over the 1300-char
    // budget this feature used to carry.
    const markdown = Array.from({ length: 12 }, (_, i) => {
      const head = `Paragraph ${String(i).padStart(2, "0")} `;
      return head + "x".repeat(238 - head.length) + ".";
    }).join("\n\n");

    const prepared = prepare(markdown);
    const spent = prepared.units.reduce((sum, unit) => sum + unit.chars, 0);

    expect(spent).toBeGreaterThan(1300);
    // The last paragraph is prepared like every other one: nothing is held back.
    expect(prepared.units.map((unit) => unit.text).join(" ")).toContain("Paragraph 11");
    // The cut is gone from the SHAPE, not merely left unused — a caller cannot
    // reach for a remainder that no longer exists.
    expect(prepared).not.toHaveProperty("spokenUnits");
    expect(prepared).not.toHaveProperty("remainderParagraphs");
  });

  it("keeps the prose of a diff-heavy response and none of the diff", () => {
    const diff = ["```diff", ...Array.from({ length: 200 }, (_, i) => `-  const old${i} = 1;`), "```"];
    const { units } = prepare(
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
  it("speaks every sentinel in Polish for a Polish session", () => {
    const text = spoken(everySentinelResponse, "pl");

    expect(text).toContain("blok kodu");
    expect(text).toContain("tabela");
    // `blok HTML` reaches the voice as `blok ejcz-ti-em-el`: the substitution
    // lands first and the pronunciation map then does its job on the acronym,
    // which is exactly the stage order this task establishes.
    expect(text).toContain("blok ejcz-ti-em-el");
    expect(text).toContain("obrazek");
    expect(text).toContain("link");
    expect(text).toContain("wyrażenie");
    // No sentinel may reach synthesis: the voice would spell the brackets out.
    expect(text).not.toContain("⟦");
    expect(text).not.toContain("⟧");
  });

  it("speaks every sentinel in English for an English session", () => {
    const text = spoken(everySentinelResponse, "en");

    expect(text).toContain("code block");
    expect(text).toContain("table");
    expect(text).toContain("HTML block");
    expect(text).toContain("image");
    expect(text).toContain("link");
    expect(text).toContain("expression");
    expect(text).not.toContain("⟦");
    expect(text).not.toContain("⟧");
  });

  it("leaves no doubled comma or stray space around a substitution", () => {
    const text = spoken(
      [
        "Obrazek ![alt](http://x/y.png) w środku, adres https://example.com/a też.",
        "",
        "Kod poniżej:",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
      ].join("\n"),
      "pl",
    );

    expect(text).not.toMatch(/ ,/); // no space before a comma
    expect(text).not.toMatch(/,\s*,/); // no doubled comma
    expect(text).not.toMatch(/,\s*[.;:!?]/); // no comma leaning on other punctuation
    expect(text).not.toMatch(/[.;:!?]\s*,/);

    // …and the pauses the commas exist for are still there. This pair of
    // assertions is the whole point: a tidy pass that swallowed them would
    // satisfy the four above and ruin the diction.
    expect(text).toContain("Obrazek, obrazek, w środku");
    expect(text).toContain("adres, link, też.");
  });

  it("keeps a paragraph that is only a placeholder", () => {
    // A response that opens with a fence: `prepare` hoists the sentinel-only
    // paragraph into its own unit, so the substitution has to make that unit
    // speakable — an empty unit 0 is a synthesis round trip for silence.
    const { units } = prepare("```ts\nconst x = 1;\n```\n\nZaczynamy od tego.\n", {
      language: "pl",
    });

    expect(units[0].text).toBe("blok kodu.");
    expect(units[0].chars).toBe("blok kodu.".length);
    for (const unit of units) expect(unit.text.length).toBeGreaterThan(0);
  });

  it("changes nothing for a response with no sentinels", () => {
    // A pin, not a new behaviour: it passed before this change and must keep
    // passing. The substitution returns the text untouched when no sentinel
    // stood in it, so the tidy pass never runs over ordinary prose.
    expect(prepare(noSentinelResponse, { language: "pl" }).units).toEqual(NO_SENTINEL_UNITS);
    expect(prepare(noSentinelResponse, { language: "en" }).units).toEqual(NO_SENTINEL_UNITS);
  });


  it("a placeholder opening a paragraph still pauses after the one before it", () => {
    // A paragraph start is NOT an utterance start. `packUnits` joins paragraphs
    // with a single space, so a heading — which `removeMarkers` strips to bare
    // words and which therefore carries no terminator — runs straight into the
    // placeholder behind it. "Wyniki blok kodu" is one noun phrase to a
    // listener, and a mid-body heading followed by a fenced block is the most
    // common shape an agent answer has.
    const markdown = [
      "Wstęp jest tutaj.",
      "",
      "## Wyniki",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "Dalszy akapit tutaj.",
      "",
    ].join("\n");

    expect(spoken(markdown, "pl")).toContain("Wyniki, blok kodu. Dalszy akapit tutaj.");
    expect(spoken(markdown, "en")).toContain("Wyniki, code block. Dalszy akapit tutaj.");
    expect(spoken(markdown, "pl")).not.toContain("Wyniki blok kodu");

    // …and the pause is not paid for with a stumble at the other end: when the
    // paragraph before it does carry its own punctuation, that one wins and our
    // comma is dropped rather than doubled.
    const afterColon = [
      "Kod poniżej:",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
    ].join("\n");

    expect(spoken(afterColon, "pl")).toBe("Kod poniżej: blok kodu.");
  });

  it("never opens an utterance with a comma", () => {
    // The one place tidy rule 4's reasoning is actually true. A unit is exactly
    // what synthesis receives, so a leading comma here is a beat before the
    // first word — and unlike a paragraph edge, a unit edge really has nothing
    // behind it.
    const { units } = prepare("```ts\nconst x = 1;\n```\n\nZaczynamy od tego.\n", {
      language: "pl",
    });

    for (const unit of units) {
      expect(unit.text).not.toMatch(/^\s*,/);
      expect(unit.chars).toBe(unit.text.length);
    }
    expect(units[0].text).toBe("blok kodu.");
  });

  it("keeps the author's own pause when a placeholder follows a colon", () => {
    // Tidy rule 1, with the colon and the sentinel in the SAME paragraph — the
    // only arrangement in which the rule can fire at all. Without it the voice
    // gets "Obrazek: , obrazek, tutaj." and reads the colon's beat twice.
    const text = spoken("Obrazek: ![alt](http://x/y.png) tutaj.\n", "pl");

    expect(text).toBe("Obrazek: obrazek, tutaj.");
    expect(text).not.toContain(": ,");
  });

  it("does not let a placeholder's comma lean on the sentence's terminator", () => {
    // Tidy rule 2, in its two live shapes: a sentinel that ends the sentence,
    // and two adjacent sentinels whose touching commas would otherwise double.
    expect(spoken("Więcej tutaj: https://example.com/a.\n", "pl")).toBe("Więcej tutaj: link.");
    expect(spoken("Dwa ![a](http://x/a.png) ![b](http://x/b.png) obok.\n", "pl")).toBe(
      "Dwa, obrazek, obrazek, obok.",
    );
  });

  it("drops the commas a bracket or a quote already carries", () => {
    // A bracket or a quotation mark is an aside marker in its own right: the
    // voice does not read it, but our comma landing hard against one is heard
    // as a stumble — "Zobacz (, link,) tutaj." The rules knew sentence
    // punctuation and nothing about brackets.
    expect(spoken("Zobacz (https://example.com/a) tutaj.\n", "pl")).toBe("Zobacz (link) tutaj.");
    // An image rather than a bare address, because `strip.ts` ends a bare
    // address at whitespace and would swallow the closing „…” quote into it.
    expect(spoken("Zobacz „![alt](http://x/y.png)” tutaj.\n", "pl")).toBe("Zobacz „obrazek” tutaj.");
    expect(spoken("Zobacz [https://example.com/a] tutaj.\n", "en")).toBe("Zobacz [link] tutaj.");
  });

  it("keeps an em dash's own pause instead of doubling it", () => {
    // The mirror gap: a dash pauses exactly like a terminator, but it needs the
    // space around it kept, which is why it cannot simply join rule 2's class.
    expect(spoken("Tekst ![alt](http://x/y.png) — dalej.\n", "pl")).toBe("Tekst, obrazek — dalej.");
    expect(spoken("Tekst — ![alt](http://x/y.png) dalej.\n", "pl")).toBe("Tekst — obrazek, dalej.");
  });

  it("substitutes a sentinel before the pronunciation map can mangle it", () => {
    // The collision is real and verified against the map, not invented: the
    // stem map holds `code → koud` and the acronym map holds
    // `html → ejcz-ti-em-el`, and neither treats `⟦` as anything but a word
    // boundary. Run the map first and the sentinel is no longer a sentinel —
    // a Polish session then says the literal "⟦koud⟧" out loud, which is what
    // it did before this commit.
    expect(applyPronunciation("⟦code⟧")).toBe("⟦koud⟧");
    expect(applyPronunciation("⟦html⟧")).toBe("⟦ejcz-ti-em-el⟧");

    const text = spoken(everySentinelResponse, "pl");

    expect(text).toContain("blok kodu");
    expect(text).not.toContain("koud");
    expect(text).not.toContain("⟦");
  });

  it("speaks an underscored identifier as its words", () => {
    expect(spoken("Regex HEADING_LINE_RE tutaj.\n", "en")).toBe(
      "Regex variable heading line re tutaj.",
    );
    expect(spoken("Regex HEADING_LINE_RE tutaj.\n", "pl")).toBe(
      "Regex zmienna heading line re tutaj.",
    );

    // `strip.ts` has already unwrapped short inline code, so a backticked
    // identifier arrives here as a bare token and is labelled like any other.
    expect(spoken("Stała `user_id` tutaj.\n", "pl")).toBe("Stała zmienna user id tutaj.");
  });

  it("names a hash instead of spelling it", () => {
    expect(spoken("The tag points at 3f9a2b1c7d today.\n", "en")).toBe(
      "The tag points at hash today.",
    );
    expect(spoken("Skrót 3f9a2b1c7d jest tutaj.\n", "pl")).toBe("Skrót hash jest tutaj.");

    // A digest prefix is part of the token, not a word before it: without this
    // shape the address would be read as "sha256 colon hash".
    expect(spoken("Digest sha256:9f86d081884c7d65 matches.\n", "en")).toBe("Digest hash matches.");
    expect(spoken("Digest md5:0cc175b9c0f1b6a8 matches.\n", "en")).toBe("Digest hash matches.");

    // A hex run buried inside a longer word is not a token. `abc1234def5678xyz`
    // is one word to a reader and must stay one word to the voice — the token
    // boundaries, not the run length, are what decide that.
    expect(spoken("Klucz abc1234def5678xyz tutaj.\n", "en")).toBe("Klucz abc1234def5678xyz tutaj.");
  });

  it("leaves a hex-looking word that has no digit alone", () => {
    // The digit condition is the whole safety argument for the hash rule.
    // `deadbeef` and `defaced` are seven-plus characters drawn entirely from
    // the hex alphabet; drop the condition and the voice eats them as hashes.
    const sentence = "The deadbeef and the defaced facade decade.";

    expect(spoken(`${sentence}\n`, "en")).toBe(sentence);
    expect(spoken(`${sentence}\n`, "pl")).toBe(sentence);
  });

  it("leaves a plain long number alone", () => {
    // The mirror of the digit condition, and not in the contract's table: a run
    // of seven digits is also a run of seven hex characters. A hash has both
    // digits and letters in it; a byte count has only digits and must be read
    // as the number it is.
    expect(spoken("The build produced 1048576 bytes.\n", "en")).toBe(
      "The build produced 1048576 bytes.",
    );
  });

  it("names a UUID instead of spelling it", () => {
    expect(spoken("Session 550e8400-e29b-41d4-a716-446655440000 ended.\n", "en")).toBe(
      "Session identifier ended.",
    );
    expect(spoken("Sesja 550e8400-e29b-41d4-a716-446655440000 zakończona.\n", "pl")).toBe(
      "Sesja identyfikator zakończona.",
    );
  });

  it("does not split camel case", () => {
    // The same rule that would improve `useSpeechHost` ruins `TypeScript` and
    // `GitHub`: capitalisation is not a word boundary, an underscore is. Only
    // the underscore is treated as one.
    const sentence = "We use useSpeechHost with TypeScript and GitHub.";

    expect(spoken(`${sentence}\n`, "en")).toBe(sentence);
  });

  it("applies the pronunciation map after the substitution, not before", () => {
    // The order is verified against the map rather than asserted about it. The
    // acronym table matches `html` only as a STANDALONE word, and `_` is a word
    // character to it, so `HTML_PARSER` is invisible to the map until this
    // stage has split it — run the map first and the acronym is never said.
    expect(applyPronunciation("HTML_PARSER")).toBe("HTML_PARSER");

    expect(spoken("Zmieniamy HTML_PARSER dzisiaj.\n", "pl")).toBe(
      "Zmieniamy zmienna ejcz-ti-em-el parser dzisiaj.",
    );
    // …and the English branch, which never runs the map, keeps the acronym.
    expect(spoken("We change HTML_PARSER today.\n", "en")).toBe(
      "We change variable html parser today.",
    );
  });

  it("leaves a token the path rule has already reduced to whatever it produced", () => {
    // `strip.ts` runs first and its path rule is destructive in both directions.
    // A hash that is a path's last segment keeps its shape, so it is still
    // named here…
    expect(spoken("Zobacz `.git/objects/ab/cdef1234567890` tutaj.\n", "pl")).toBe(
      "Zobacz hash tutaj.",
    );
    // …but an underscored filename has already had its underscores spoken as
    // spaces, which removes the very evidence this stage keys on. It is spoken
    // as bare words with no "zmienna" label — correct, because it was named as
    // a path, not as a variable.
    expect(spoken("Plik `panel/src/features/speech/heading_line_re.ts` tutaj.\n", "pl")).toBe(
      "Plik heading line re.ts tutaj.",
    );
    // And a full-length digest in backticks never reaches the hash rule at all:
    // it is over MAX_SPOKEN_CODE_CHARS and not a path, so it was already named
    // an expression.
    expect(
      spoken(
        "Digest `9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08` tutaj.\n",
        "pl",
      ),
    ).toBe("Digest, wyrażenie, tutaj.");
  });
});
