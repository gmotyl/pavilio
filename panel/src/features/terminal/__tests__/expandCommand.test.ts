import { describe, expect, it } from "vitest";

import { expandCommand } from "../expandCommand";

const known: ReadonlySet<string> = new Set(["pavilio-grill", "pavilio-note", "pavilio-question"]);

const instruction = (name: string): string =>
  `Read and follow the instructions in skills/${name}/SKILL.md exactly.`;

describe("expandCommand", () => {
  it("a skill mid-sentence is replaced in place", () => {
    expect(expandCommand("do some stuff use /pavilio-note", known)).toBe(
      `do some stuff use ${instruction("pavilio-note")}`,
    );
    // Text after it stays where it is, whatever whitespace separates it.
    expect(expandCommand("first /pavilio-note\nthen more", known)).toBe(
      `first ${instruction("pavilio-note")}\nthen more`,
    );
    // Leading whitespace is still whitespace before the slash.
    expect(expandCommand("  /pavilio-grill my idea", known)).toBe(`  ${instruction("pavilio-grill")} my idea`);
  });

  it("a leading skill is replaced in place with the rest following", () => {
    expect(expandCommand("/pavilio-grill my idea", known)).toBe(`${instruction("pavilio-grill")} my idea`);
    // No `ARGUMENTS:` form, and nothing trimmed or added around the token.
    expect(expandCommand("/pavilio-question", known)).toBe(instruction("pavilio-question"));
    expect(expandCommand("/pavilio-question   ", known)).toBe(`${instruction("pavilio-question")}   `);
    expect(expandCommand("/pavilio-grill\n\n  first line\nsecond  line\n", known)).toBe(
      `${instruction("pavilio-grill")}\n\n  first line\nsecond  line\n`,
    );
  });

  it("every known token is replaced", () => {
    expect(expandCommand("/pavilio-grill then /pavilio-note and /pavilio-grill", known)).toBe(
      `${instruction("pavilio-grill")} then ${instruction("pavilio-note")} and ${instruction("pavilio-grill")}`,
    );
    // Adjacent tokens, one space apart.
    expect(expandCommand("/pavilio-grill /pavilio-note", known)).toBe(
      `${instruction("pavilio-grill")} ${instruction("pavilio-note")}`,
    );
    // Only the known ones in a mixed draft.
    expect(expandCommand("/clear then /pavilio-note", known)).toBe(`/clear then ${instruction("pavilio-note")}`);
  });

  it("trailing punctuation stays after the replacement", () => {
    // A kept full stop replaces the instruction's own, so it is not doubled.
    expect(expandCommand("use /pavilio-note.", known)).toBe(
      "use Read and follow the instructions in skills/pavilio-note/SKILL.md exactly.",
    );
    expect(expandCommand("use /pavilio-note...", known)).toBe(
      "use Read and follow the instructions in skills/pavilio-note/SKILL.md exactly...",
    );
    // Any other punctuation follows the instruction's full stop.
    expect(expandCommand("use /pavilio-note,", known)).toBe(
      "use Read and follow the instructions in skills/pavilio-note/SKILL.md exactly.,",
    );
    expect(expandCommand("use /pavilio-note, then stop", known)).toBe(
      `use ${instruction("pavilio-note")}, then stop`,
    );
    expect(expandCommand("really /pavilio-grill?!", known)).toBe(`really ${instruction("pavilio-grill")}?!`);
    // Punctuation is only stripped off the END of the name.
    expect(expandCommand("use /pavilio-note.x", known)).toBe("use /pavilio-note.x");
  });

  it("a path is not a command", () => {
    expect(expandCommand("see projects/pavilio-grill", known)).toBe("see projects/pavilio-grill");
    expect(expandCommand("a/b", known)).toBe("a/b");
    // A known name followed by more path is one unknown token.
    expect(expandCommand("open /pavilio-grill/SKILL.md", known)).toBe("open /pavilio-grill/SKILL.md");
    // A slash glued to a preceding character is inside a word.
    expect(expandCommand("(/pavilio-grill)", known)).toBe("(/pavilio-grill)");
  });

  it("an unknown command is untouched", () => {
    expect(expandCommand("/not-a-skill do the thing", known)).toBe("/not-a-skill do the thing");
    // A known name as a PREFIX of the token is not the known name.
    expect(expandCommand("/pavilio-grill-ish x", known)).toBe("/pavilio-grill-ish x");
    expect(expandCommand("/", known)).toBe("/");
    expect(expandCommand("a / b", known)).toBe("a / b");
    expect(expandCommand("/pavilio-grill x", new Set())).toBe("/pavilio-grill x");
  });
});
