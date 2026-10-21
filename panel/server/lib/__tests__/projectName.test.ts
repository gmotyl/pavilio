import { describe, it, expect } from "vitest";
import { validateProjectName } from "../projectName.js";

describe("validateProjectName", () => {
  describe("valid names", () => {
    it.each([
      ["metro"],
      ["my-blog"],
      ["Foo_Bar123"],
      ["a"],
      ["A"],
      ["0"],
      ["a".repeat(64)],
      ["abc-123_XYZ"],
    ])("accepts %s", (name) => {
      expect(validateProjectName(name)).toBeNull();
    });
  });

  describe("invalid names", () => {
    it.each<[string, unknown, RegExp]>([
      ["empty string", "", /length/],
      ["'..'", "..", /invalid/],
      ["'../etc'", "../etc", /invalid/],
      ["forward slash", "metro/sub", /invalid/],
      ["backslash", "metro\\sub", /invalid/],
      ["trailing whitespace", "metro ", /invalid/],
      ["leading dot (hidden)", ".hidden", /invalid/],
      ["too long (65 chars)", "a".repeat(65), /length/],
      ["non-string (undefined)", undefined, /string/],
      ["non-string (null)", null, /string/],
      ["non-string (number)", 123, /string/],
      ["non-string (object)", {}, /string/],
    ])("rejects %s", (_label, name, reason) => {
      expect(validateProjectName(name)).toMatch(reason);
    });
  });
});
