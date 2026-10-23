import { describe, expect, it } from "vitest";

import { groupArchived } from "../archiveGroups";

// Local-time ISO strings (no `Z`) so the buckets do not shift with the test machine's zone.
// Thursday 2026-10-22: the week started Monday 2026-10-19.
const NOW = new Date(2026, 9, 22, 15, 0, 0);

function row(name: string, archivedAt: string) {
  return { name, archivedAt };
}

describe("groupArchived", () => {
  it("groups This week, This month, months, years with a fixed now", () => {
    const groups = groupArchived(
      [
        row("old", "2024-03-02T10:00:00"),
        row("week", "2026-10-20T10:00:00"),
        row("last-year", "2025-09-30T10:00:00"),
        row("month", "2026-10-05T10:00:00"),
        row("august", "2026-08-14T10:00:00"),
        // Twelve months back is the oldest month that keeps its own name.
        row("october", "2025-10-03T10:00:00"),
      ],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual([
      "This week",
      "This month",
      "August 2026",
      "October 2025",
      "2025",
      "2024",
    ]);
    expect(groups.map((g) => g.rows.map((r) => r.name))).toEqual([
      ["week"],
      ["month"],
      ["august"],
      ["october"],
      ["last-year"],
      ["old"],
    ]);
  });

  it("omits empty groups", () => {
    const groups = groupArchived(
      [
        row("a", "2026-09-01T10:00:00"),
        row("b", "2026-09-28T10:00:00"),
        // Monday 00:00 is the first instant of this week.
        row("monday", "2026-10-19T00:00:00"),
        // Sunday before is still this month, not this week.
        row("sunday", "2026-10-18T23:59:00"),
      ],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(["This week", "This month", "September 2026"]);
    // Newest first inside a group too.
    expect(groups[2].rows.map((r) => r.name)).toEqual(["b", "a"]);
    expect(groupArchived([], NOW)).toEqual([]);
  });

  it("puts rows with an unparseable archivedAt last, under Unknown date", () => {
    const groups = groupArchived(
      [
        row("broken", "not-a-date"),
        row("week", "2026-10-20T10:00:00"),
        row("empty", ""),
        row("old", "2024-03-02T10:00:00"),
      ],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(["This week", "2024", "Unknown date"]);
    expect(groups[2].rows.map((r) => r.name)).toEqual(["broken", "empty"]);
    expect(groups.some((g) => g.label.includes("NaN"))).toBe(false);
  });
});
