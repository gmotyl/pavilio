import { describe, it, expect } from "vitest";
import {
  formatReport,
  formatHHMM,
  groupByDay,
  csvEscape,
  type ReportEntry,
} from "../reportFormatters";

const FIXTURE: ReportEntry[] = [
  { date: "2026-05-19", minutes: 90, note: "PR review #24" },
  { date: "2026-05-19", minutes: 45, note: "Design call w/ Anna" },
  { date: "2026-05-20", minutes: 120, note: "Time tracking spec" },
  { date: "2026-05-20", minutes: 75, note: "Time tracking impl spike" },
  { date: "2026-05-22", minutes: 180, note: "Terminal LED bug fix" },
  { date: "2026-05-22", minutes: 30, note: "Slack triage" },
  { date: "2026-05-23", minutes: 60, note: "Code review for Bart" },
];

describe("formatHHMM", () => {
  it("formats minutes as H:MM", () => {
    expect(formatHHMM(0)).toBe("0:00");
    expect(formatHHMM(45)).toBe("0:45");
    expect(formatHHMM(60)).toBe("1:00");
    expect(formatHHMM(90)).toBe("1:30");
    expect(formatHHMM(600)).toBe("10:00");
  });
});

describe("groupByDay", () => {
  it("sums minutes and collects notes by date in ascending order", () => {
    const grouped = groupByDay(FIXTURE);
    expect(grouped.map((g) => [g.date, g.minutes])).toEqual([
      ["2026-05-19", 135],
      ["2026-05-20", 195],
      ["2026-05-22", 210],
      ["2026-05-23", 60],
    ]);
    expect(grouped[0].notes).toEqual(["PR review #24", "Design call w/ Anna"]);
  });

  it("skips empty notes", () => {
    const grouped = groupByDay([
      { date: "2026-05-19", minutes: 30, note: "" },
      { date: "2026-05-19", minutes: 60, note: "real note" },
      { date: "2026-05-19", minutes: 15 },
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].minutes).toBe(105);
    expect(grouped[0].notes).toEqual(["real note"]);
  });
});

describe("csvEscape", () => {
  it("returns plain string when no special chars", () => {
    expect(csvEscape("hello")).toBe("hello");
  });
  it("quotes and escapes when special chars present", () => {
    expect(csvEscape("a, b")).toBe('"a, b"');
    expect(csvEscape('a "b" c')).toBe('"a ""b"" c"');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape("a;b")).toBe('"a;b"');
  });
});

describe("formatReport", () => {
  it("text + detailed", () => {
    expect(
      formatReport({
        entries: FIXTURE,
        format: "text",
        detail: "detailed",
        projectLabel: "Pavilio",
        periodLabel: "Week of 19 May 2026",
      }),
    ).toMatchInlineSnapshot(`
      "Pavilio — Week of 19 May 2026
      ─────────────────────────────────────────────────────
      Date         Hours   Note
      2026-05-19   1:30    PR review #24
      2026-05-19   0:45    Design call w/ Anna
      2026-05-20   2:00    Time tracking spec
      2026-05-20   1:15    Time tracking impl spike
      2026-05-22   3:00    Terminal LED bug fix
      2026-05-22   0:30    Slack triage
      2026-05-23   1:00    Code review for Bart
      ─────────────────────────────────────────────────────
      TOTAL        10:00   (7 entries)"
    `);
  });

  it("text + daily", () => {
    expect(
      formatReport({
        entries: FIXTURE,
        format: "text",
        detail: "daily",
        projectLabel: "Pavilio",
        periodLabel: "Week of 19 May 2026",
      }),
    ).toMatchInlineSnapshot(`
      "Pavilio — Week of 19 May 2026
      ─────────────────────────────────────────────────────
      Date         Hours   Notes
      2026-05-19   2:15    PR review #24; Design call w/ Anna
      2026-05-20   3:15    Time tracking spec; Time tracking impl spike
      2026-05-22   3:30    Terminal LED bug fix; Slack triage
      2026-05-23   1:00    Code review for Bart
      ─────────────────────────────────────────────────────
      TOTAL        10:00   (4 days)"
    `);
  });

  it("markdown + detailed", () => {
    expect(
      formatReport({
        entries: FIXTURE,
        format: "markdown",
        detail: "detailed",
        projectLabel: "Pavilio",
        periodLabel: "Week of 19 May 2026",
      }),
    ).toMatchInlineSnapshot(`
      "## Pavilio — Week of 19 May 2026

      | Date | Hours | Note |
      |---|---|---|
      | 2026-05-19 | 1:30 | PR review #24 |
      | 2026-05-19 | 0:45 | Design call w/ Anna |
      | 2026-05-20 | 2:00 | Time tracking spec |
      | 2026-05-20 | 1:15 | Time tracking impl spike |
      | 2026-05-22 | 3:00 | Terminal LED bug fix |
      | 2026-05-22 | 0:30 | Slack triage |
      | 2026-05-23 | 1:00 | Code review for Bart |

      **Total: 10:00** (7 entries)"
    `);
  });

  it("markdown + daily", () => {
    expect(
      formatReport({
        entries: FIXTURE,
        format: "markdown",
        detail: "daily",
        projectLabel: "Pavilio",
        periodLabel: "Week of 19 May 2026",
      }),
    ).toMatchInlineSnapshot(`
      "## Pavilio — Week of 19 May 2026

      | Date | Hours | Notes |
      |---|---|---|
      | 2026-05-19 | 2:15 | PR review #24; Design call w/ Anna |
      | 2026-05-20 | 3:15 | Time tracking spec; Time tracking impl spike |
      | 2026-05-22 | 3:30 | Terminal LED bug fix; Slack triage |
      | 2026-05-23 | 1:00 | Code review for Bart |

      **Total: 10:00** (4 days)"
    `);
  });

  it("csv + detailed", () => {
    expect(
      formatReport({
        entries: FIXTURE,
        format: "csv",
        detail: "detailed",
        projectLabel: "Pavilio",
        periodLabel: "Week of 19 May 2026",
      }),
    ).toMatchInlineSnapshot(`
      "Date,Hours,Minutes,Note
      2026-05-19,1,30,PR review #24
      2026-05-19,0,45,Design call w/ Anna
      2026-05-20,2,0,Time tracking spec
      2026-05-20,1,15,Time tracking impl spike
      2026-05-22,3,0,Terminal LED bug fix
      2026-05-22,0,30,Slack triage
      2026-05-23,1,0,Code review for Bart"
    `);
  });

  it("csv + daily", () => {
    expect(
      formatReport({
        entries: FIXTURE,
        format: "csv",
        detail: "daily",
        projectLabel: "Pavilio",
        periodLabel: "Week of 19 May 2026",
      }),
    ).toMatchInlineSnapshot(`
      "Date,Hours,Minutes,Notes
      2026-05-19,2,15,"PR review #24; Design call w/ Anna"
      2026-05-20,3,15,"Time tracking spec; Time tracking impl spike"
      2026-05-22,3,30,"Terminal LED bug fix; Slack triage"
      2026-05-23,1,0,Code review for Bart"
    `);
  });

  it("handles empty entries (text detailed)", () => {
    expect(
      formatReport({
        entries: [],
        format: "text",
        detail: "detailed",
        projectLabel: "Pavilio",
        periodLabel: "May 2026",
      }),
    ).toMatchInlineSnapshot(`
      "Pavilio — May 2026
      ─────────────────────────────────────────────────────
      Date         Hours   Note
      ─────────────────────────────────────────────────────
      TOTAL        0:00    (0 entries)"
    `);
  });
});
