import { describe, it, expect } from "vitest";
import { rangeForPeriod } from "../periodRange";

const may25 = new Date(2026, 4, 25); // Mon May 25, 2026 (months are 0-indexed)

type Period = Parameters<typeof rangeForPeriod>[0];

describe("rangeForPeriod", () => {
  it.each<[label: string, period: Period, today: Date, from: string, to: string]>([
    ["today: from == to == today", "today", may25, "2026-05-25", "2026-05-25"],
    // May 25 2026 is a Monday → from=May 25, to=May 31
    ["this-week: Mon-Sun containing today", "this-week", may25, "2026-05-25", "2026-05-31"],
    ["this-week when today is Sunday", "this-week", new Date(2026, 4, 31), "2026-05-25", "2026-05-31"],
    ["last-week", "last-week", may25, "2026-05-18", "2026-05-24"],
    ["this-month: full calendar month containing today", "this-month", may25, "2026-05-01", "2026-05-31"],
    ["last-month: full previous calendar month", "last-month", may25, "2026-04-01", "2026-04-30"],
    ["last-month from January wraps to previous year", "last-month", new Date(2026, 0, 15), "2025-12-01", "2025-12-31"],
    ["custom range pass-through", { from: "2026-01-01", to: "2026-01-31" }, may25, "2026-01-01", "2026-01-31"],
    ["yesterday: from == to == today-1", "yesterday", may25, "2026-05-24", "2026-05-24"],
    ["yesterday wraps across year boundary", "yesterday", new Date(2026, 0, 1), "2025-12-31", "2025-12-31"],
    ["this-year: Jan 1 – Dec 31 of current year", "this-year", may25, "2026-01-01", "2026-12-31"],
    ["last-year: Jan 1 – Dec 31 of previous year", "last-year", may25, "2025-01-01", "2025-12-31"],
  ])("%s", (_label, period, today, from, to) => {
    expect(rangeForPeriod(period, today)).toEqual({ from, to });
  });
});
