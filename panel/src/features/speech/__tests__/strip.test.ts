import { describe, expect, it } from "vitest";
import { MAX_SPOKEN_CODE_CHARS, stripToSpeakableText } from "../strip";

describe("stripToSpeakableText", () => {
  it("removes fenced code blocks without merging the surrounding paragraphs", () => {
    const markdown = [
      "The grid keeps its own ordering.",
      "",
      "```ts",
      "const order = useTerminalOrdering();",
      "```",
      "",
      "That ordering is what the header reads.",
    ].join("\n");

    const spoken = stripToSpeakableText(markdown);

    expect(spoken).not.toContain("useTerminalOrdering");
    // The block must leave a paragraph boundary behind — exactly one, not three
    // blank lines — so whatever splits paragraphs downstream still sees the
    // prose either side of the sentinel as its own paragraph.
    expect(spoken).toBe(
      "The grid keeps its own ordering.\n\n\u27E6code\u27E7\n\nThat ordering is what the header reads.",
    );
    expect(spoken.split(/\n{2,}/)).toEqual([
      "The grid keeps its own ordering.",
      "\u27E6code\u27E7",
      "That ordering is what the header reads.",
    ]);
  });

  it("removes markdown tables", () => {
    const markdown = [
      "Here is the cell state.",
      "",
      "| cell | state |",
      "| --- | ----- |",
      "| one  | armed |",
      "",
      "Only one cell is ever armed.",
    ].join("\n");

    const spoken = stripToSpeakableText(markdown);

    expect(spoken).not.toContain("|");
    expect(spoken).not.toContain("armed |");
    expect(spoken).toBe(
      "Here is the cell state.\n\n\u27E6table\u27E7\n\nOnly one cell is ever armed.",
    );
  });

  // The two tests above surround their block with blank lines, so the boundary
  // the removal leaves behind is indistinguishable from the blank lines that
  // were already there. These two remove that cover: with the block welded
  // directly onto the prose, the inserted boundary is the ONLY thing keeping the
  // paragraphs apart, which is what the unit builder's "unit 0 is the first
  // heading" reading depends on.
  it("leaves a paragraph boundary where a fence had no blank lines around it", () => {
    const markdown = ["## Heading", "```ts", "const x = 1;", "```", "Body text."].join("\n");

    const spoken = stripToSpeakableText(markdown);

    expect(spoken).toBe("## Heading\n\n\u27E6code\u27E7\n\nBody text.");
    // Without the inserted boundary this is one welded paragraph, not three.
    expect(spoken.split(/\n{2,}/)).toEqual(["## Heading", "\u27E6code\u27E7", "Body text."]);
  });

  it("leaves a paragraph boundary where a table had no blank lines around it", () => {
    const markdown = [
      "Here is the cell state.",
      "| cell | state |",
      "| --- | ----- |",
      "| one  | armed |",
      "Only one cell is ever armed.",
    ].join("\n");

    const spoken = stripToSpeakableText(markdown);

    expect(spoken).toBe(
      "Here is the cell state.\n\n\u27E6table\u27E7\n\nOnly one cell is ever armed.",
    );
    expect(spoken.split(/\n{2,}/)).toEqual([
      "Here is the cell state.",
      "\u27E6table\u27E7",
      "Only one cell is ever armed.",
    ]);
  });

  it("keeps short inline code", () => {
    expect(stripToSpeakableText("Call `prepare` before speaking.")).toBe(
      "Call prepare before speaking.",
    );

    const atThreshold = "a".repeat(MAX_SPOKEN_CODE_CHARS);
    expect(stripToSpeakableText(`Call \`${atThreshold}\` first.`)).toBe(
      `Call ${atThreshold} first.`,
    );

    // Past the threshold the span is named rather than spoken — it used to be
    // dropped, which left the sentence describing a call to nothing at all.
    // The cap applies to expressions only: the span needs a space in it, or it
    // is one name and is read however long it runs.
    const pastThreshold = `${"a".repeat(MAX_SPOKEN_CODE_CHARS)} + 1`;
    expect(stripToSpeakableText(`Call \`${pastThreshold}\` first.`)).toBe("Call ⟦expr⟧ first.");

    // A single token past the cap is a name, not an expression, and is spoken.
    const longName = "a".repeat(MAX_SPOKEN_CODE_CHARS + 1);
    expect(stripToSpeakableText(`Call \`${longName}\` first.`)).toBe(`Call ${longName} first.`);
  });

  it("elides a long file path with a line range", () => {
    expect(
      stripToSpeakableText(
        "See panel/src/features/terminal/TerminalLayoutGrid.tsx:453-478 for the grid.",
      ),
    ).toBe("See TerminalLayoutGrid.tsx for the grid.");

    // Same path, written as inline code.
    expect(
      stripToSpeakableText(
        "See `panel/src/features/terminal/TerminalLayoutGrid.tsx:453-478` for the grid.",
      ),
    ).toBe("See TerminalLayoutGrid.tsx for the grid.");

    // A bare filename with a line range is elided to the filename alone.
    expect(stripToSpeakableText("Read useTerminalOrdering.ts:66-75 again.")).toBe(
      "Read useTerminalOrdering.ts again.",
    );

    // A path short enough to follow by ear survives verbatim.
    expect(stripToSpeakableText("See `src/strip.ts` for the filter.")).toBe(
      "See src/strip.ts for the filter.",
    );
  });

  it("terminates an unterminated list item", () => {
    const markdown = [
      "- the header shows the armed cell",
      "- replay is idempotent.",
      "1) arming is exclusive",
    ].join("\n");

    expect(stripToSpeakableText(markdown)).toBe(
      ["the header shows the armed cell.", "replay is idempotent.", "arming is exclusive."].join(
        "\n",
      ),
    );
  });

  it("returns empty for a response that is only code", () => {
    const markdown = ["```ts", "const x = 1;", "```"].join("\n");

    // Exactly the empty string — not whitespace, and not a lone sentinel
    // either: a placeholder names an omission *inside* an answer, and there is
    // no answer here to place it in. A cell with nothing else to say stays
    // quiet rather than waking up to announce "code block".
    expect(stripToSpeakableText(markdown)).toBe("");
    expect(stripToSpeakableText("")).toBe("");
  });

  it("swallows an unclosed fence to the end of the response", () => {
    const markdown = [
      "The patch is below.",
      "",
      "```diff",
      "-const a = 1;",
      "+const a = 2;",
      "  and the response was truncated here",
    ].join("\n");

    const spoken = stripToSpeakableText(markdown);

    expect(spoken).toBe("The patch is below.\n\n\u27E6code\u27E7");
    expect(spoken).not.toContain("const a");
    expect(spoken).not.toContain("truncated");
  });

  it("removes a tilde-fenced block", () => {
    const markdown = ["Intro.", "", "~~~", "const x = 1;", "~~~", "", "Outro."].join("\n");

    expect(stripToSpeakableText(markdown)).toBe("Intro.\n\n\u27E6code\u27E7\n\nOutro.");
  });

  it("leaves heading and emphasis markers for the unit builder", () => {
    const markdown = ["## What changed", "", "**TLDR:** the header now speaks."].join("\n");

    // Structure downstream depends on (first heading, leading `**TLDR:**`), so
    // those markers are deliberately not stripped here.
    expect(stripToSpeakableText(markdown)).toBe(
      "## What changed\n\n**TLDR:** the header now speaks.",
    );
  });

  // ------------------------------------------------------------------
  // Task 1 — removed blocks are named.
  // ------------------------------------------------------------------

  it("names a removed code block where it stood", () => {
    const markdown = [
      "The fix is one line.",
      "",
      "```ts",
      "const order = useTerminalOrdering();",
      "```",
      "",
      "It ships with the next build.",
    ].join("\n");

    const spoken = stripToSpeakableText(markdown);

    // The listener hears that something was skipped, and what kind of thing it
    // was — a silent removal is indistinguishable from an answer that never
    // mentioned the code at all.
    expect(spoken).not.toContain("useTerminalOrdering");
    expect(spoken).toBe("The fix is one line.\n\n\u27E6code\u27E7\n\nIt ships with the next build.");
  });

  it("names a removed table where it stood", () => {
    const markdown = [
      "Here is the cell state.",
      "",
      "| cell | state |",
      "| --- | ----- |",
      "| one  | armed |",
      "",
      "Only one cell is ever armed.",
    ].join("\n");

    const spoken = stripToSpeakableText(markdown);

    expect(spoken).not.toContain("|");
    expect(spoken).toBe(
      "Here is the cell state.\n\n\u27E6table\u27E7\n\nOnly one cell is ever armed.",
    );
  });

  it("names a removed HTML block where it stood", () => {
    const markdown = [
      "The diff is folded away.",
      "",
      "<details>",
      "<summary>Show the diff</summary>",
      "",
      "the hidden prose nobody asked to hear",
      "",
      "</details>",
      "",
      "It changes two files.",
    ].join("\n");

    const spoken = stripToSpeakableText(markdown);

    expect(spoken).not.toContain("<");
    expect(spoken).not.toContain("hidden prose");
    expect(spoken).toBe(
      "The diff is folded away.\n\n\u27E6html\u27E7\n\nIt changes two files.",
    );

    // A one-line element and a bare HTML table are the same kind of thing.
    expect(stripToSpeakableText(['Before.', '<div align="center">middle</div>', "After."].join("\n"))).toBe(
      "Before.\n\n\u27E6html\u27E7\n\nAfter.",
    );
    expect(
      stripToSpeakableText(
        ["Before.", "<table>", "  <tr><td>one</td></tr>", "</table>", "After."].join("\n"),
      ),
    ).toBe("Before.\n\n\u27E6html\u27E7\n\nAfter.");
  });

  it("collapses adjacent removals of the same kind into one", () => {
    const markdown = [
      "Three attempts, none of them worth hearing.",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "```ts",
      "const b = 2;",
      "```",
      "```ts",
      "const c = 3;",
      "```",
      "",
      "The third one worked.",
    ].join("\n");

    const spoken = stripToSpeakableText(markdown);

    expect(spoken.match(/\u27E6code\u27E7/g)).toHaveLength(1);
    expect(spoken).toBe(
      "Three attempts, none of them worth hearing.\n\n\u27E6code\u27E7\n\nThe third one worked.",
    );
  });

  it("keeps adjacent removals of different kinds apart", () => {
    const markdown = [
      "Both of these are unreadable aloud.",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "| cell | state |",
      "| --- | ----- |",
      "",
      "<details>",
      "<summary>and one more</summary>",
      "</details>",
      "",
      "That is the whole answer.",
    ].join("\n");

    const spoken = stripToSpeakableText(markdown);

    expect(spoken).toBe(
      [
        "Both of these are unreadable aloud.",
        "",
        "\u27E6code\u27E7",
        "",
        "\u27E6table\u27E7",
        "",
        "\u27E6html\u27E7",
        "",
        "That is the whole answer.",
      ].join("\n"),
    );
  });

  it("names an unclosed fence once and leaks no code", () => {
    const markdown = [
      "The patch is below.",
      "",
      "```diff",
      "-const a = 1;",
      "+const a = 2;",
      // A blank line INSIDE the unclosed run is what pins "runs to the end":
      // without it, a fence loop that stopped at the first blank line would
      // pass this test and then read the truncated tail aloud.
      "",
      "  and the response was truncated here",
    ].join("\n");

    const spoken = stripToSpeakableText(markdown);

    expect(spoken).toBe("The patch is below.\n\n\u27E6code\u27E7");
    expect(spoken.match(/\u27E6code\u27E7/g)).toHaveLength(1);
    expect(spoken).not.toContain("const a");
    expect(spoken).not.toContain("truncated");
  });

  it("still separates the paragraphs around a removed block", () => {
    // The block is welded onto the prose with no blank lines of its own, so the
    // boundary the removal inserts is the ONLY thing keeping the paragraphs
    // apart — and the sentinel must not weld them back together.
    const markdown = ["## Heading", "```ts", "const x = 1;", "```", "Body text."].join("\n");

    expect(stripToSpeakableText(markdown).split(/\n{2,}/)).toEqual([
      "## Heading",
      "\u27E6code\u27E7",
      "Body text.",
    ]);
  });
  // ------------------------------------------------------------------
  // Task 1 repairs — a stray tag must never swallow the answer.
  // ------------------------------------------------------------------

  it("treats a void tag as a block of exactly one line", () => {
    // `<br>` can never carry a closing tag, so the search for `</br>` finds
    // nothing and the block fell through to the fallback — which took the rest
    // of the response with it, deleting real prose the answer did write.
    const spoken = stripToSpeakableText(
      "Before.\n<br>\nAfter, which is real prose that is now gone.",
    );

    expect(spoken).toContain("After, which is real prose that is now gone.");
    expect(spoken).toBe(
      "Before.\n\n\u27E6html\u27E7\n\nAfter, which is real prose that is now gone.",
    );
  });

  it("never pairs a void tag with a stray closing tag further down", () => {
    const markdown = [
      "Before.",
      '<img src="diagram.png">',
      "The diagram shows two cells.",
      // Sloppy but real: a model closes a void element it never had to close.
      "</img>",
      "After.",
    ].join("\n");

    // A void element holds no content, so nothing between it and a bogus
    // `</img>` belongs to it — pairing the two deletes a whole sentence.
    const spoken = stripToSpeakableText(markdown);

    expect(spoken).toContain("The diagram shows two cells.");
    expect(spoken).toBe(
      [
        "Before.",
        "",
        "\u27E6html\u27E7",
        "",
        "The diagram shows two cells.",
        "",
        "\u27E6html\u27E7",
        "",
        "After.",
      ].join("\n"),
    );
  });

  it("bounds an unbalanced tag to its own line, never to the rest of the response", () => {
    const markdown = [
      "First para.",
      "",
      "Prose line one.",
      "<p> matters here.",
      "Prose line three.",
    ].join("\n");

    const spoken = stripToSpeakableText(markdown);

    expect(spoken).toContain("Prose line three.");
    expect(spoken).toBe(
      "First para.\n\nProse line one.\n\n\u27E6html\u27E7\n\nProse line three.",
    );

    // And the bound is the opening line even when a blank line IS ahead: the
    // old fallback ran to it and ate every prose line in between.
    expect(stripToSpeakableText("<p> stray tag.\nStill prose.\n\nNext paragraph.")).toBe(
      "\u27E6html\u27E7\n\nStill prose.\n\nNext paragraph.",
    );
  });

  it("treats a closing tag standing alone as a block of one line", () => {
    const markdown = [
      "Before.",
      "</div>",
      "Real prose in the middle.",
      "</div>",
      "After.",
    ].join("\n");

    // A `</div>` opens nothing, so it can never pair with the next one —
    // pairing them would delete the sentence standing between them.
    expect(stripToSpeakableText(markdown)).toBe(
      [
        "Before.",
        "",
        "\u27E6html\u27E7",
        "",
        "Real prose in the middle.",
        "",
        "\u27E6html\u27E7",
        "",
        "After.",
      ].join("\n"),
    );
  });

  it("treats a self-closing tag as a block of one line", () => {
    const markdown = [
      "Before.",
      '<div class="spacer" />',
      "Real prose in the middle.",
      "</div>",
      "After.",
    ].join("\n");

    // Same argument as the closing tag: a self-closed element is finished on
    // its own line, so the `</div>` below it belongs to something else.
    expect(stripToSpeakableText(markdown)).toBe(
      [
        "Before.",
        "",
        "\u27E6html\u27E7",
        "",
        "Real prose in the middle.",
        "",
        "\u27E6html\u27E7",
        "",
        "After.",
      ].join("\n"),
    );
  });

  it("leaves a line that merely starts with an inline tag alone", () => {
    // The block rule is anchored to the start of a line, and inline markup does
    // start one. `<em>` and `<span>` are not block-level, so these are
    // sentences — treating them as blocks would eat the prose after the tag.
    expect(stripToSpeakableText("<em>this</em> matters.")).toBe("<em>this</em> matters.");
    expect(stripToSpeakableText("<span>and so</span> does this.")).toBe(
      "<span>and so</span> does this.",
    );
  });

  it("keeps two removals of the same kind apart when prose stands between them", () => {
    const markdown = [
      "```ts",
      "const a = 1;",
      "```",
      "A sentence between them.",
      "```ts",
      "const b = 2;",
      "```",
    ].join("\n");

    const spoken = stripToSpeakableText(markdown);

    // Collapsing is for removals with NOTHING spoken between them. A sentence
    // in between is something the listener hears, so the second block is a
    // second omission and needs its own name.
    expect(spoken.match(/\u27E6code\u27E7/g)).toHaveLength(2);
    expect(spoken).toBe("\u27E6code\u27E7\n\nA sentence between them.\n\n\u27E6code\u27E7");
  });

  // ------------------------------------------------------------------
  // Task 2 — links, images and bare addresses.
  // ------------------------------------------------------------------

  it("speaks a link's text and drops its address", () => {
    const spoken = stripToSpeakableText(
      "See [the ordering hook](https://pavil.io/docs/ordering) for the rule.",
    );

    // The text is the only part of a link a listener can use; the address is
    // unspeakable and gets no placeholder either, because the sentence already
    // reads as a whole sentence without it.
    expect(spoken).toBe("See the ordering hook for the rule.");
    expect(spoken).not.toContain("pavil.io");
    expect(spoken).not.toContain("⟦link⟧");

    // The markers the unit builder needs survive inside link text.
    expect(stripToSpeakableText("Read [**the ordering hook**](https://pavil.io/d) now.")).toBe(
      "Read **the ordering hook** now.",
    );
  });

  it("names an image instead of reading its alt and address", () => {
    const spoken = stripToSpeakableText(
      "The layout is below. ![the grid, annotated](https://pavil.io/img/grid.png) It has three columns.",
    );

    // Alt text is written for a reader who cannot see the image, not for a
    // listener who cannot see it either — read aloud it is a description of a
    // picture nobody is looking at, so the whole construct goes.
    expect(spoken).toBe("The layout is below. ⟦image⟧ It has three columns.");
    expect(spoken).not.toContain("annotated");

    // A response that is nothing but an image has nothing to say, exactly as a
    // response that is nothing but code has nothing to say.
    expect(stripToSpeakableText("![the grid, annotated](https://pavil.io/img/grid.png)")).toBe("");
  });

  it("says nothing for a response that is only a bulleted image", () => {
    // The list marker used to defeat the sentinel-only check: `listItemToSentence`
    // appends the terminator *after* the check has already been designed around
    // a bare sentinel, so `⟦image⟧.` slipped through and woke the cell up to say
    // "obrazek" about a response with no words in it.
    expect(stripToSpeakableText("- ![the grid, annotated](https://pavil.io/img/grid.png)")).toBe(
      "",
    );

    // A sentinel that stands beside actual prose in a list item still gets its
    // terminator, because there the item is a sentence.
    expect(stripToSpeakableText("- The layout is ![the grid](https://pavil.io/img/grid.png)")).toBe(
      "The layout is ⟦image⟧.",
    );
  });

  it("names a bare address", () => {
    // The trailing full stop is the sentence's, not the address's.
    expect(stripToSpeakableText("The spec lives at https://pavil.io/specs/speech.")).toBe(
      "The spec lives at ⟦link⟧.",
    );

    // An address in backticks is an address, not an expression: addresses are
    // reduced before inline code is unwrapped, so the span names a link rather
    // than being dropped for length.
    expect(stripToSpeakableText("Fetch it from `https://pavil.io/specs/speech.md` first.")).toBe(
      "Fetch it from ⟦link⟧ first.",
    );
  });

  it("names a link with no readable text at all", () => {
    // The named exception for `[text](url)` is bought by the text: the sentence
    // still reads as a sentence without the address. With the text empty there
    // is nothing readable attached, which is exactly the bare-URL case — so it
    // is named rather than deleted, or "See [](url) now." became "See now."
    expect(stripToSpeakableText("See [](https://pavil.io/docs/ordering) now.")).toBe(
      "See ⟦link⟧ now.",
    );
  });

  it("keeps a link's text when the text has brackets of its own", () => {
    // Pins the one level of nesting `LINK_TEXT` allows. Flatten it and the link
    // stops matching altogether: the brackets are spoken and the destination
    // falls through to the bare-address rule as a stray `⟦link⟧`.
    expect(
      stripToSpeakableText("See [see [this] note](https://pavil.io/docs/ordering) now."),
    ).toBe("See see [this] note now.");
  });

  it("drops a destination that has parens of its own", () => {
    // Pins the one level of nesting `LINK_DESTINATION` allows. Flatten it and
    // the closing paren is found too early, the link never matches, and half
    // the construct is left standing around a `⟦link⟧`.
    expect(
      stripToSpeakableText("See [the ordering hook](https://pavil.io/docs/a(b)c) now."),
    ).toBe("See the ordering hook now.");
  });

  it("leaves a bracketed expression that is not a link alone", () => {
    // Indexing is not linking. Rewriting `arr[0](x)` as `arr0` swaps one token
    // for a different, plausible-sounding token — worse than reading the
    // original aloud, because the listener cannot tell it happened.
    expect(stripToSpeakableText("Call `arr[0](x)` now.")).toBe("Call arr[0](x) now.");
    expect(stripToSpeakableText("Read x[i][j] carefully.")).toBe("Read x[i][j] carefully.");
    expect(stripToSpeakableText("See note[1](x) there.")).toBe("See note[1](x) there.");

    // And a span that quotes the link syntax itself — the answer an agent gives
    // when asked how to write one. Nothing about its left-hand side marks it
    // out, so only skipping code spans keeps it whole.
    expect(stripToSpeakableText("Write `[text](url)` to make a link.")).toBe(
      "Write [text](url) to make a link.",
    );
  });

  it("names a link whose text is itself an address", () => {
    // Keeping the text here would defeat the point of dropping the address.
    expect(
      stripToSpeakableText("See [https://pavil.io/specs/speech](https://pavil.io/specs/speech)."),
    ).toBe("See ⟦link⟧.");
  });

  it("keeps the text of a reference-style link and drops the definition", () => {
    const markdown = [
      "The ordering is described in [the ordering hook][ordering].",
      "",
      '[ordering]: https://pavil.io/docs/ordering "The ordering hook"',
    ].join("\n");

    const spoken = stripToSpeakableText(markdown);

    // A definition line is pure link plumbing — it has no prose in it at all.
    expect(spoken).toBe("The ordering is described in the ordering hook.");
    expect(spoken).not.toContain("pavil.io");
    expect(spoken).not.toContain("ordering]");
  });

  it("keeps a bracketed label that is not a reference definition", () => {
    // `[label]: text` is also how log lines and footnotes are written, and agent
    // answers are full of both. Matching on the shape alone deleted the whole
    // line with no sentinel — the one removal in this module that leaves no
    // trace, applied to prose.
    expect(stripToSpeakableText("[WARN]: connection refused, retrying")).toBe(
      "[WARN]: connection refused, retrying",
    );
    expect(stripToSpeakableText("[TODO]: rewrite this paragraph tomorrow")).toBe(
      "[TODO]: rewrite this paragraph tomorrow",
    );
    expect(stripToSpeakableText("[1]: Kowalski, 2026, page 14")).toBe(
      "[1]: Kowalski, 2026, page 14",
    );

    // A destination that really is an address still makes the line plumbing,
    // with or without a title, and plumbing is dropped.
    expect(stripToSpeakableText("[ordering]: https://pavil.io/docs/ordering")).toBe("");
    expect(stripToSpeakableText("[ordering]: <https://pavil.io/docs/ordering>")).toBe("");
    expect(stripToSpeakableText("[grid]: img/grid.png 'The grid'")).toBe("");
  });

  it("emits no link sentinel for an address inside a removed block", () => {
    const markdown = [
      "The fetch is one line.",
      "",
      "```ts",
      'await fetch("https://pavil.io/api/units");',
      "```",
      "",
      "| endpoint | https://pavil.io/api/units |",
      "| --- | --- |",
      "",
      "Nothing else changed.",
    ].join("\n");

    const spoken = stripToSpeakableText(markdown);

    // Block removal runs first, so by the time addresses are looked for the
    // fence and the table are already sentinels — the address never exists to
    // be named a second time.
    expect(spoken).toBe(
      "The fetch is one line.\n\n⟦code⟧\n\n⟦table⟧\n\nNothing else changed.",
    );
    expect(spoken).not.toContain("⟦link⟧");

    // And the ordering itself, which the assertions above cannot see: an
    // address rule reaching into a block's markup can destroy the block's own
    // boundary. A destination is any run without parens, so a `</details>`
    // inside one goes with the link — harmless *after* block removal, and if it
    // ran before, the block never finds its closing tag, falls back to its
    // opening line, and everything it was meant to contain leaks into the
    // spoken text.
    expect(
      stripToSpeakableText(["<details>", "See [x](y</details>z) here.", "Then prose."].join("\n")),
    ).toBe("⟦html⟧\n\nThen prose.");
  });

  it("speaks the last segment of a path that ends in a separator", () => {
    // The live bug: the last segment of a path ending in `/` is the empty
    // string, so the token was spoken as nothing at all — the sentence lost
    // its subject and the listener heard "the plan lives in now".
    expect(
      stripToSpeakableText("The plan lives in `openspec/changes/speech-flow-and-diction/` now."),
    ).toBe("The plan lives in speech flow and diction now.");

    // Same path unwrapped: the trailing separator belongs to the token, so it
    // does not survive as a stray slash beside the segment either.
    expect(
      stripToSpeakableText("The plan lives in openspec/changes/speech-flow-and-diction/ now."),
    ).toBe("The plan lives in speech flow and diction now.");

    // Several trailing separators are still one path, not several empty ones.
    expect(stripToSpeakableText("Look under `panel/src/features/speech//` for it.")).toBe(
      "Look under speech for it.",
    );
  });

  it("keeps the sentence's full stop when a path ends the sentence", () => {
    // The original bug in its commonest position. `PATH_RE`'s final segment used
    // to eat the sentence's own full stop, so the last segment was "." — and
    // `tidySpacing` then glued that back onto the preceding word, deleting the
    // path and leaving a sentence that had lost its subject.
    expect(
      stripToSpeakableText("The plan lives in openspec/changes/speech-flow-and-diction/. Next."),
    ).toBe("The plan lives in speech flow and diction. Next.");

    // Two of them in one sentence, the second sentence-final.
    expect(
      stripToSpeakableText(
        "Move openspec/changes/aaa-bbb-ccc-ddd/ to openspec/changes/eee-fff-ggg-hhh/.",
      ),
    ).toBe("Move aaa bbb ccc ddd to eee fff ggg hhh.");

    // In backticks the full stop was never inside the token, so this form
    // already worked — it is here so the two cannot drift apart again.
    expect(
      stripToSpeakableText("The plan lives in `openspec/changes/speech-flow-and-diction/`. Next."),
    ).toBe("The plan lives in speech flow and diction. Next.");
  });

  it("never speaks a path as nothing, whatever its last segment is", () => {
    // A segment made only of separators is spoken as the empty string, so
    // "everything after the last slash" and "the last non-empty segment" both
    // still delete the token. The segment that gets spoken is the last one with
    // anything left in it *after* the separators become spaces.
    expect(stripToSpeakableText("Look in panel/src/features/speech/- for it.")).toBe(
      "Look in speech for it.",
    );
    expect(stripToSpeakableText("Look in panel/src/features/speech/__ for it.")).toBe(
      "Look in speech for it.",
    );
  });

  it("speaks separators inside a path segment as spaces", () => {
    // Inside a segment a separator is word spacing, not punctuation: the voice
    // reads "use-speech-player" as one unpronounceable run otherwise.
    expect(stripToSpeakableText("Open panel/src/features/speech/use-speech-player.ts now.")).toBe(
      "Open use speech player.ts now.",
    );

    // Underscores read the same way, and a run of them is one space.
    expect(stripToSpeakableText("Open panel/docs/heading__line_re.md now.")).toBe(
      "Open heading line re.md now.",
    );
  });

  it("still drops a line reference from a path", () => {
    expect(
      stripToSpeakableText(
        "See panel/src/features/terminal/TerminalLayoutGrid.tsx:453-478 for the grid.",
      ),
    ).toBe("See TerminalLayoutGrid.tsx for the grid.");

    // Order is load-bearing: the reference is dropped before the segment is
    // spaced out, or the hyphen in `12-30` would be spoken as "twelve thirty".
    expect(stripToSpeakableText("See panel/src/use-speech-player.ts:12-30 for the swap.")).toBe(
      "See use speech player.ts for the swap.",
    );
  });

  it("speaks a long single-token name as written", () => {
    // The cap is there to catch expressions, not names. A change-id is one
    // unbroken token: a listener follows it fine at any length, and naming it
    // "expression" tells them something false about what they missed.
    expect(
      stripToSpeakableText(
        "Active: `terminal-tab-reachability`, `terminal-resize-discipline`, " +
          "`2026-04-19-launch-distribution`.",
      ),
    ).toBe(
      "Active: terminal-tab-reachability, terminal-resize-discipline, " +
        "2026-04-19-launch-distribution.",
    );

    // Underscores and dots join a token the same way a hyphen does.
    expect(stripToSpeakableText("See `SPEECH_STREAM_STALL_TIMEOUT_MS` for the wait.")).toBe(
      "See SPEECH_STREAM_STALL_TIMEOUT_MS for the wait.",
    );

    // A space is what makes a span an expression rather than a name, and that
    // is still named once it runs past the cap.
    expect(stripToSpeakableText("Call `const x = await synth(a, b, c, d)` first.")).toBe(
      "Call ⟦expr⟧ first.",
    );
  });

  it("names an over-long expression instead of dropping it", () => {
    // An expression too long to follow by ear is still something the answer
    // said; dropping it silently rewrote the sentence into a lie.
    expect(stripToSpeakableText('Call `units.map((u) => u.text).join(" ")` before speaking.')).toBe(
      "Call ⟦expr⟧ before speaking.",
    );

    // A path is not an expression: it has its own rule and keeps its segment,
    // however long the span is.
    expect(
      stripToSpeakableText("See `panel/src/features/speech/use-speech-player.ts` for the swap."),
    ).toBe("See use speech player.ts for the swap.");

    // And an answer that is *only* an expression still has nothing to say, for
    // the same reason an answer that is only code has nothing to say.
    expect(stripToSpeakableText('`units.map((u) => u.text).join(" ")`')).toBe("");
  });

  it("still unwraps short inline code", () => {
    expect(stripToSpeakableText("Call `prepare` before speaking.")).toBe(
      "Call prepare before speaking.",
    );

    // Exactly at the cap is still speakable — the expression sentinel starts
    // one character later.
    const atThreshold = "a".repeat(MAX_SPOKEN_CODE_CHARS);
    expect(stripToSpeakableText(`Call \`${atThreshold}\` first.`)).toBe(
      `Call ${atThreshold} first.`,
    );

    // A short path is followable by ear, so it is neither elided nor spaced.
    expect(stripToSpeakableText("See `src/strip.ts` for the filter.")).toBe(
      "See src/strip.ts for the filter.",
    );
  });

  it("leaves an ordinary hyphenated word alone", () => {
    // The guard on the rule above. Spacing separators across prose would split
    // a Polish hyphenated word into two, so the rule is scoped to the inside of
    // a recognised path token and nothing else — here both are in one sentence.
    expect(
      stripToSpeakableText(
        "Zdjęcie czarno-białe leży w openspec/changes/speech-flow-and-diction/ do jutra.",
      ),
    ).toBe("Zdjęcie czarno-białe leży w speech flow and diction do jutra.");

    // With no path in sight the sentence is untouched, hyphens and all.
    expect(stripToSpeakableText("Ten e-mail jest czarno-biały i dobrze znany.")).toBe(
      "Ten e-mail jest czarno-biały i dobrze znany.",
    );
  });
});
