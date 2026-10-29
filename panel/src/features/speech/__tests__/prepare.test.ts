import { applyPronunciation, packUnits } from "anytts/text";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNIT_MAX_CHARS, UNIT_MIN_CHARS, prepare, removeMarkers } from "../prepare";

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

/** The first prose paragraph, whole: the fast-start sentence and its remainder are both spoken from it. */
const NO_SENTINEL_FIRST_PARAGRAPH =
  "Panel mówi ostatnią odpowiedź na głos. Dzieli ją najpierw na jednostki, żeby odtwarzanie ruszało szybko.";

const NO_SENTINEL_UNITS = [
  { text: "Co się zmieniło", chars: 15, source: "# Co się zmieniło" },
  {
    text: "Panel mówi ostatnią odpowiedź na głos.",
    chars: 38,
    source: NO_SENTINEL_FIRST_PARAGRAPH,
  },
  {
    text:
      "Dzieli ją najpierw na jednostki, żeby odtwarzanie ruszało szybko. " +
      "Druga część jest krótka i nie ma w niej niczego do usunięcia. " +
      "Trzecia część Ostatni akapit urywa się przecinkiem,",
    chars: 179,
    // The same packing as `text`, with the mid-body heading's marker kept and
    // the remainder standing in for its whole paragraph.
    source:
      `${NO_SENTINEL_FIRST_PARAGRAPH} ` +
      "Druga część jest krótka i nie ma w niej niczego do usunięcia. " +
      "## Trzecia część Ostatni akapit urywa się przecinkiem,",
  },
];

