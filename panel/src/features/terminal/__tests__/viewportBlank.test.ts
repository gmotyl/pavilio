import { describe, expect, it } from "vitest";
import { viewportLooksBlank } from "../viewportBlank";

/** Minimal stand-in for the slice of xterm's API the helper reads. */
function fakeTerminal(lines: (string | null)[], viewportY = 0) {
  return {
    rows: lines.length,
    buffer: {
      active: {
        viewportY,
        getLine: (index: number) => {
          const text = lines[index - viewportY];
          if (text === null || text === undefined) return undefined;
          return { translateToString: () => text };
        },
      },
    },
  } as never;
}

describe("viewportLooksBlank", () => {
  it("is true when every visible row is empty", () => {
    expect(viewportLooksBlank(fakeTerminal(["", "   ", ""]))).toBe(true);
  });

  it("is true when the rows do not exist at all", () => {
    expect(viewportLooksBlank(fakeTerminal([null, null]))).toBe(true);
  });

  it("is false as soon as one visible row has content", () => {
    expect(viewportLooksBlank(fakeTerminal(["", "› prompt", ""]))).toBe(false);
  });

  it("reads the rows at the current scroll offset, not the top of the buffer", () => {
    // Buffer top is blank, but the viewport sits lower where content lives.
    expect(viewportLooksBlank(fakeTerminal(["", "content"], 40))).toBe(false);
  });
});
