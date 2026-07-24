import { describe, it, expect } from "vitest";
import { matchProjectFromPath } from "../matchProjectFromPath";

describe("matchProjectFromPath", () => {
  it("returns null for non-project paths", () => {
    expect(matchProjectFromPath("/")).toBeNull();
    expect(matchProjectFromPath("/settings")).toBeNull();
  });
  it("parses name with no section", () => {
    expect(matchProjectFromPath("/project/vector")).toEqual({
      name: "vector",
      section: null,
    });
  });
  it("parses name + section", () => {
    expect(matchProjectFromPath("/project/vector/memo")).toEqual({
      name: "vector",
      section: "memo",
    });
  });
  it("decodes the project name", () => {
    expect(matchProjectFromPath("/project/my%20proj/iterm")).toEqual({
      name: "my proj",
      section: "iterm",
    });
  });
});
