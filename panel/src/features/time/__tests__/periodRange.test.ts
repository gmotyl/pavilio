import { describe, it, expect } from "vitest";
import { rangeForPeriod } from "../periodRange";

const may25 = new Date(2026, 4, 25); // Mon May 25, 2026 (months are 0-indexed)

describe("rangeForPeriod", () => {
  it("today: from == to == today", () => {
    expect(rangeForPeriod("today", may25)).toEqual({ from: "2026-05-25", to: "2026-05-25" });
  });

  it("this-week: Mon-Sun containing today", () => {
    // May 25 2026 is a Monday → from=May 25, to=May 31
    expect(rangeForPeriod("this-week", may25)).toEqual({ from: "2026-05-25", to: "2026-05-31" });
  });

  it("this-week when today is Sunday", () => {
    const sun = new Date(2026, 4, 31); // Sunday May 31
    expect(rangeForPeriod("this-week", sun)).toEqual({ from: "2026-05-25", to: "2026-05-31" });
  });

  it("last-week", () => {
    expect(rangeForPeriod("last-week", may25)).toEqual({ from: "2026-05-18", to: "2026-05-24" });
  });

  it("this-month: full calendar month containing today", () => {
    expect(rangeForPeriod("this-month", may25)).toEqual({ from: "2026-05-01", to: "2026-05-31" });
  });

  it("last-month: full previous calendar month", () => {
    expect(rangeForPeriod("last-month", may25)).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  });

  it("last-month from January wraps to previous year", () => {
    const jan15 = new Date(2026, 0, 15);
    expect(rangeForPeriod("last-month", jan15)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("custom range pass-through", () => {
    expect(rangeForPeriod({ from: "2026-01-01", to: "2026-01-31" }, may25))
      .toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });
});
