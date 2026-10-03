import { describe, expect, it } from "vitest";
import { notificationText } from "../notificationText";

const session = { id: "sess-42", name: "claude-3", project: "pavilio" };

/** The preview line of a body, or undefined when the body is a single line. */
function preview(body: string): string | undefined {
  return body.split("\n")[1];
}

describe("notificationText", () => {
  it("titles the notification with the project name", () => {
    const copy = notificationText({ session });

    expect(copy.title).toBe("pavilio");
  });

  it("uses the terminal title for the body's first line", () => {
    const copy = notificationText({
      session: { ...session, title: "Fix the reader bar" },
      latestUtterance: "Done.",
    });

    expect(copy.body.split("\n")[0]).toBe("Fix the reader bar");
  });

  it("falls back to the session name when no title has been published", () => {
    const copy = notificationText({ session, latestUtterance: "Done." });

    expect(copy.body.split("\n")[0]).toBe("claude-3");
  });

  it("appends a plain-text preview of the latest utterance", () => {
    const copy = notificationText({
      session,
      latestUtterance: "The tests pass.\n\n  The   branch is   ready\nfor review.",
    });

    expect(copy.body).toBe("claude-3\nThe tests pass. The branch is ready for review.");
  });

  it("truncates a long preview on a word boundary with an ellipsis", () => {
    // 30 five-letter words: 179 characters, well past the bound.
    const words = Array.from({ length: 30 }, (_, i) => `w${String(i).padStart(3, "0")}x`);
    const copy = notificationText({ session, latestUtterance: words.join(" ") });

    const line = preview(copy.body);
    expect(line).toBeDefined();
    // The bound includes the ellipsis itself.
    expect(line!.length).toBeLessThanOrEqual(120);
    expect(line!.endsWith("…")).toBe(true);

    // Every word before the ellipsis is whole — nothing was cut mid-word.
    const kept = line!.slice(0, -1).trimEnd().split(" ");
    expect(kept.every((word) => words.includes(word))).toBe(true);
    // And the cut is as late as the bound allows: one more word would not fit.
    expect(kept.length).toBe(20);
  });

  it("leaves a short preview whole", () => {
    // Exactly at the bound: 120 characters must not be truncated.
    const exact = `${"a".repeat(59)} ${"b".repeat(60)}`;
    expect(exact).toHaveLength(120);

    const copy = notificationText({ session, latestUtterance: exact });

    expect(preview(copy.body)).toBe(exact);
    expect(copy.body).not.toContain("…");
  });

  it("strips markdown tables, links and code fences out of the preview", () => {
    const latestUtterance = [
      "## Summary",
      "",
      "**TLDR:** the fix is in, see [the PR](https://github.com/gmotyl/pavilio/pull/7).",
      "",
      "```ts",
      "const order = useTerminalOrdering();",
      "```",
      "",
      "| cell | state |",
      "| --- | ----- |",
      "| one  | armed |",
      "",
      "Nothing else changed.",
    ].join("\n");

    const copy = notificationText({ session, latestUtterance });
    const line = preview(copy.body)!;

    expect(line).toContain("the fix is in");
    expect(line).toContain("the PR");
    expect(line).not.toContain("useTerminalOrdering");
    expect(line).not.toContain("armed");
    expect(line).not.toContain("https://");
    for (const syntax of ["```", "|", "](", "[", "**", "#", "---"]) {
      expect(line).not.toContain(syntax);
    }
  });

  it("names what was skipped with a plain word instead of a sentinel", () => {
    const latestUtterance = [
      "Here is the result.",
      "",
      "| cell | state |",
      "| --- | ----- |",
      "| one  | armed |",
      "",
      "```ts",
      "const order = useTerminalOrdering();",
      "```",
      "",
      "All __done__ and _shipped_.",
    ].join("\n");

    const line = preview(notificationText({ session, latestUtterance }).body)!;

    expect(line).not.toContain("⟦");
    expect(line).not.toContain("⟧");
    expect(line).toContain("(table)");
    expect(line).toContain("(code)");
    expect(line).toContain("All done and shipped.");
  });

  it("keeps a literal asterisk in the preview", () => {
    const copy = notificationText({
      session,
      latestUtterance: "So 2 * 3 = 6, a * b is the product, and 4*5 = 20.",
    });

    expect(preview(copy.body)).toBe("So 2 * 3 = 6, a * b is the product, and 4*5 = 20.");
  });

  it("still unwraps bold and emphasis, and drops list bullets", () => {
    const copy = notificationText({
      session,
      latestUtterance: "**bold** and *em* stay readable.\n\n* first item\n  * nested item",
    });

    expect(preview(copy.body)).toBe("bold and em stay readable. first item. nested item.");
  });

  it("keeps the heading on one line when the title spans several", () => {
    const copy = notificationText({
      session: { ...session, title: "  Fix the\n  reader   bar \n" },
      latestUtterance: "Done.",
    });

    expect(copy.body).toBe("Fix the reader bar\nDone.");
  });

  it("falls back to the session name when the title is blank", () => {
    const copy = notificationText({ session: { ...session, title: "  \n " } });

    expect(copy.body).toBe("claude-3");
  });

  it("omits the preview entirely when the session has never spoken", () => {
    const copy = notificationText({ session: { ...session, title: "Fix the reader bar" } });

    expect(copy.body).toBe("Fix the reader bar");
  });

  it("tags the notification with the session id", () => {
    const copy = notificationText({ session });

    expect(copy.tag).toBe("sess-42");
    expect(copy.data).toEqual({ sessionId: "sess-42", project: "pavilio" });
  });
});
