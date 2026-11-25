import { applyPronunciation, packUnits } from "anytts/text";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { preparePage } from "../pageText";
import { UNIT_MAX_CHARS, prepare, removeMarkers } from "../prepare";

// Pass-through spies: the library still does the work, the tests can see the calls.
vi.mock("anytts/text", async (importOriginal) => {
  const actual = await importOriginal<typeof import("anytts/text")>();
  return {
    ...actual,
    applyPronunciation: vi.fn(actual.applyPronunciation),
    packUnits: vi.fn(actual.packUnits),
  };
});

beforeEach(() => {
  vi.mocked(applyPronunciation).mockClear();
  vi.mocked(packUnits).mockClear();
});

/** Short one-sentence paragraphs. */
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
  // Spaces are what make this an expression rather than a name: a span with
  // none is read as written however long it runs, and never reaches the
  // sentinel at all.
  "Wyrażenie `alfa(beta, gamma) + delta(epsilon)` w zdaniu.",
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

/** One sentence unit: `chars` follows `text`. */
const unit = (text: string, source: string, block: number) => ({ text, chars: text.length, source, block });

/** The first prose paragraph, whole: both its sentences are spoken from it. */
const NO_SENTINEL_FIRST_PARAGRAPH =
  "Panel mówi ostatnią odpowiedź na głos. Dzieli ją najpierw na jednostki, żeby odtwarzanie ruszało szybko.";

