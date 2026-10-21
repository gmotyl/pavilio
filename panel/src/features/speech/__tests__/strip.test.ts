import { describe, expect, it } from "vitest";
import { MAX_SPOKEN_CODE_CHARS, SENTINEL_ONLY_RE, stripToSpeakableText } from "../strip";

type Row = [label: string, markdown: string, spoken: string];

const lines = (...l: string[]) => l.join("\n");
const AT_CAP = "a".repeat(MAX_SPOKEN_CODE_CHARS);

describe("stripToSpeakableText", () => {
  // Removed blocks are named where they stood (⟦code⟧/⟦table⟧/⟦html⟧) and leave
  // exactly one paragraph boundary behind — a silent removal is indistinguishable
  // from an answer that never mentioned the code at all, and whatever splits
  // paragraphs downstream must still see the prose either side as its own
  // paragraph (the unit builder's "unit 0 is the first heading" reading).
  it.each<Row>([
    [
      "fenced code between blank lines",
      lines("The grid keeps its own ordering.", "", "```ts", "const order = useTerminalOrdering();", "```", "", "That ordering is what the header reads."),
      "The grid keeps its own ordering.\n\n⟦code⟧\n\nThat ordering is what the header reads.",
    ],
    [
      "markdown table between blank lines",
      lines("Here is the cell state.", "", "| cell | state |", "| --- | ----- |", "| one  | armed |", "", "Only one cell is ever armed."),
      "Here is the cell state.\n\n⟦table⟧\n\nOnly one cell is ever armed.",
    ],
    // With the block welded onto the prose, the inserted boundary is the ONLY
    // thing keeping the paragraphs apart — and the sentinel must not weld them.
    [
      "fence with no blank lines around it",
      lines("## Heading", "```ts", "const x = 1;", "```", "Body text."),
      "## Heading\n\n⟦code⟧\n\nBody text.",
    ],
    [
      "table with no blank lines around it",
      lines("Here is the cell state.", "| cell | state |", "| --- | ----- |", "| one  | armed |", "Only one cell is ever armed."),
      "Here is the cell state.\n\n⟦table⟧\n\nOnly one cell is ever armed.",
    ],
    // Exactly the empty string, not a lone sentinel: a placeholder names an
    // omission *inside* an answer, and a cell with nothing else to say stays quiet.
    ["a response that is only code", lines("```ts", "const x = 1;", "```"), ""],
    ["an empty response", "", ""],
    [
      "an unclosed fence swallows to the end of the response",
      lines("The patch is below.", "", "```diff", "-const a = 1;", "+const a = 2;", "  and the response was truncated here"),
      "The patch is below.\n\n⟦code⟧",
    ],
    // A blank line INSIDE the unclosed run pins "runs to the end": a fence loop
    // that stopped at the first blank line would read the truncated tail aloud.
    [
      "an unclosed fence with a blank line inside is named once and leaks no code",
      lines("The patch is below.", "", "```diff", "-const a = 1;", "+const a = 2;", "", "  and the response was truncated here"),
      "The patch is below.\n\n⟦code⟧",
    ],
    ["a tilde-fenced block", lines("Intro.", "", "~~~", "const x = 1;", "~~~", "", "Outro."), "Intro.\n\n⟦code⟧\n\nOutro."],
    [
      "a code block in different prose",
      lines("The fix is one line.", "", "```ts", "const order = useTerminalOrdering();", "```", "", "It ships with the next build."),
      "The fix is one line.\n\n⟦code⟧\n\nIt ships with the next build.",
    ],
    [
      "an HTML <details> block and everything inside it",
      lines("The diff is folded away.", "", "<details>", "<summary>Show the diff</summary>", "", "the hidden prose nobody asked to hear", "", "</details>", "", "It changes two files."),
      "The diff is folded away.\n\n⟦html⟧\n\nIt changes two files.",
    ],
    ["a one-line HTML element", lines("Before.", '<div align="center">middle</div>', "After."), "Before.\n\n⟦html⟧\n\nAfter."],
    ["a bare HTML table", lines("Before.", "<table>", "  <tr><td>one</td></tr>", "</table>", "After."), "Before.\n\n⟦html⟧\n\nAfter."],
    [
      "adjacent removals of the same kind collapse into one",
      lines("Three attempts, none of them worth hearing.", "", "```ts", "const a = 1;", "```", "", "```ts", "const b = 2;", "```", "```ts", "const c = 3;", "```", "", "The third one worked."),
      "Three attempts, none of them worth hearing.\n\n⟦code⟧\n\nThe third one worked.",
    ],
    [
      "adjacent removals of different kinds stay apart",
      lines("Both of these are unreadable aloud.", "", "```ts", "const a = 1;", "```", "", "| cell | state |", "| --- | ----- |", "", "<details>", "<summary>and one more</summary>", "</details>", "", "That is the whole answer."),
      lines("Both of these are unreadable aloud.", "", "⟦code⟧", "", "⟦table⟧", "", "⟦html⟧", "", "That is the whole answer."),
    ],
    // Collapsing is for removals with NOTHING spoken between them.
    [
      "two removals of the same kind with prose between them stay two",
      lines("```ts", "const a = 1;", "```", "A sentence between them.", "```ts", "const b = 2;", "```"),
      "⟦code⟧\n\nA sentence between them.\n\n⟦code⟧",
    ],
    // Block removal runs first, so an address inside a fence or table never
    // exists to be named a second time.
    [
      "an address inside a removed block emits no link sentinel",
      lines("The fetch is one line.", "", "```ts", 'await fetch("https://pavil.io/api/units");', "```", "", "| endpoint | https://pavil.io/api/units |", "| --- | --- |", "", "Nothing else changed."),
      "The fetch is one line.\n\n⟦code⟧\n\n⟦table⟧\n\nNothing else changed.",
    ],
    // The ordering itself: a destination is any run without parens, so a
    // `</details>` inside one would go with the link if addresses ran first,
    // and the block would leak everything it was meant to contain.
    ["block removal runs before the address rule", lines("<details>", "See [x](y</details>z) here.", "Then prose."), "⟦html⟧\n\nThen prose."],
  ])("names a removed block: %s", (_label, markdown, spoken) => {
    expect(stripToSpeakableText(markdown)).toBe(spoken);
  });

  // Task 1 repairs — a stray tag must never swallow the answer.
  it.each<Row>([
    // `<br>` can never carry a closing tag; the search for `</br>` fell through
    // to the fallback, which took the rest of the response with it.
    ["a void tag is a block of exactly one line", "Before.\n<br>\nAfter, which is real prose that is now gone.", "Before.\n\n⟦html⟧\n\nAfter, which is real prose that is now gone."],
    // Sloppy but real: a model closes a void element it never had to close;
    // pairing the two deletes a whole sentence.
    [
      "a void tag never pairs with a stray closing tag further down",
      lines("Before.", '<img src="diagram.png">', "The diagram shows two cells.", "</img>", "After."),
      lines("Before.", "", "⟦html⟧", "", "The diagram shows two cells.", "", "⟦html⟧", "", "After."),
    ],
    [
      "an unbalanced tag is bounded to its own line",
      lines("First para.", "", "Prose line one.", "<p> matters here.", "Prose line three."),
      "First para.\n\nProse line one.\n\n⟦html⟧\n\nProse line three.",
    ],
    // The old fallback ran to the next blank line and ate every prose line between.
    ["an unbalanced tag stays one line even with a blank line ahead", "<p> stray tag.\nStill prose.\n\nNext paragraph.", "⟦html⟧\n\nStill prose.\n\nNext paragraph."],
    [
      "a closing tag standing alone opens nothing and pairs with nothing",
      lines("Before.", "</div>", "Real prose in the middle.", "</div>", "After."),
      lines("Before.", "", "⟦html⟧", "", "Real prose in the middle.", "", "⟦html⟧", "", "After."),
    ],
    [
      "a self-closing tag is finished on its own line",
      lines("Before.", '<div class="spacer" />', "Real prose in the middle.", "</div>", "After."),
      lines("Before.", "", "⟦html⟧", "", "Real prose in the middle.", "", "⟦html⟧", "", "After."),
    ],
    // `<em>` and `<span>` are not block-level: these are sentences.
    ["a line starting with inline <em> is left alone", "<em>this</em> matters.", "<em>this</em> matters."],
    ["a line starting with inline <span> is left alone", "<span>and so</span> does this.", "<span>and so</span> does this."],
  ])("bounds stray HTML: %s", (_label, markdown, spoken) => {
    expect(stripToSpeakableText(markdown)).toBe(spoken);
  });

  // List items are paragraphs: a tight list used to be ONE paragraph, so a unit
  // cut out of it carried the whole list as its source and the answer pane could
  // not tell which items that unit speaks.
  it.each<Row>([
    [
      "an unterminated item gets a terminator",
      lines("- the header shows the armed cell", "- replay is idempotent.", "1) arming is exclusive"),
      ["the header shows the armed cell.", "replay is idempotent.", "arming is exclusive."].join("\n\n"),
    ],
    ["a tight list becomes one paragraph per item", lines("- first item", "- second item", "* third item", "1. fourth item"), "first item.\n\nsecond item.\n\nthird item.\n\nfourth item."],
    // A list may interrupt a paragraph with no blank line; the rendered `li` is still its own block.
    ["an item directly under a prose line starts a new paragraph", lines("The cells are:", "- armed", "- idle", "And that is all."), "The cells are:\n\narmed.\n\nidle.\nAnd that is all."],
    // The control: no list marker, so the output is byte for byte what it was
    // before list items became paragraphs — inline reductions included.
    [
      "prose without lists strips exactly as before",
      lines("First paragraph with `prepare` inside.", "", "Second paragraph, see [the plan](https://pavil.io/plan).", "Continued on a second line.", "", "```ts", "const x = 1;", "```", "", "Closing line."),
      lines("First paragraph with prepare inside.", "", "Second paragraph, see the plan.", "Continued on a second line.", "", "⟦code⟧", "", "Closing line."),
    ],
    // The list marker used to defeat the sentinel-only check: `⟦image⟧.` slipped
    // through and woke the cell up to say "obrazek" about a response with no words.
    ["a response that is only a bulleted image says nothing", "- ![the grid, annotated](https://pavil.io/img/grid.png)", ""],
    ["a sentinel beside prose in an item still gets its terminator", "- The layout is ![the grid](https://pavil.io/img/grid.png)", "The layout is ⟦image⟧."],
    // Heading and leading `**TLDR:**` markers are structure the unit builder reads.
    ["heading and emphasis markers are left for the unit builder", lines("## What changed", "", "**TLDR:** the header now speaks."), "## What changed\n\n**TLDR:** the header now speaks."],
  ])("lists and structure: %s", (_label, markdown, spoken) => {
    expect(stripToSpeakableText(markdown)).toBe(spoken);
  });

  it("a bulleted image stays a sentinel-only paragraph", () => {
    // The unit builder recognises such a paragraph with `SENTINEL_ONLY_RE` and
    // treats it as an omission; a terminator or stray marker would defeat that.
    const markdown = lines("Intro line.", "- ![the grid](https://pavil.io/img/grid.png)", "- second");

    const paragraphs = stripToSpeakableText(markdown).split(/\n{2,}/);

    expect(paragraphs).toEqual(["Intro line.", "⟦image⟧", "second."]);
    expect(SENTINEL_ONLY_RE.test(paragraphs[1])).toBe(true);
  });

  // Task 2 — links, images and bare addresses. A link's text is the only part a
  // listener can use; the address gets no placeholder because the sentence still
  // reads whole without it. Anything with no readable text left is named.
  it.each<Row>([
    ["a link speaks its text and drops its address", "See [the ordering hook](https://pavil.io/docs/ordering) for the rule.", "See the ordering hook for the rule."],
    ["unit-builder markers survive inside link text", "Read [**the ordering hook**](https://pavil.io/d) now.", "Read **the ordering hook** now."],
    // Alt text read aloud describes a picture nobody is looking at.
    ["an image is named, not read", "The layout is below. ![the grid, annotated](https://pavil.io/img/grid.png) It has three columns.", "The layout is below. ⟦image⟧ It has three columns."],
    ["a response that is only an image says nothing", "![the grid, annotated](https://pavil.io/img/grid.png)", ""],
    // The trailing full stop is the sentence's, not the address's.
    ["a bare address is named", "The spec lives at https://pavil.io/specs/speech.", "The spec lives at ⟦link⟧."],
    // Addresses are reduced before inline code is unwrapped.
    ["an address in backticks is a link, not an expression", "Fetch it from `https://pavil.io/specs/speech.md` first.", "Fetch it from ⟦link⟧ first."],
    // Otherwise "See [](url) now." became "See now."
    ["a link with no readable text is named", "See [](https://pavil.io/docs/ordering) now.", "See ⟦link⟧ now."],
    // Pins the one level of nesting `LINK_TEXT` allows.
    ["link text with brackets of its own", "See [see [this] note](https://pavil.io/docs/ordering) now.", "See see [this] note now."],
    // Pins the one level of nesting `LINK_DESTINATION` allows.
    ["a destination with parens of its own", "See [the ordering hook](https://pavil.io/docs/a(b)c) now.", "See the ordering hook now."],
    ["a link whose text is itself an address is named", "See [https://pavil.io/specs/speech](https://pavil.io/specs/speech).", "See ⟦link⟧."],
    // A definition line is pure link plumbing.
    [
      "a reference-style link keeps its text and drops the definition",
      lines("The ordering is described in [the ordering hook][ordering].", "", '[ordering]: https://pavil.io/docs/ordering "The ordering hook"'),
      "The ordering is described in the ordering hook.",
    ],
    ["a definition with an address destination is dropped", "[ordering]: https://pavil.io/docs/ordering", ""],
    ["a definition with an angle-bracketed destination is dropped", "[ordering]: <https://pavil.io/docs/ordering>", ""],
    ["a definition with a title is dropped", "[grid]: img/grid.png 'The grid'", ""],
  ])("links: %s", (_label, markdown, spoken) => {
    expect(stripToSpeakableText(markdown)).toBe(spoken);
  });

  // Indexing is not linking: rewriting `arr[0](x)` as `arr0` swaps one token for
  // a plausible-sounding other. And `[label]: text` is how log lines and
  // footnotes are written — matching on shape alone deleted the whole line with
  // no sentinel, the one removal in this module that leaves no trace.
  it.each<[label: string, text: string]>([
    ["an index call in code", "Call `arr[0](x)` now."],
    ["chained indexing", "Read x[i][j] carefully."],
    ["a bracket-paren pair in prose", "See note[1](x) there."],
    ["a code span quoting link syntax", "Write `[text](url)` to make a link."],
    ["a [WARN]: log line", "[WARN]: connection refused, retrying"],
    ["a [TODO]: label", "[TODO]: rewrite this paragraph tomorrow"],
    ["a [1]: footnote", "[1]: Kowalski, 2026, page 14"],
  ])("leaves brackets that are not links alone: %s", (_label, text) => {
    expect(stripToSpeakableText(text)).toBe(text.replace(/`/g, ""));
  });

  // Paths are spoken as their last meaningful segment, separators inside it as spaces.
  it.each<Row>([
    // The live bug: the last segment of a path ending in `/` is the empty string,
    // so the token was spoken as nothing — "the plan lives in now".
    ["live bug: path ending in a separator, in backticks", "The plan lives in `openspec/changes/speech-flow-and-diction/` now.", "The plan lives in speech flow and diction now."],
    ["live bug: path ending in a separator, unwrapped", "The plan lives in openspec/changes/speech-flow-and-diction/ now.", "The plan lives in speech flow and diction now."],
    ["live bug: several trailing separators are still one path", "Look under `panel/src/features/speech//` for it.", "Look under speech for it."],
    // The original bug in its commonest position: `PATH_RE`'s final segment ate
    // the sentence's full stop, so the last segment was "." and `tidySpacing`
    // glued it back on, deleting the path.
    ["original bug: a path ending the sentence keeps the full stop", "The plan lives in openspec/changes/speech-flow-and-diction/. Next.", "The plan lives in speech flow and diction. Next."],
    ["original bug: two paths, the second sentence-final", "Move openspec/changes/aaa-bbb-ccc-ddd/ to openspec/changes/eee-fff-ggg-hhh/.", "Move aaa bbb ccc ddd to eee fff ggg hhh."],
    ["original bug: the backticked form cannot drift from the bare one", "The plan lives in `openspec/changes/speech-flow-and-diction/`. Next.", "The plan lives in speech flow and diction. Next."],
    // A segment made only of separators speaks as empty: the spoken segment is
    // the last with anything left after separators become spaces.
    ["a last segment of only a hyphen", "Look in panel/src/features/speech/- for it.", "Look in speech for it."],
    ["a last segment of only underscores", "Look in panel/src/features/speech/__ for it.", "Look in speech for it."],
    ["hyphens inside a segment are word spacing", "Open panel/src/features/speech/use-speech-player.ts now.", "Open use speech player.ts now."],
    ["underscores inside a segment, a run is one space", "Open panel/docs/heading__line_re.md now.", "Open heading line re.md now."],
    ["a long path with a line range is elided", "See panel/src/features/terminal/TerminalLayoutGrid.tsx:453-478 for the grid.", "See TerminalLayoutGrid.tsx for the grid."],
    ["the same path as inline code", "See `panel/src/features/terminal/TerminalLayoutGrid.tsx:453-478` for the grid.", "See TerminalLayoutGrid.tsx for the grid."],
    ["a bare filename with a line range", "Read useTerminalOrdering.ts:66-75 again.", "Read useTerminalOrdering.ts again."],
    // Order is load-bearing: or `12-30` is spoken as "twelve thirty".
    ["the line reference drops before the segment is spaced", "See panel/src/use-speech-player.ts:12-30 for the swap.", "See use speech player.ts for the swap."],
    ["a short path is followable by ear and kept verbatim", "See `src/strip.ts` for the filter.", "See src/strip.ts for the filter."],
    // A path is not an expression, however long the span.
    ["a long backticked path keeps its segment, not ⟦expr⟧", "See `panel/src/features/speech/use-speech-player.ts` for the swap.", "See use speech player.ts for the swap."],
    // The guard: spacing separators across prose would split a Polish hyphenated word.
    ["a hyphenated word beside a path is left alone", "Zdjęcie czarno-białe leży w openspec/changes/speech-flow-and-diction/ do jutra.", "Zdjęcie czarno-białe leży w speech flow and diction do jutra."],
    ["hyphenated words with no path are untouched", "Ten e-mail jest czarno-biały i dobrze znany.", "Ten e-mail jest czarno-biały i dobrze znany."],
  ])("paths: %s", (_label, markdown, spoken) => {
    expect(stripToSpeakableText(markdown)).toBe(spoken);
  });

  // Inline code is unwrapped; past the cap an *expression* (a span with a space
  // in it) is named ⟦expr⟧ — it used to be dropped, which rewrote the sentence
  // into a lie. A single token is a name and is spoken at any length.
  it.each<Row>([
    ["short inline code is unwrapped", "Call `prepare` before speaking.", "Call prepare before speaking."],
    ["inline code exactly at the cap is spoken", `Call \`${AT_CAP}\` first.`, `Call ${AT_CAP} first.`],
    ["an expression past the cap is named", `Call \`${AT_CAP} + 1\` first.`, "Call ⟦expr⟧ first."],
    ["a single token past the cap is a name and is spoken", `Call \`${AT_CAP}a\` first.`, `Call ${AT_CAP}a first.`],
    [
      "long change-ids are names, not expressions",
      "Active: `terminal-tab-reachability`, `terminal-resize-discipline`, `2026-04-19-launch-distribution`.",
      "Active: terminal-tab-reachability, terminal-resize-discipline, 2026-04-19-launch-distribution.",
    ],
    ["underscores join a token like a hyphen", "See `SPEECH_STREAM_STALL_TIMEOUT_MS` for the wait.", "See SPEECH_STREAM_STALL_TIMEOUT_MS for the wait."],
    ["a long spaced span is an expression", "Call `const x = await synth(a, b, c, d)` first.", "Call ⟦expr⟧ first."],
    ["an over-long call chain is named, not dropped", 'Call `units.map((u) => u.text).join(" ")` before speaking.', "Call ⟦expr⟧ before speaking."],
    ["a response that is only an expression says nothing", '`units.map((u) => u.text).join(" ")`', ""],
  ])("inline code: %s", (_label, markdown, spoken) => {
    expect(stripToSpeakableText(markdown)).toBe(spoken);
  });
});
