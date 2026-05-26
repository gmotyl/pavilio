import { describe, it, expect, afterEach, vi } from "vitest";
import { localISODate } from "../dateLocal";

afterEach(() => {
  vi.useRealTimers();
});

describe("localISODate (server)", () => {
  it("formats as YYYY-MM-DD with zero-padding", () => {
    expect(localISODate(new Date(2026, 2, 7, 12, 0))).toBe("2026-03-07");
  });

  it("returns the local calendar date (not UTC)", () => {
    expect(localISODate(new Date(2026, 4, 25, 23, 30))).toBe("2026-05-25");
  });

  it("defaults to the current date when no argument is given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 9, 0));
    expect(localISODate()).toBe("2026-01-01");
  });

  it("output shape is always YYYY-MM-DD", () => {
    expect(localISODate(new Date(2026, 11, 9, 0, 0))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });
});
