import { describe, expect, it } from "vitest";

import { expandCommand } from "../expandCommand";

const known: ReadonlySet<string> = new Set(["pavilio-grill", "pavilio-question"]);

describe("expandCommand", () => {
  it("expands a known skill with its argument, using a relative path", () => {
    expect(expandCommand("/pavilio-grill my idea", known)).toBe(
      "Read and follow the instructions in skills/pavilio-grill/SKILL.md exactly. ARGUMENTS: my idea",
    );
    // The separator may be any whitespace run; the argument's own inner
    // whitespace — newlines included — is kept as typed.
    expect(expandCommand("/pavilio-grill\n\n  first line\nsecond  line\n", known)).toBe(
      "Read and follow the instructions in skills/pavilio-grill/SKILL.md exactly. ARGUMENTS: first line\nsecond  line",
    );
  });

  it("expands a known skill with no argument and no trailing separator", () => {
    const bare = "Read and follow the instructions in skills/pavilio-question/SKILL.md exactly. ARGUMENTS:";
    expect(expandCommand("/pavilio-question", known)).toBe(bare);
    // Trailing whitespace alone is not an argument.
    expect(expandCommand("/pavilio-question   ", known)).toBe(bare);
    expect(expandCommand("/pavilio-question\n", known)).toBe(bare);
  });

  it("leaves an unknown command untouched", () => {
    expect(expandCommand("/not-a-skill do the thing", known)).toBe("/not-a-skill do the thing");
    // A known name as a PREFIX of the token is not the known name.
    expect(expandCommand("/pavilio-grill-ish x", known)).toBe("/pavilio-grill-ish x");
    expect(expandCommand("/", known)).toBe("/");
    expect(expandCommand("/pavilio-grill x", new Set())).toBe("/pavilio-grill x");
  });

  it("leaves a mid-text slash untouched", () => {
    expect(expandCommand("run /pavilio-grill my idea", known)).toBe("run /pavilio-grill my idea");
    // Leading whitespace means the slash is not at the start.
    expect(expandCommand("  /pavilio-grill my idea", known)).toBe("  /pavilio-grill my idea");
  });
});
