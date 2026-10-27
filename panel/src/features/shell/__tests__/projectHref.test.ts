import { describe, expect, it } from "vitest";
import { projectHref } from "../projectHref";

describe("projectHref", () => {
  it("projectHref sends a phone to the terminal tab", () => {
    expect(projectHref("vector", true)).toBe("/project/vector/iterm");
  });

  it("projectHref keeps the bare route on desktop", () => {
    expect(projectHref("vector", false)).toBe("/project/vector");
  });

  it("projectHref percent-encodes spaces and #", () => {
    expect(projectHref("my proj", false)).toBe("/project/my%20proj");
    expect(projectHref("a#b", true)).toBe("/project/a%23b/iterm");
  });
});
