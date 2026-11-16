import { describe, expect, it } from "vitest";
import { prepare } from "../../speech/prepare";
import { blockMatchStrength, normalizeForMatch } from "../../speech/matchUnitsToBlocks";

/**
 * The rules a rendered block is matched to a unit's `source` by — the ones
 * Play from here's in-order walk (`firstUnitsOfBlocks`) ranks candidates with.
 * Lower is stronger: 0 the block is the unit, 1 the unit holds the block, 2 the
 * block holds the unit, 3 only a head/tail window is found; null no match.
 */
const strength = (block: string, source: string): number | null =>
  blockMatchStrength(normalizeForMatch(block), normalizeForMatch(source));

const closing =
  "Closing paragraph: the eye on bar opens the pane, the play buttons sit beside the text and Escape returns focus to the terminal.";

/** A response with every block kind the pane has to deal with. */
const answer = [
  "# Answer pane design",
  "",
  "**TLDR:** the pane marks the block being spoken and follows the voice.",
  "",
  "```ts",
  "const answer = firstUnitsOfBlocks(units, blocks);",
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

/** `textContent` of the rendered code block and table, as a browser gives them. */
const CODE = "const answer = firstUnitsOfBlocks(units, blocks);\n";
const TABLE = "Rule Purpose floor list items prefix ceiling";

describe("blockMatchStrength", () => {
  it("a block that is the unit matches outright, under the floor too", () => {
    // `## Result` normalizes to 6 characters — under the floor — yet `prepare`
    // speaks it as its own unit, so equality has to find it without a floor.
    expect(strength("Result", "## Result")).toBe(0);
    expect(
      strength(
        "TLDR: the pane marks the block being spoken and follows the voice.",
        "**TLDR:** the pane marks the block being spoken and follows the voice.",
      ),
    ).toBe(0);
  });

  it("a unit that packs the block whole, and one cut out of a longer block", () => {
    const block = "The pane marks the block being spoken and scrolls once.";
    const longer = `${block} And then it waits for the next one.`;
    expect(strength(block, longer)).toBe(1);
    expect(strength(longer, block)).toBe(2);
  });

  it("a short unit marks no block that merely contains it", () => {
    const first = "Yes. The pane marks the block being spoken and scrolls once per unit.";
    const second = "Yes is the word every later paragraph seems to echo somewhere.";
    // Under the floor on the unit's side: `b.includes(u)` must not match.
    expect(strength(first, "Yes.")).toBeNull();
    expect(strength(second, "Yes.")).toBeNull();
  });

  it("a heading is not credited with the paragraph that echoes it", () => {
    const body = "The bar waits for the voice before it renders anything at all.";
    expect(strength(body, "# The bar")).toBeNull();
    expect(strength("The bar", "# The bar")).toBe(0);
  });

  it("a three-word list item is not a false positive", () => {
    // Its words occur verbatim in the closing paragraph: under the floor on the
    // block's side, so only its own unit matches it.
    expect(normalizeForMatch("Eye on bar").length).toBeLessThan(12);
    expect(strength("Eye on bar", closing)).toBeNull();
    expect(strength("Eye on bar", "- Eye on bar")).toBe(0);
  });

  it("code and table blocks match no unit", () => {
    for (const unit of prepare(answer).units) {
      expect(strength(CODE, unit.source), unit.source).toBeNull();
      expect(strength(TABLE, unit.source), unit.source).toBeNull();
    }
  });

  it("a paragraph with a long code span is still found by its window", () => {
    // The smoke test's real answer (2026-09-16). `strip` replaces the code span
    // over the spoken limit with `⟦expr⟧`, so the source is neither a substring
    // of its block nor the other way round — only its head survives.
    const markdown = [
      "Hi. AGENTS.md loaded; no `.projects.local.md`, so no project registry yet.",
      "",
      "Branch `feat/in-cell-answer-pane`, clean tree, last commit `c75d42d refactor(terminal): the cell reader is screen-only again`.",
      "",
      "What next — `resume <project>`, or a specific task?",
    ].join("\n");
    const rendered =
      "Branch feat/in-cell-answer-pane, clean tree, last commit c75d42d refactor(terminal): the cell reader is screen-only again.";
    const unit = prepare(markdown).units.find((u) => u.source.startsWith("Branch"));
    expect(unit?.source).toContain("last commit ⟦expr⟧.");
    expect(strength(rendered, unit!.source)).toBe(3);
  });

  it("a look-alike paragraph matches its own unit more strongly", () => {
    // Both paragraphs open with the same 24+ normalized characters, so the head
    // window matches each against both units; equality outranks the window.
    const first = "The answer pane keeps the spoken block in view while the voice moves on.";
    const second = "The answer pane keeps the terminal visible below a short answer, as the design asks.";
    expect(normalizeForMatch(first).slice(0, 24)).toBe(normalizeForMatch(second).slice(0, 24));
    expect(strength(second, first)).toBe(3);
    expect(strength(second, second)).toBe(0);
  });

  it("an empty unit matches nothing, not even an empty block", () => {
    // An `<hr>` renders as a block with an empty `textContent`.
    expect(strength("", "")).toBeNull();
  });

  it("Polish preparation keeps the sources the match reads", () => {
    const english = prepare(answer).units;
    const polish = prepare(answer, { language: "pl" }).units;
    // Prepared in Polish (anytts respells at synthesis); the source is the same.
    expect(polish.every((unit) => unit.lang === "pl")).toBe(true);
    expect(polish.map((unit) => unit.source)).toEqual(english.map((unit) => unit.source));
  });
});
