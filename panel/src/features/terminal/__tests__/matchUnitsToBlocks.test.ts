import { describe, expect, it } from "vitest";
import { prepare } from "../../speech/prepare";
import { matchUnitsToBlocks, normalizeForMatch } from "../matchUnitsToBlocks";

/**
 * One paragraph past the unit ceiling (450) but under twice it, so `prepare`
 * cuts it into exactly two units on a sentence boundary.
 */
const longParagraph = "The answer pane keeps the spoken block in view while the voice reads it aloud. "
  .repeat(9)
  .trim();

const closing =
  "Closing paragraph: the eye on bar opens the pane, the rail mirrors the scrubber and Escape returns focus to the terminal.";

/** A response with every block kind the pane has to deal with. */
const answer = [
  "# Answer pane design",
  "",
  "**TLDR:** the pane marks the block being spoken and follows the voice.",
  "",
  longParagraph,
  "",
  "```ts",
  "const answer = matchUnitsToBlocks(units, blocks);",
  "```",
  "",
  "| Rule | Purpose |",
  "|---|---|",
  "| floor | list items |",
  "| prefix | ceiling |",
  "",
  "- Eye on bar",
  "",
  closing,
  "",
].join("\n");

/**
 * `textContent` of each direct child of the rendered markdown root, in the
 * order a browser would give it: the `h1` without its `#`, the TLDR paragraph
 * with the `<strong>` unwrapped, the code block's raw code, the table's cells
 * run together by whitespace, and the `<ul>` — ONE block — whose text is its
 * sole three-word item.
 */
const blocks = [
  "Answer pane design",
  "TLDR: the pane marks the block being spoken and follows the voice.",
  longParagraph,
  "const answer = matchUnitsToBlocks(units, blocks);\n",
  "Rule Purpose floor list items prefix ceiling",
  "Eye on bar",
  closing,
];

const HEADING = 0;
const TLDR = 1;
const LONG = 2;
const CODE = 3;
const TABLE = 4;
const LIST = 5;
const CLOSING = 6;

describe("matchUnitsToBlocks", () => {
  const { units } = prepare(answer);
  const map = matchUnitsToBlocks(units, blocks);

  it("the heading unit finds the heading block", () => {
    expect(units[0].source).toBe("# Answer pane design");
    expect(map.unitToBlocks[0]).toEqual([HEADING]);
    expect(map.blockToUnit[HEADING]).toBe(0);
  });

  it("the TLDR unit finds its paragraph", () => {
    expect(units[1].source.startsWith("**TLDR:**")).toBe(true);
    expect(map.unitToBlocks[1]).toEqual([TLDR]);
    expect(map.blockToUnit[TLDR]).toBe(1);
  });

  it("a paragraph split by the ceiling maps to both of its units", () => {
    // Units 2 and 3 are the two halves; unit 4 packs everything after them.
    // Both halves carry the whole paragraph as their source — the match works
    // at block granularity, and a paragraph is one block.
    expect(units).toHaveLength(5);
    expect(units[2].source).toBe(longParagraph);
    expect(units[3].source).toBe(longParagraph);
    expect(map.unitToBlocks[2]).toEqual([LONG]);
    expect(map.unitToBlocks[3]).toEqual([LONG]);
    expect(map.blockToUnit[LONG]).toBe(2);
  });

  it("code and table blocks are unspoken and unmatched", () => {
    expect(map.blockToUnit[CODE]).toBeNull();
    expect(map.blockToUnit[TABLE]).toBeNull();
    for (const owned of map.unitToBlocks) {
      expect(owned).not.toContain(CODE);
      expect(owned).not.toContain(TABLE);
    }
  });

  it("a three-word list item is not a false positive", () => {
    // Its words occur verbatim in the closing paragraph, which unit 4 contains.
    expect(units[4].source).toContain("Eye on bar");
    expect(normalizeForMatch(blocks[LIST]).length).toBeLessThan(12);
    expect(map.blockToUnit[LIST]).toBeNull();
    expect(map.unitToBlocks[4]).toEqual([CLOSING]);
    expect(map.blockToUnit[CLOSING]).toBe(4);
  });

  it("Polish pronunciation does not break the match", () => {
    const polish = prepare(answer, { language: "pl" });
    // The spoken text changed; the source it was spoken from did not.
    expect(polish.units[0].text).not.toBe(units[0].text);
    expect(polish.units.map((unit) => unit.source)).toEqual(units.map((unit) => unit.source));

    expect(matchUnitsToBlocks(polish.units, blocks)).toEqual(map);
  });

  it("a sentinel-only unit has no block", () => {
    const body =
      "A body paragraph that follows the fenced code block and is long enough to be spoken on its own.";
    const opensWithCode = ["# Answer pane design", "", "```ts", "const x = 1;", "```", "", body].join("\n");
    const prepared = prepare(opensWithCode);
    expect(prepared.units.map((unit) => unit.source)).toEqual(["# Answer pane design", "⟦code⟧", body]);

    const result = matchUnitsToBlocks(prepared.units, ["Answer pane design", "const x = 1;\n", body]);
    expect(result.unitToBlocks).toEqual([[0], [], [2]]);
    expect(result.blockToUnit).toEqual([0, null, 2]);
  });
});
