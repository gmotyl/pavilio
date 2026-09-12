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

    // One character past the threshold is no longer followable by ear, so it
    // is named rather than spoken — it used to be dropped, which left the
    // sentence describing a call to nothing at all.
    const pastThreshold = "a".repeat(MAX_SPOKEN_CODE_CHARS + 1);
    expect(stripToSpeakableText(`Call \`${pastThreshold}\` first.`)).toBe("Call ⟦expr⟧ first.");
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
