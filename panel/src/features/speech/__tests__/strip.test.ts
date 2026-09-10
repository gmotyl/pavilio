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
    // blank lines — so whatever splits paragraphs downstream still sees two.
    expect(spoken).toBe(
      "The grid keeps its own ordering.\n\nThat ordering is what the header reads.",
    );
    expect(spoken.split(/\n{2,}/)).toEqual([
      "The grid keeps its own ordering.",
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
    expect(spoken).toBe("Here is the cell state.\n\nOnly one cell is ever armed.");
  });

  it("keeps short inline code", () => {
    expect(stripToSpeakableText("Call `prepare` before speaking.")).toBe(
      "Call prepare before speaking.",
    );

    const atThreshold = "a".repeat(MAX_SPOKEN_CODE_CHARS);
    expect(stripToSpeakableText(`Call \`${atThreshold}\` first.`)).toBe(
      `Call ${atThreshold} first.`,
    );

    // One character past the threshold is no longer followable by ear.
    const pastThreshold = "a".repeat(MAX_SPOKEN_CODE_CHARS + 1);
    expect(stripToSpeakableText(`Call \`${pastThreshold}\` first.`)).toBe("Call first.");
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

    // Exactly the empty string — not whitespace.
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

    expect(spoken).toBe("The patch is below.");
    expect(spoken).not.toContain("const a");
    expect(spoken).not.toContain("truncated");
  });

  it("removes a tilde-fenced block", () => {
    const markdown = ["Intro.", "", "~~~", "const x = 1;", "~~~", "", "Outro."].join("\n");

    expect(stripToSpeakableText(markdown)).toBe("Intro.\n\nOutro.");
  });

  it("leaves heading and emphasis markers for the unit builder", () => {
    const markdown = ["## What changed", "", "**TLDR:** the header now speaks."].join("\n");

    // Structure downstream depends on (first heading, leading `**TLDR:**`), so
    // those markers are deliberately not stripped here.
    expect(stripToSpeakableText(markdown)).toBe(
      "## What changed\n\n**TLDR:** the header now speaks.",
    );
  });
});
