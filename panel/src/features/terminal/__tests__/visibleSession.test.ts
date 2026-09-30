import { describe, expect, it } from "vitest";
import { visibleSessionId } from "../visibleSession";

const sessions = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("visibleSessionId", () => {
  it("returns the focused session when it is in the list", () => {
    expect(visibleSessionId(sessions, "b")).toBe("b");
  });

  it("falls back to the first session when nothing is focused", () => {
    expect(visibleSessionId(sessions, null)).toBe("a");
  });

  it("falls back to the first session when the focused id is unknown", () => {
    expect(visibleSessionId(sessions, "gone")).toBe("a");
  });

  it("returns null for an empty list", () => {
    expect(visibleSessionId([], null)).toBeNull();
    expect(visibleSessionId([], "a")).toBeNull();
  });
});