/** Ordinals for the intro-colon list fixture, so its items can be built and checked from one list. */
const NUMBERED = ["one", "two", "three", "four", "five", "six"];

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

  it("an intro line ending in a colon still yields a short fast-start unit", () => {
    // The shape an agent answer takes constantly: a lead-in ending in a colon,
    // then a tight list. Every item is a paragraph of its own now, so the
    // lead-in stands alone as a sentence fragment — unit 0 stays short only if
    // the fast start may finish that sentence in the paragraph behind it.
    const item = (n: string): string => `item ${n} is long enough to matter here`;
    const { units } = prepare(
      ["Here are the steps:", ...NUMBERED.map((n) => `- ${item(n)}`), ""].join("\n"),
    );

    const fastStart = `Here are the steps: ${item("one")}.`;

    expect(units[0].text).toBe(fastStart);
    expect(units[0].chars).toBeLessThan(UNIT_MIN_CHARS);
    // Both blocks are spoken in it, so both name it — see `matchUnitsToBlocks`.
    expect(units[0].source).toBe(fastStart);
    // The items behind the fast start are still spoken, in order and once each.
    expect(units.map((unit) => unit.text).join(" ")).toBe(
      [fastStart, ...NUMBERED.slice(1).map((n) => `${item(n)}.`)].join(" "),
    );
  });

  it("a lead-in whose next sentence exceeds the ceiling falls back to packing", () => {
    // The cross-paragraph fast start builds unit 0 before packing runs, so
    // nothing downstream would cut it: a lead-in with no sentence of its own
    // followed by one enormous sentence used to hand playback a 2 000-character
    // unit 0 — the very thing the fast start exists to prevent. Over the
    // ceiling, the rule stands down and the normal packing path cuts it.
    const huge = "word ".repeat(400) + "ends here.";
    const { units } = prepare(["Here are the steps to follow", "", huge].join("\n"));

    expect(units.every((unit) => unit.chars <= UNIT_MAX_CHARS)).toBe(true);
    expect(units[0].chars).toBe(28);
  });

  it("a list directly after an unterminated line still starts small", () => {
    const { units } = prepare(
      ["Steps to follow", "- do this thing first", "- then do the other thing", ""].join("\n"),
    );

    expect(units[0].text).toBe("Steps to follow do this thing first.");
    expect(units[1].text).toBe("then do the other thing.");
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
  ])("speaks every sentinel in the session language (%s)", (lang, words) => {
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
    // A paragraph start is NOT an utterance start: `packUnits` joins paragraphs
    // with a space, so a heading (stripped to bare words, no terminator) runs
    // into the placeholder behind it — "Wyniki blok kodu" is one noun phrase.
    [
      "a placeholder opening a paragraph still pauses after a heading (pl)",
      "Wstęp jest tutaj.\n\n## Wyniki\n\n```ts\nconst x = 1;\n```\n\nDalszy akapit tutaj.\n",
      "pl",
      "Wstęp jest tutaj. Wyniki, blok kodu. Dalszy akapit tutaj.",
    ],
    [
      "a placeholder opening a paragraph still pauses after a heading (en)",
      "Wstęp jest tutaj.\n\n## Wyniki\n\n```ts\nconst x = 1;\n```\n\nDalszy akapit tutaj.\n",
      "en",
      "Wstęp jest tutaj. Wyniki, code block. Dalszy akapit tutaj.",
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

  it("every unit carries the packed text it was spoken from", () => {
    const { units } = prepare(packingResponse);

    for (const unit of units) {
      expect(unit.source.length).toBeGreaterThan(0);
      expect(unit.chars).toBe(unit.text.length);
    }

    // Four short paragraphs pack into one unit; its source is the same four
    // paragraphs, joined the same way the spoken text was.
    const packed = [short(1), short(2), short(3), short(4)].join(" ");
    expect(units[2].text).toBe(packed);
    expect(units[2].source).toBe(packed);
  });

  it("source keeps the heading and TLDR markers the spoken text removes", () => {
    const tldr = "**TLDR:** Responses are spoken. A second sentence rides along in the same TLDR paragraph.";
    const { units } = prepare(["## What changed", "", tldr, "", "Body paragraph follows here.", ""].join("\n"));

    expect(units[0].text).toBe("What changed");
    expect(units[0].source).toBe("## What changed");
    expect(units[1].text).not.toContain("**");
    expect(units[1].source).toBe(tldr);
    expect(units[2].source).toBe("Body paragraph follows here.");
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

  it("unit source is joined from the packed paragraph range", () => {
    const { units } = prepare(packingResponse);

    expect(packUnits).toHaveBeenCalledTimes(1);
    const [paragraphs, options] = vi.mocked(packUnits).mock.calls[0] as unknown as [
      readonly { source: string; text: string }[],
      { min: number; max: number },
    ];
    expect(options).toEqual({ min: 200, max: 450 });
    expect(options).toEqual({ min: UNIT_MIN_CHARS, max: UNIT_MAX_CHARS });

    const packed = vi.mocked(packUnits).mock.results[0].value as { from: number; to: number }[];
    expect(packed.some(({ from, to }) => to > from)).toBe(true);

    // The packed units are the tail of the prepared ones, after the opening units.
    const body = units.slice(units.length - packed.length);
    packed.forEach(({ from, to }, i) => {
      const joined = paragraphs
        .slice(from, to + 1)
        .map((paragraph) => paragraph.source)
        .join(" ");
      expect(body[i].source).toBe(joined);
    });
  });

  it("pieces cut from one paragraph share the paragraph as their source", () => {
    // The fast-start split: sentence and remainder are both spoken from the
    // whole first paragraph.
    const first = "Opening sentence here. The rest of the paragraph carries on for a while after it.";
    const split = prepare(`${first}\n\nA second paragraph closes the answer.\n`).units;
    expect(split[0].text).toBe("Opening sentence here.");
    expect(split[0].source).toBe(first);
    expect(split[1].text.startsWith("The rest of the paragraph")).toBe(true);
    expect(split[1].source.startsWith(first)).toBe(true);

    // A ceiling cut: an oversized paragraph falls into several pieces, each
    // carrying the paragraph whole.
    const sentence = "This sentence is long enough to matter when it is repeated many times over.";
    const oversized = Array.from({ length: 12 }, () => sentence).join(" ");
    const { units } = prepare(`**TLDR:** Short.\n\n${oversized}\n`);
    const pieces = units.filter((unit) => unit.text.startsWith(sentence));
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.source).toBe(oversized);
  });

  it("packed list units carry only the items they speak as source", () => {
    // Six items of about sixty characters: too short to stand alone, so the
    // packer merges them up to the floor. Before items were paragraphs the
    // whole list was one paragraph and every unit cut from it carried ALL six
    // items as its source; the answer pane's rail then had nothing to tell
    // units apart by. Now a unit's source is the items it speaks, joined by the
    // same single space the packer uses on the spoken side, and nothing else.
    const items = Array.from(
      { length: 6 },
      (_, i) => `Item ${i + 1} explains one more thing about the rail in sixty chars`,
    );
    for (const item of items) expect(item.length).toBeGreaterThanOrEqual(55);

    const { units } = prepare(`# Rail\n\n${items.map((item) => `- ${item}`).join("\n")}\n`);
    const spokenItems = items.map((item) => `${item}.`);
    const body = units.slice(1);

    expect(units[0].text).toBe("Rail");
    expect(body.length).toBeGreaterThan(1);
    // Every item is still spoken as a sentence of its own, in order.
    expect(body.map((unit) => unit.text).join(" ")).toBe(spokenItems.join(" "));

    for (const unit of body) {
      expect(unit.chars).toBeLessThanOrEqual(UNIT_MAX_CHARS);
      const spoken = spokenItems.filter((item) => unit.text.includes(item));
      expect(spoken.length).toBeGreaterThan(0);
      expect(unit.source).toBe(spoken.join(" "));
    }

    // Packing did happen (some unit speaks several items and reaches the
    // floor), and no unit carries the whole list.
    expect(body.some((unit) => unit.chars >= UNIT_MIN_CHARS)).toBe(true);
    expect(body.some((unit) => unit.source === spokenItems.join(" "))).toBe(false);
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

describe("prepare with blockBounded (pages)", () => {
  /** An 80-character paragraph: one sentence, so the fast start leaves it whole. */
  const eighty = (word: string): string => {
    const text = `The ${word} paragraph talks about the panel and its speech for a while`.padEnd(79, "x");
    return `${text}.`;
  };

  /** `sentence` said `count` times, space-joined. */
  const sentences = (sentence: string, count: number): string => Array(count).fill(sentence).join(" ");

  it("block-bounded: short blocks stay separate units", () => {
    const first = eighty("first");
    const second = eighty("second");
    expect(first).toHaveLength(80);
    const page = ["# Title", "", first, "", second].join("\n");

    const { units } = prepare(page, { blockBounded: true });

    expect(units.map((unit) => unit.text)).toEqual(["Title", first, second]);
    expect(units.map((unit) => unit.block)).toEqual([0, 1, 2]);
  });

  it("block-bounded: a long block splits within the ceiling", () => {
    const long = sentences("This sentence exists to make one paragraph run past the ceiling.", 16);
    expect(long.length).toBeGreaterThanOrEqual(1000);
    const before = "A short paragraph before it.";
    const after = "A short paragraph after it.";
    const page = [before, "", long, "", after].join("\n");

    const { units } = prepare(page, { blockBounded: true });

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

  it("block-bounded: list items start their own units", () => {
    const page = ["Here is what changed:", "", "- The player keeps its place.", "- The bar folds away.", "- Units are cached."].join(
      "\n",
    );

    const { units } = prepare(page, { blockBounded: true });

    expect(units.map((unit) => [unit.text, unit.block])).toEqual([
      ["Here is what changed:", 0],
      ["The player keeps its place.", 1],
      ["The bar folds away.", 2],
      ["Units are cached.", 3],
    ]);
  });

  it("block-bounded: a heading glued to its paragraph is a block of its own", () => {
    const page = ["Intro sentence here.", "", "## Details", "Detail sentence one. Detail sentence two."].join("\n");

    const { units } = prepare(page, { blockBounded: true });

    expect(units.map((unit) => [unit.text, unit.source, unit.block])).toEqual([
      ["Intro sentence here.", "Intro sentence here.", 0],
      ["Details", "## Details", 1],
      ["Detail sentence one. Detail sentence two.", "Detail sentence one. Detail sentence two.", 2],
    ]);
  });

  it("block-bounded: a removed block's placeholder is a block of its own", () => {
    const page = ["Before the code.", "", "```ts", "const x = 1;", "```", "", "After the code."].join("\n");

    const { units } = prepare(page, { blockBounded: true, language: "pl" });

    expect(units.map((unit) => [unit.text, unit.source, unit.block])).toEqual([
      ["Before the code.", "Before the code.", 0],
      ["blok kodu.", "⟦code⟧", 1],
      ["After the code.", "After the code.", 2],
    ]);
  });

  it("block-bounded: a two-paragraph blockquote is two blocks", () => {
    const page = ["> The first quoted paragraph.", ">", "> The second quoted paragraph."].join("\n");

    const { units } = prepare(page, { blockBounded: true });

    expect(units.map((unit) => unit.block)).toEqual([0, 1]);
    expect(units[0].source).toContain("first quoted paragraph");
    expect(units[0].source).not.toContain("second");
    expect(units[1].source).toContain("second quoted paragraph");
  });

  it("block-bounded: a setext heading followed directly by prose is two blocks", () => {
    for (const underline of ["=====", "-----"]) {
      const page = ["The Title", underline, "Body prose right under the title."].join("\n");

      const { units } = prepare(page, { blockBounded: true });

      expect(units.map((unit) => unit.block), underline).toEqual([0, 1]);
      expect(units[0].source, underline).toContain("The Title");
      expect(units[0].source, underline).not.toContain("Body");
      expect(units[1].source, underline).toBe("Body prose right under the title.");
    }
  });

  it("block-bounded: a setext heading's underline is neither spoken nor in its source", () => {
    for (const underline of ["=====", "-----"]) {
      const { units } = prepare(["Title", underline, "Body"].join("\n"), { blockBounded: true });

      expect(units.map((unit) => [unit.source, unit.text, unit.block]), underline).toEqual([
        ["Title", "Title", 0],
        ["Body", "Body", 1],
      ]);
    }
  });

  it("answers keep today's packing", () => {
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
    // Captured from `prepare` before block-bounded packing existed.
    const today = {
      language: "pl",
      units: [
        { text: "Release notes", chars: 13, source: "# Release notes", lang: "pl" },
        {
          text: "Here is what changed: The player keeps its place.",
          chars: 49,
          source: "Here is what changed: The player keeps its place.",
          lang: "pl",
        },
        {
          text: "The bar folds away. Units are cached. Details Short paragraph one about the panel. Short paragraph two about the speech units. blok kodu.",
          chars: 137,
          source:
            "The bar folds away. Units are cached. ## Details\nShort paragraph one about the panel. Short paragraph two about the speech units. ⟦code⟧",
          lang: "pl",
        },
        { text: sentences(repeated, 7), chars: 426, source: sentences(repeated, 9), lang: "pl" },
        { text: sentences(repeated, 2), chars: 121, source: sentences(repeated, 9), lang: "pl" },
      ],
    };

    const prepared = prepare(answer, { language: "pl" });

    expect(prepared).toStrictEqual(today);
    expect(prepare(answer, { language: "pl", blockBounded: false })).toStrictEqual(today);
    for (const unit of prepared.units) expect(Object.keys(unit)).not.toContain("block");
  });
});