const NO_SENTINEL_UNITS = [
  unit("Co się zmieniło", "# Co się zmieniło", 0),
  unit("Panel mówi ostatnią odpowiedź na głos.", NO_SENTINEL_FIRST_PARAGRAPH, 1),
  unit("Dzieli ją najpierw na jednostki, żeby odtwarzanie ruszało szybko.", NO_SENTINEL_FIRST_PARAGRAPH, 1),
  unit(
    "Druga część jest krótka i nie ma w niej niczego do usunięcia.",
    "Druga część jest krótka i nie ma w niej niczego do usunięcia.",
    2,
  ),
  // A mid-body heading keeps its marker in `source` only.
  unit("Trzecia część", "## Trzecia część", 3),
  unit("Ostatni akapit urywa się przecinkiem,", "Ostatni akapit urywa się przecinkiem,", 4),
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

  it("a lead-in stays its own unit before an over-long sentence", () => {
    const huge = "word ".repeat(400) + "ends here.";
    const { units } = prepare(["Here are the steps to follow", "", huge].join("\n"));

    expect(units.every((unit) => unit.chars <= UNIT_MAX_CHARS)).toBe(true);
    expect(units[0].text).toBe("Here are the steps to follow");
  });

  it("a list directly after an unterminated line: the line and every item are units of their own", () => {
    const { units } = prepare(
      ["Steps to follow", "- do this thing first", "- then do the other thing", ""].join("\n"),
    );

    expect(units.map((unit) => unit.text)).toEqual([
      "Steps to follow",
      "do this thing first.",
      "then do the other thing.",
    ]);
  });

  it("a leading removed block is a short unit of its own", () => {
    // A response that opens with a fence, a table or an HTML block starts with
    // a sentinel paragraph: it is unit 0 on its own, and the prose behind it
    // starts at its first sentence.
    const body =
      "The grid keeps its own ordering. It is stored per cell and never derived from the " +
      "DOM, so a reorder survives a reload and two cells never disagree about which of " +
      "them comes first in the list the panel renders.";

    const { units } = prepare(
      ["```ts", "const order = useTerminalOrdering();", "```", "", body, ""].join("\n"),
    );

    expect(units[0].text).toBe("code block.");
    expect(units[1].text).toBe("The grid keeps its own ordering.");
    // Same for a leading table, and the sentinel still stands before the prose
    // it replaced rather than being hoisted past it.
    const table = prepare(["| a | b |", "| - | - |", "", body, ""].join("\n"));

    expect(table.units[0].text).toBe("table.");
    expect(table.units[1].text).toBe("The grid keeps its own ordering.");
  });

  it("a leading removed block keeps the TLDR behind it in order", () => {
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

    expect(units.map((unit) => unit.text)).toEqual([
      "code block.",
      "TLDR: the fence above is noise.",
      "The sentence after it is not, and both of them have to reach the listener in the order the answer wrote them.",
      "Body paragraph that follows the summary.",
    ]);
  });

  it("a leading TLDR paragraph's sentences follow the heading", () => {
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

    expect(units.map((unit) => unit.text)).toEqual([
      "What changed",
      "TLDR: Responses are spoken.",
      "A second sentence rides along in the same TLDR paragraph.",
      "Body paragraph follows here.",
    ]);
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

  it("short paragraphs stay separate units and a long one is cut into its sentences", () => {
    const { units } = prepare(packingResponse);

    for (const unit of units) {
      expect(unit.chars).toBe(unit.text.length);
      expect(unit.chars).toBeLessThanOrEqual(UNIT_MAX_CHARS);
    }

    // No merging: each short paragraph is exactly one unit.
    for (const n of [1, 2, 3, 4, 5]) {
      expect(units.filter((unit) => unit.text === short(n))).toHaveLength(1);
    }

    // The oversized paragraph is one unit per sentence.
    const cut = units.filter((unit) => unit.text.includes("push the paragraph past the ceiling"));
    expect(cut).toHaveLength(12);
  });

  it("prepares every paragraph of a long response", () => {
    // Twelve paragraphs of ~240 characters: well past a page of speech.
    const markdown = Array.from({ length: 12 }, (_, i) => {
      const head = `Paragraph ${String(i).padStart(2, "0")} `;
      return head + "x".repeat(238 - head.length) + ".";
    }).join("\n\n");

    const prepared = prepare(markdown);
    const spent = prepared.units.reduce((sum, unit) => sum + unit.chars, 0);

    expect(spent).toBeGreaterThan(1300);
    // The last paragraph is prepared like every other one: nothing is held back.
    expect(prepared.units.map((unit) => unit.text).join(" ")).toContain("Paragraph 11");
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

  it("prepare no longer respells", () => {
    // Respelling is anytts' job now, per engine, at synthesis: the panel hands
    // over the text as written, on either branch.
    const polish = "Zrobiłem deploy na Cloudflare, a codebase czyta code.";
    const spoken = prepare(polish, { language: "pl" });

    expect(spoken.language).toBe("pl");
    expect(spoken.units[0].text).toBe(polish);
    expect(prepare(polish, { language: "en" }).units[0].text).toBe(polish);
    expect(applyPronunciation).not.toHaveBeenCalled();

    // `source` is still what the answer pane matches against the rendered blocks.
    const { units } = prepare(["## Wdrożenie", "", "Zrobiłem **deploy** na Cloudflare.", ""].join("\n"), {
      language: "pl",
    });
    expect(units.map((unit) => unit.source)).toEqual(["## Wdrożenie", "Zrobiłem **deploy** na Cloudflare."]);
    expect(units.map((unit) => unit.text)).toEqual(["Wdrożenie", "Zrobiłem deploy na Cloudflare."]);
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
  it.each<[lang: "pl" | "en", words: string[]]>([
    // `blok HTML` goes to synthesis as written: anytts' map says the acronym there.
    ["pl", ["blok kodu", "tabela", "blok HTML", "obrazek", "link", "wyrażenie"]],
    ["en", ["code block", "table", "HTML block", "image", "link", "expression"]],
  ])("speaks every sentinel in the voice language (%s)", (lang, words) => {
    const text = spoken(everySentinelResponse, lang);

    for (const word of words) expect(text).toContain(word);
    // No sentinel may reach synthesis: the voice would spell the brackets out.
    expect(text).not.toContain("⟦");
    expect(text).not.toContain("⟧");
  });

  // The tidy rules around a spoken placeholder: its commas give the listener a
  // pause, but must never double, lean on other punctuation or stand before a
  // terminator, a bracket or a dash that already pauses on its own.
  it.each<[label: string, markdown: string, lang: "pl" | "en", expected: string]>([
    // No space before a comma, no doubled comma, no comma leaning on other
    // punctuation — and the pauses the commas exist for are still there: a tidy
    // pass that swallowed them would ruin the diction.
    [
      "no doubled comma or stray space around a substitution, pauses kept",
      "Obrazek ![alt](http://x/y.png) w środku, adres https://example.com/a też.\n\nKod poniżej:\n\n```ts\nconst x = 1;\n```\n",
      "pl",
      "Obrazek, obrazek, w środku, adres, link, też. Kod poniżej: blok kodu.",
    ],
    // A block is never joined to its neighbour, so a heading and the
    // placeholder behind it are two utterances — the unit edge is the pause, and
    // neither carries a comma for it (this helper joins units with a space).
    [
      "a placeholder after a heading is an utterance of its own (pl)",
      "Wstęp jest tutaj.\n\n## Wyniki\n\n```ts\nconst x = 1;\n```\n\nDalszy akapit tutaj.\n",
      "pl",
      "Wstęp jest tutaj. Wyniki blok kodu. Dalszy akapit tutaj.",
    ],
    [
      "a placeholder after a heading is an utterance of its own (en)",
      "Wstęp jest tutaj.\n\n## Wyniki\n\n```ts\nconst x = 1;\n```\n\nDalszy akapit tutaj.\n",
      "en",
      "Wstęp jest tutaj. Wyniki code block. Dalszy akapit tutaj.",
    ],
    // …and when the paragraph before carries its own punctuation, that one wins.
    ["a placeholder paragraph after a colon paragraph drops our comma", "Kod poniżej:\n\n```ts\nconst x = 1;\n```\n", "pl", "Kod poniżej: blok kodu."],
    // Tidy rule 1, colon and sentinel in the SAME paragraph — else "Obrazek: , obrazek, tutaj."
    ["the author's own pause after a colon is kept", "Obrazek: ![alt](http://x/y.png) tutaj.\n", "pl", "Obrazek: obrazek, tutaj."],
    // Tidy rule 2, in its two live shapes.
    ["a sentinel ending the sentence leaves no comma before the terminator", "Więcej tutaj: https://example.com/a.\n", "pl", "Więcej tutaj: link."],
    ["two adjacent sentinels' touching commas do not double", "Dwa ![a](http://x/a.png) ![b](http://x/b.png) obok.\n", "pl", "Dwa, obrazek, obrazek, obok."],
    // A bracket or quote is an aside marker in its own right — "Zobacz (, link,) tutaj."
    ["round brackets carry their own pause", "Zobacz (https://example.com/a) tutaj.\n", "pl", "Zobacz (link) tutaj."],
    // An image, because `strip.ts` ends a bare address at whitespace and would swallow the „…” quote.
    ["quotation marks carry their own pause", "Zobacz „![alt](http://x/y.png)” tutaj.\n", "pl", "Zobacz „obrazek” tutaj."],
    ["square brackets carry their own pause", "Zobacz [https://example.com/a] tutaj.\n", "en", "Zobacz [link] tutaj."],
    // A dash pauses like a terminator but keeps the space around it.
    ["an em dash after the placeholder keeps its own pause", "Tekst ![alt](http://x/y.png) — dalej.\n", "pl", "Tekst, obrazek — dalej."],
    ["an em dash before the placeholder keeps its own pause", "Tekst — ![alt](http://x/y.png) dalej.\n", "pl", "Tekst — obrazek, dalej."],
  ])("placeholder punctuation: %s", (_label, markdown, lang, expected) => {
    expect(spoken(markdown, lang)).toBe(expected);
  });

  it("keeps a paragraph that is only a placeholder, and never opens an utterance with a comma", () => {
    // A response that opens with a fence: the sentinel-only paragraph is
    // hoisted into its own unit, so the substitution must make it speakable —
    // an empty unit 0 is a synthesis round trip for silence. And a unit is
    // exactly what synthesis receives, so a leading comma is a beat before the
    // first word (tidy rule 4).
    const { units } = prepare("```ts\nconst x = 1;\n```\n\nZaczynamy od tego.\n", {
      language: "pl",
    });

    expect(units[0].text).toBe("blok kodu.");
    for (const unit of units) {
      expect(unit.text.length).toBeGreaterThan(0);
      expect(unit.text).not.toMatch(/^\s*,/);
      expect(unit.chars).toBe(unit.text.length);
    }
  });

  it("changes nothing for a response with no sentinels", () => {
    // A pin, not a new behaviour: it passed before this change and must keep
    // passing. The substitution returns the text untouched when no sentinel
    // stood in it, so the tidy pass never runs over ordinary prose.
    for (const lang of ["pl", "en"] as const) {
      expect(prepare(noSentinelResponse, { language: lang }).units).toEqual(
        NO_SENTINEL_UNITS.map((unit) => ({ ...unit, lang })),
      );
    }
  });

  it("substitutes a sentinel before the pronunciation map can mangle it", () => {
    // The collision is real and verified against the map, not invented: the
    // stem map holds `code → koud` and the acronym map holds
    // `html → ejcz ti em el`, and neither treats `⟦` as anything but a word
    // boundary. Run the map first and the sentinel is no longer a sentinel —
    // a Polish session then says the literal "⟦koud⟧" out loud. anytts applies
    // the map at synthesis, after preparation has worded every sentinel.
    expect(applyPronunciation("⟦code⟧", "pl")).toBe("⟦koud⟧");
    expect(applyPronunciation("⟦html⟧", "pl")).toBe("⟦ejcz ti em el⟧");
    // The token stage is ordered the same way: the acronym table matches `html`
    // only as a STANDALONE word and `_` is a word character to it, so
    // `HTML_PARSER` is invisible to the map until the split (see the token table).
    expect(applyPronunciation("HTML_PARSER", "pl")).toBe("HTML_PARSER");

    const text = spoken(everySentinelResponse, "pl");

    expect(text).toContain("blok kodu");
    expect(text).not.toContain("koud");
    expect(text).not.toContain("⟦");
  });

  // Tokens a voice cannot read are named or split into words.
  it.each<[label: string, markdown: string, lang: "pl" | "en", expected: string]>([
    ["an underscored identifier is spoken as its words (en)", "Regex HEADING_LINE_RE tutaj.\n", "en", "Regex variable heading line re tutaj."],
    ["an underscored identifier is spoken as its words (pl)", "Regex HEADING_LINE_RE tutaj.\n", "pl", "Regex zmienna heading line re tutaj."],
    // `strip.ts` has already unwrapped short inline code.
    ["a backticked identifier arrives bare and is labelled", "Stała `user_id` tutaj.\n", "pl", "Stała zmienna user id tutaj."],
    ["a hash is named, not spelled (en)", "The tag points at 3f9a2b1c7d today.\n", "en", "The tag points at hash today."],
    ["a hash is named, not spelled (pl)", "Skrót 3f9a2b1c7d jest tutaj.\n", "pl", "Skrót hash jest tutaj."],
    // A digest prefix is part of the token — else "sha256 colon hash".
    ["a sha256: digest is one hash", "Digest sha256:9f86d081884c7d65 matches.\n", "en", "Digest hash matches."],
    ["an md5: digest is one hash", "Digest md5:0cc175b9c0f1b6a8 matches.\n", "en", "Digest hash matches."],
    // Token boundaries, not run length, decide what a token is.
    ["a hex run buried inside a longer word stays one word", "Klucz abc1234def5678xyz tutaj.\n", "en", "Klucz abc1234def5678xyz tutaj."],
    // The digit condition is the whole safety argument for the hash rule.
    ["hex-looking words with no digit are left alone (en)", "The deadbeef and the defaced facade decade.\n", "en", "The deadbeef and the defaced facade decade."],
    ["hex-looking words with no digit are left alone (pl)", "The deadbeef and the defaced facade decade.\n", "pl", "The deadbeef and the defaced facade decade."],
    // The mirror of the digit condition: a byte count has only digits.
    ["a plain long number is left alone", "The build produced 1048576 bytes.\n", "en", "The build produced 1048576 bytes."],
    ["a UUID is named (en)", "Session 550e8400-e29b-41d4-a716-446655440000 ended.\n", "en", "Session identifier ended."],
    ["a UUID is named (pl)", "Sesja 550e8400-e29b-41d4-a716-446655440000 zakończona.\n", "pl", "Sesja identyfikator zakończona."],
    // Capitalisation is not a word boundary: splitting it ruins `TypeScript` and `GitHub`.
    ["camel case is not split", "We use useSpeechHost with TypeScript and GitHub.\n", "en", "We use useSpeechHost with TypeScript and GitHub."],
    // The split hands anytts' map (at synthesis) a standalone acronym it can say.
    ["the split leaves the acronym standing: HTML_PARSER (pl)", "Zmieniamy HTML_PARSER dzisiaj.\n", "pl", "Zmieniamy zmienna html parser dzisiaj."],
    ["the split leaves the acronym standing: HTML_PARSER (en)", "We change HTML_PARSER today.\n", "en", "We change variable html parser today."],
    // `strip.ts` runs first and its path rule is destructive in both directions.
    ["a hash that is a path's last segment is still named", "Zobacz `.git/objects/ab/cdef1234567890` tutaj.\n", "pl", "Zobacz hash tutaj."],
    // Its underscores were already spoken as spaces: named as a path, not a variable.
    ["an underscored filename in a path gets no variable label", "Plik `panel/src/features/speech/heading_line_re.ts` tutaj.\n", "pl", "Plik heading line re.ts tutaj."],
    // One token, so the length cap no longer names it an expression on the way past.
    ["a full-length backticked digest reaches the hash rule", "Digest `9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08` tutaj.\n", "pl", "Digest hash tutaj."],
  ])("tokens: %s", (_label, markdown, lang, expected) => {
    expect(spoken(markdown, lang)).toBe(expected);
  });

  it("every unit carries the block it was spoken from", () => {
    const { units } = prepare(packingResponse);

    for (const unit of units) {
      expect(unit.source.length).toBeGreaterThan(0);
      expect(unit.chars).toBe(unit.text.length);
    }

    // A one-sentence paragraph is its own unit and its own source.
    expect(units[2].text).toBe(short(1));
    expect(units[2].source).toBe(short(1));
  });

  it("source keeps the heading and TLDR markers the spoken text removes", () => {
    const tldr = "**TLDR:** Responses are spoken. A second sentence rides along in the same TLDR paragraph.";
    const { units } = prepare(["## What changed", "", tldr, "", "Body paragraph follows here.", ""].join("\n"));

    expect(units[0].text).toBe("What changed");
    expect(units[0].source).toBe("## What changed");
    expect(units[1].text).not.toContain("**");
    expect(units[1].source).toBe(tldr);
    expect(units[2].source).toBe(tldr);
    expect(units[3].source).toBe("Body paragraph follows here.");
  });

  it("source keeps the sentinel the spoken text words", () => {
    const { units } = prepare("```ts\nconst x = 1;\n```\n\nZaczynamy od tego.\n", {
      language: "pl",
    });

    expect(units[0].text).toBe("blok kodu.");
    expect(units[0].source).toBe("⟦code⟧");

    // A sentinel packed inside prose stays a sentinel in `source` too.
    const worded = prepare(everySentinelResponse, { language: "pl" }).units.find((unit) =>
      unit.text.includes("blok kodu"),
    );
    expect(worded?.source).toContain("⟦code⟧");
    expect(worded?.source).not.toContain("blok kodu");
  });

  it("pieces cut from one paragraph share the paragraph as their source", () => {
    // A paragraph's sentences are all spoken from the whole paragraph.
    const first = "Opening sentence here. The rest of the paragraph carries on for a while after it.";
    const split = prepare(`${first}\n\nA second paragraph closes the answer.\n`).units;
    expect(split[0].text).toBe("Opening sentence here.");
    expect(split[0].source).toBe(first);
    expect(split[1].text.startsWith("The rest of the paragraph")).toBe(true);
    expect(split[1].source.startsWith(first)).toBe(true);

    // An oversized paragraph falls into several pieces, each carrying the
    // paragraph whole.
    const sentence = "This sentence is long enough to matter when it is repeated many times over.";
    const oversized = Array.from({ length: 12 }, () => sentence).join(" ");
    const { units } = prepare(`**TLDR:** Short.\n\n${oversized}\n`);
    const pieces = units.filter((unit) => unit.text.startsWith(sentence));
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.source).toBe(oversized);
  });

  it("list items are units of their own, each carrying only its item as source", () => {
    const items = Array.from(
      { length: 6 },
      (_, i) => `Item ${i + 1} explains one more thing about the rail in sixty chars`,
    );

    const { units } = prepare(`# Rail\n\n${items.map((item) => `- ${item}`).join("\n")}\n`);

    expect(units[0].text).toBe("Rail");
    expect(units.slice(1).map((unit) => [unit.text, unit.source, unit.block])).toEqual(
      items.map((item, i) => [`${item}.`, `${item}.`, i + 1]),
    );
  });
});

describe("sentence units", () => {
  const texts = (markdown: string): string[] => prepare(markdown, { language: "en" }).units.map((unit) => unit.text);

  it("a heading is one unit and each following sentence is its own unit", () => {
    const { units } = prepare(
      ["## What changed", "", "The panel speaks. It speaks per sentence. Nothing is packed."].join("\n"),
      { language: "en" },
    );

    expect(units.map((unit) => unit.text)).toEqual([
      "What changed",
      "The panel speaks.",
      "It speaks per sentence.",
      "Nothing is packed.",
    ]);
    expect(units.map((unit) => unit.block)).toEqual([0, 1, 1, 1]);
  });

  it("no unit crosses a block boundary", () => {
    expect(texts(["First short one.", "", "Second short one."].join("\n"))).toEqual([
      "First short one.",
      "Second short one.",
    ]);

    // Every unit carries the index of the block it came from, on any text.
    const { units } = prepare(
      ["# Title", "", "Lead in:", "", "- One. Two.", "- Three.", "", "```ts", "x", "```", "", "Tail."].join("\n"),
    );
    expect(units.map((unit) => [unit.text, unit.block])).toEqual([
      ["Title", 0],
      ["Lead in:", 1],
      ["One.", 2],
      ["Two.", 2],
      ["Three.", 3],
      ["code block.", 4],
      ["Tail.", 5],
    ]);
  });

  it("answer list items are separate units", () => {
    expect(texts(["- The player keeps its place.", "- The bar folds away.", "- Units are cached."].join("\n"))).toEqual([
      "The player keeps its place.",
      "The bar folds away.",
      "Units are cached.",
    ]);
  });

  it("heading then TLDR keeps the TLDR's first sentence as unit 1", () => {
    const units = texts(
      ["## What changed", "", "**TLDR:** Responses are spoken. A second sentence follows.", "", "Body."].join("\n"),
    );

    expect(units).toEqual(["What changed", "TLDR: Responses are spoken.", "A second sentence follows.", "Body."]);
  });

  it("an over-long sentence is cut at the ceiling", () => {
    const long = `${"word ".repeat(199)}ends.`;
    expect(long.length).toBeGreaterThanOrEqual(1000);
    const { units } = prepare(`Short lead. ${long} Tail sentence.`);

    expect(units[0].text).toBe("Short lead.");
    expect(units[units.length - 1].text).toBe("Tail sentence.");
    const cut = units.slice(1, -1);
    expect(cut.length).toBeGreaterThan(1);
    for (const unit of cut) expect(unit.chars).toBeLessThanOrEqual(UNIT_MAX_CHARS);
    expect(cut.map((unit) => unit.text).join(" ")).toBe(long);
  });

  it("pages and answers prepare the same markdown to the same units", () => {
    const markdown = [
      "# Release notes",
      "",
      "**TLDR:** It ships. It works.",
      "",
      "Here is what changed:",
      "",
      "- The player keeps its place.",
      "- The bar folds away.",
      "",
      "## Details",
      "Short paragraph one. Short paragraph two.",
    ].join("\n");

    expect(preparePage(markdown, "en").units.map((unit) => unit.text)).toEqual(texts(markdown));
  });
});

describe("removeMarkers", () => {
  const preview = (text: string) => removeMarkers(text, { keepLiteralAsterisks: true });

  // Every lone-asterisk case is one an operand-recognition rule once missed. The
  // rule is now that nothing but a bullet or an emphasis pair loses its `*`.
  it.each<[input: string, expected: string]>([
    // Products whose operands touch the asterisk.
    ["2*3 and 4*5", "2*3 and 4*5"],
    ["a*b*c", "a*b*c"],
    ["(a)*(b)", "(a)*(b)"],
    // An asterisk with whitespace on both sides.
    ["5 * -3", "5 * -3"],
    ["(a) * (b)", "(a) * (b)"],
    ["2 * 3 = 6", "2 * 3 = 6"],
    ["(a + b) * c", "(a + b) * c"],
    ["5*-3", "5*-3"],
    ["x *= 2", "x *= 2"],
    ["a ** b", "a ** b"],
    ["see note*", "see note*"],
    ["*nix and 3 * 4", "*nix and 3 * 4"],
    // Emphasis is still unwrapped and bullets dropped.
    ["**bold**, *em* and (*aside*)", "bold, em and (aside)"],
    ["**bold** and *em*", "bold and em"],
    ["__bold__ and _em_", "bold and em"],
    // The marker and its gap go; the indent stays for the preview to collapse.
    ["* item", "item"],
    ["* first\n  * nested", "first\n  nested"],
    ["- first\n  - nested", "first\n  nested"],
    ["*em* then 2*3", "em then 2*3"],
  ])("preview keeps literal asterisks: %j → %j", (input, expected) => {
    expect(preview(input)).toBe(expected);
  });

  // Speech never says "asterisk": every `*` goes, products included.
  it.each<[input: string, expected: string]>([
    ["2*3 and 4*5", "23 and 45"],
    ["a*b*c", "abc"],
    ["5 * -3", "5  -3"],
    ["**bold**, *em* and * bullet", "bold, em and  bullet"],
  ])("speech's default sweep drops every asterisk: %j → %j", (input, expected) => {
    expect(removeMarkers(input)).toBe(expected);
  });
});

describe("prepare: blocks", () => {
  /** An 80-character paragraph of one sentence. */
  const eighty = (word: string): string => {
    const text = `The ${word} paragraph talks about the panel and its speech for a while`.padEnd(79, "x");
    return `${text}.`;
  };

  /** `sentence` said `count` times, space-joined. */
  const sentences = (sentence: string, count: number): string => Array(count).fill(sentence).join(" ");

  it("blocks: short blocks stay separate units", () => {
    const first = eighty("first");
    const second = eighty("second");
    expect(first).toHaveLength(80);
    const page = ["# Title", "", first, "", second].join("\n");

    const { units } = prepare(page);

    expect(units.map((unit) => unit.text)).toEqual(["Title", first, second]);
    expect(units.map((unit) => unit.block)).toEqual([0, 1, 2]);
  });

  it("blocks: a long block splits within the ceiling", () => {
    const long = sentences("This sentence exists to make one paragraph run past the ceiling.", 16);
    expect(long.length).toBeGreaterThanOrEqual(1000);
    const before = "A short paragraph before it.";
    const after = "A short paragraph after it.";
    const page = [before, "", long, "", after].join("\n");

    const { units } = prepare(page);

    const longUnits = units.filter((unit) => unit.block === 1);
    expect(longUnits.length).toBeGreaterThan(1);
    for (const unit of longUnits) {
      expect(unit.chars).toBeLessThanOrEqual(UNIT_MAX_CHARS);
      expect(unit.text).not.toContain("short paragraph");
      expect(long).toContain(unit.text);
    }
    expect(longUnits.map((unit) => unit.text).join(" ")).toBe(long);
    expect(units[0]).toMatchObject({ text: before, block: 0 });
    expect(units[units.length - 1]).toMatchObject({ text: after, block: 2 });
  });

  it("blocks: list items start their own units", () => {
    const page = ["Here is what changed:", "", "- The player keeps its place.", "- The bar folds away.", "- Units are cached."].join(
      "\n",
    );

    const { units } = prepare(page);

    expect(units.map((unit) => [unit.text, unit.block])).toEqual([
      ["Here is what changed:", 0],
      ["The player keeps its place.", 1],
      ["The bar folds away.", 2],
      ["Units are cached.", 3],
    ]);
  });

  it("blocks: a heading glued to its paragraph is a block of its own", () => {
    const page = ["Intro sentence here.", "", "## Details", "Detail sentence one. Detail sentence two."].join("\n");

    const { units } = prepare(page);

    expect(units.map((unit) => [unit.text, unit.source, unit.block])).toEqual([
      ["Intro sentence here.", "Intro sentence here.", 0],
      ["Details", "## Details", 1],
      ["Detail sentence one.", "Detail sentence one. Detail sentence two.", 2],
      ["Detail sentence two.", "Detail sentence one. Detail sentence two.", 2],
    ]);
  });

  it("blocks: a removed block's placeholder is a block of its own", () => {
    const page = ["Before the code.", "", "```ts", "const x = 1;", "```", "", "After the code."].join("\n");

    const { units } = prepare(page, { language: "pl" });

    expect(units.map((unit) => [unit.text, unit.source, unit.block])).toEqual([
      ["Before the code.", "Before the code.", 0],
      ["blok kodu.", "⟦code⟧", 1],
      ["After the code.", "After the code.", 2],
    ]);
  });

  it("blocks: a two-paragraph blockquote is two blocks", () => {
    const page = ["> The first quoted paragraph.", ">", "> The second quoted paragraph."].join("\n");

    const { units } = prepare(page);

    expect(units.map((unit) => unit.block)).toEqual([0, 1]);
    expect(units[0].source).toContain("first quoted paragraph");
    expect(units[0].source).not.toContain("second");
    expect(units[1].source).toContain("second quoted paragraph");
  });

  it("blocks: a setext heading followed directly by prose is two blocks", () => {
    for (const underline of ["=====", "-----"]) {
      const page = ["The Title", underline, "Body prose right under the title."].join("\n");

      const { units } = prepare(page);

      expect(units.map((unit) => unit.block), underline).toEqual([0, 1]);
      expect(units[0].source, underline).toContain("The Title");
      expect(units[0].source, underline).not.toContain("Body");
      expect(units[1].source, underline).toBe("Body prose right under the title.");
    }
  });

  it("blocks: a setext heading's underline is neither spoken nor in its source", () => {
    for (const underline of ["=====", "-----"]) {
      const { units } = prepare(["Title", underline, "Body"].join("\n"));

      expect(units.map((unit) => [unit.source, unit.text, unit.block]), underline).toEqual([
        ["Title", "Title", 0],
        ["Body", "Body", 1],
      ]);
    }
  });

  it("blocks: a quoted ATX heading is a block of its own, spoken without its markers", () => {
    const { units } = prepare(["> ## Quoted Heading", "> Quoted prose under it."].join("\n"));

    expect(units.map((unit) => [unit.source, unit.text, unit.block])).toEqual([
      ["> ## Quoted Heading", "Quoted Heading", 0],
      ["> Quoted prose under it.", "> Quoted prose under it.", 1],
    ]);
  });

  it("blocks: a quoted setext heading is a block of its own, its underline dropped", () => {
    for (const underline of ["> =====", "> -----"]) {
      const { units } = prepare(["> Quoted Title", underline, "> Quoted prose under it."].join("\n"));

      expect(units.map((unit) => [unit.source, unit.text, unit.block]), underline).toEqual([
        ["> Quoted Title", "Quoted Title", 0],
        ["> Quoted prose under it.", "> Quoted prose under it.", 1],
      ]);
    }
  });

  it("blocks: a quoted underline under an unquoted line is no setext heading", () => {
    for (const underline of ["> ===", "> ---"]) {
      const page = ["Intro", underline, "> Quoted text"].join("\n");

      const { units } = prepare(page);

      // The underline sits in the quote, the line above it outside: markdown
      // renders a paragraph and a quote, never a heading "Intro". The quoted
      // underline stays literal text, in source and in speech.
      expect(units.map((unit) => unit.source), underline).toEqual([page]);
      expect(units[0].text, underline).toContain(underline.slice(2));
      expect(units[0].text, underline).toContain("Intro");
    }
  });

  it("blocks: a setext underline must sit at the same quote depth as its heading", () => {
    // Same container, nested: still a heading.
    const nested = prepare(["> > Deep Title", "> > =====", "> > Deep prose."].join("\n"));
    expect(nested.units.map((unit) => [unit.source, unit.text, unit.block])).toEqual([
      ["> > Deep Title", "Deep Title", 0],
      ["> > Deep prose.", "> > Deep prose.", 1],
    ]);

    // One level deeper than the line above it: not an underline of that line.
    const deeper = ["> Outer line", "> > =====", "> > Inner text"].join("\n");
    expect(prepare(deeper).units.map((unit) => unit.source)).toEqual([deeper]);
  });

  it("answers take the same sentence units as pages", () => {
    const repeated = "This sentence exists to push the paragraph past the ceiling.";
    const answer = [
      "# Release notes",
      "",
      "Here is what changed:",
      "",
      "- The player keeps its place.",
      "- The bar folds away.",
      "- Units are cached.",
      "",
      "## Details",
      "Short paragraph one about the panel.",
      "",
      "Short paragraph two about the speech units.",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      sentences(repeated, 9),
    ].join("\n");

    const prepared = prepare(answer, { language: "pl" });

    expect(prepared.language).toBe("pl");
    expect(prepared.units.map((unit) => [unit.text, unit.source, unit.block])).toEqual([
      ["Release notes", "# Release notes", 0],
      ["Here is what changed:", "Here is what changed:", 1],
      ["The player keeps its place.", "The player keeps its place.", 2],
      ["The bar folds away.", "The bar folds away.", 3],
      ["Units are cached.", "Units are cached.", 4],
      ["Details", "## Details", 5],
      ["Short paragraph one about the panel.", "Short paragraph one about the panel.", 6],
      ["Short paragraph two about the speech units.", "Short paragraph two about the speech units.", 7],
      ["blok kodu.", "⟦code⟧", 8],
      ...Array.from({ length: 9 }, () => [repeated, sentences(repeated, 9), 9]),
    ]);
    for (const unit of prepared.units) expect(unit).toMatchObject({ lang: "pl", chars: unit.text.length });
  });
});

describe("sentence units", () => {
  const texts = (markdown: string, language: "pl" | "en" = "en"): string[] =>
    prepare(markdown, { language }).units.map((unit) => unit.text);

  it("English abbreviations do not end a sentence", () => {
    expect(texts("Use tools, e.g. grep and rg. Then stop.\n")).toEqual(["Use tools, e.g. grep and rg.", "Then stop."]);
    expect(texts("Mr. Smith agrees, i.e. yes. Dr. Jones does not.\n")).toEqual([
      "Mr. Smith agrees, i.e. yes.",
      "Dr. Jones does not.",
    ]);
    expect(texts("See Fig. 3 and compare A vs. B. Done.\n")).toEqual(["See Fig. 3 and compare A vs. B.", "Done."]);
  });

  it("Polish abbreviations do not end a sentence", () => {
    expect(texts("Używamy narzędzi, np. grep i rg. Potem koniec.\n", "pl")).toEqual([
      "Używamy narzędzi, np. grep i rg.",
      "Potem koniec.",
    ]);
    expect(texts("To jest tzw. szybki start, m.in. dla odpowiedzi.\n", "pl")).toEqual([
      "To jest tzw. szybki start, m.in. dla odpowiedzi.",
    ]);
    expect(texts("Spotkanie ul. Długa 5, godz. 10. Prof. Nowak będzie.\n", "pl")).toEqual([
      "Spotkanie ul. Długa 5, godz. 10.",
      "Prof. Nowak będzie.",
    ]);
    // A list-closing "itd." followed by a capital still ends the sentence.
    expect(texts("Mamy jabłka, gruszki itd. Reszta później.\n", "pl")).toEqual([
      "Mamy jabłka, gruszki itd.",
      "Reszta później.",
    ]);
  });

  it("a terminator inside inline code does not end a sentence", () => {
    expect(texts("Run `pnpm test.` now. Then commit.\n")).toEqual(["Run pnpm test. now.", "Then commit."]);
  });

  it("a heading with a full stop stays one unit", () => {
    expect(texts("## Step 1. Install\n\nRun it.\n")).toEqual(["Step 1. Install", "Run it."]);
  });

  // Pinned on purpose: the lowercase-or-digit rule that keeps "e.g. grep" and
  // "No. 5" whole cannot tell them from a real sentence that happens to open
  // lowercase or with a digit. Splitting these would re-halve the
  // abbreviations above, so the join is the accepted trade, not a bug.
  it("a sentence starting lowercase joins the previous one (known limitation)", () => {
    expect(texts("Then deps are fetched. npm install runs next.\n")).toEqual([
      "Then deps are fetched. npm install runs next.",
    ]);
    expect(texts("Six cookies were baked. 4 were eaten.\n")).toEqual(["Six cookies were baked. 4 were eaten."]);
  });
});
