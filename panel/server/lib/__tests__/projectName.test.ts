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
    it("rejects empty string", () => {
      expect(validateProjectName("")).toMatch(/length/);
    });
    it("rejects '..'", () => {
      expect(validateProjectName("..")).toMatch(/invalid/);
    });
    it("rejects '../etc'", () => {
      expect(validateProjectName("../etc")).toMatch(/invalid/);
    });
    it("rejects forward slash", () => {
      expect(validateProjectName("metro/sub")).toMatch(/invalid/);
    });
    it("rejects backslash", () => {
      expect(validateProjectName("metro\\sub")).toMatch(/invalid/);
    });
    it("rejects trailing whitespace", () => {
      expect(validateProjectName("metro ")).toMatch(/invalid/);
    });
    it("rejects leading dot (hidden)", () => {
      expect(validateProjectName(".hidden")).toMatch(/invalid/);
    });
    it("rejects too long (65 chars)", () => {
      expect(validateProjectName("a".repeat(65))).toMatch(/length/);
    });
    it("rejects non-string (undefined)", () => {
      expect(validateProjectName(undefined)).toMatch(/string/);
    });
    it("rejects non-string (null)", () => {
      expect(validateProjectName(null)).toMatch(/string/);
    });
    it("rejects non-string (number)", () => {
      expect(validateProjectName(123)).toMatch(/string/);
    });
    it("rejects non-string (object)", () => {
      expect(validateProjectName({})).toMatch(/string/);
    });
  });
});
