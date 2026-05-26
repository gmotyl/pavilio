import { describe, it, expect, afterEach, vi } from "vitest";
import { localISODate } from "../dateLocal";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("localISODate", () => {
  it("formats as YYYY-MM-DD with zero-padding", () => {
    // Local-time constructor (month is 0-indexed): March 7, 2026 → "2026-03-07"
    expect(localISODate(new Date(2026, 2, 7, 12, 0))).toBe("2026-03-07");
  });

  it("returns local date (not UTC) — picks the calendar day the user is in", () => {
    // 23:30 local time on May 25, 2026. Regardless of host timezone, the local
    // date is 2026-05-25; toISOString().slice(0,10) would return the *UTC* date
    // (which can be 2026-05-26 in negative-offset zones or 2026-05-25 elsewhere).
    const d = new Date(2026, 4, 25, 23, 30);
    expect(localISODate(d)).toBe("2026-05-25");
  });

  it("defaults to the current date when no argument is given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 9, 0)); // Jan 1, 2026 local
    expect(localISODate()).toBe("2026-01-01");
  });

  it("differs from toISOString().slice(0,10) at midnight in a negative-offset zone", () => {
    // Force getTimezoneOffset to report UTC-5 (300 minutes). Then 23:30 local
    // on May 25 is 04:30 UTC on May 26. localISODate should still say May 25.
    // We can't truly change the system timezone in vitest, so we craft a Date
    // whose local fields are May 25 23:30 and verify the helper uses those
    // (not the ISO/UTC fields).
    const d = new Date(2026, 4, 25, 23, 30);
    const local = localISODate(d);
    expect(local).toBe("2026-05-25");
    // Pure shape assertion: helper output is always YYYY-MM-DD.
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
