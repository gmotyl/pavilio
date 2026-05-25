/**
 * Pure report serialisers for manual time entries.
 *
 * Three output formats (text / markdown / csv) × two detail modes (detailed / daily).
 *
 * - `detailed` prints one row per entry.
 * - `daily` rolls up entries per day, joining notes with "; ".
 *
 * No DOM, no React, no IO. Pure functions only.
 */

export type ReportEntry = {
  date: string;
  minutes: number;
  note?: string;
};

export type ReportFormat = "text" | "markdown" | "csv";
export type ReportDetail = "detailed" | "daily";

export type DailyGroup = {
  date: string;
  minutes: number;
  notes: string[];
};

/**
 * Formats minutes as H:MM (no zero-padding on hours).
 *   0 -> "0:00", 60 -> "1:00", 90 -> "1:30", 600 -> "10:00"
 */
export const formatHHMM = (minutes: number): string => {
  const total = Math.max(0, Math.floor(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
};

/**
 * Sums minutes per day and collects non-empty notes; result is ordered by ISO
 * date ascending. Notes preserve insertion order from the input array.
 */
export const groupByDay = (entries: ReportEntry[]): DailyGroup[] => {
  const map = new Map<string, DailyGroup>();
  for (const entry of entries) {
    const existing = map.get(entry.date);
    if (existing) {
      existing.minutes += entry.minutes;
      if (entry.note && entry.note.trim() !== "") {
        existing.notes.push(entry.note);
      }
    } else {
      map.set(entry.date, {
        date: entry.date,
        minutes: entry.minutes,
        notes: entry.note && entry.note.trim() !== "" ? [entry.note] : [],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
};

/**
 * RFC 4180-style CSV field escaping. Quotes the value if it contains a comma,
 * semicolon, newline, or double-quote; doubles inner quotes.
 */
export const csvEscape = (s: string): string => {
  if (/[",;\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

const SEPARATOR = "─".repeat(53);

const padRight = (s: string, width: number): string =>
  s.length >= width ? s : s + " ".repeat(width - s.length);

const totalMinutes = (entries: ReportEntry[]): number =>
  entries.reduce((sum, e) => sum + e.minutes, 0);

const formatTextDetailed = (
  entries: ReportEntry[],
  projectLabel: string,
  periodLabel: string,
): string => {
  const lines: string[] = [];
  lines.push(`${projectLabel} — ${periodLabel}`);
  lines.push(SEPARATOR);
  lines.push(`${padRight("Date", 13)}${padRight("Hours", 8)}Note`);
  for (const e of entries) {
    lines.push(
      `${padRight(e.date, 13)}${padRight(formatHHMM(e.minutes), 8)}${e.note ?? ""}`,
    );
  }
  lines.push(SEPARATOR);
  lines.push(
    `${padRight("TOTAL", 13)}${padRight(formatHHMM(totalMinutes(entries)), 8)}(${entries.length} entries)`,
  );
  return lines.join("\n");
};

const formatTextDaily = (
  entries: ReportEntry[],
  projectLabel: string,
  periodLabel: string,
): string => {
  const grouped = groupByDay(entries);
  const lines: string[] = [];
  lines.push(`${projectLabel} — ${periodLabel}`);
  lines.push(SEPARATOR);
  lines.push(`${padRight("Date", 13)}${padRight("Hours", 8)}Notes`);
  for (const g of grouped) {
    lines.push(
      `${padRight(g.date, 13)}${padRight(formatHHMM(g.minutes), 8)}${g.notes.join("; ")}`,
    );
  }
  lines.push(SEPARATOR);
  lines.push(
    `${padRight("TOTAL", 13)}${padRight(formatHHMM(totalMinutes(entries)), 8)}(${grouped.length} days)`,
  );
  return lines.join("\n");
};

const formatMarkdownDetailed = (
  entries: ReportEntry[],
  projectLabel: string,
  periodLabel: string,
): string => {
  const lines: string[] = [];
  lines.push(`## ${projectLabel} — ${periodLabel}`);
  lines.push("");
  lines.push("| Date | Hours | Note |");
  lines.push("|---|---|---|");
  for (const e of entries) {
    lines.push(`| ${e.date} | ${formatHHMM(e.minutes)} | ${e.note ?? ""} |`);
  }
  lines.push("");
  lines.push(
    `**Total: ${formatHHMM(totalMinutes(entries))}** (${entries.length} entries)`,
  );
  return lines.join("\n");
};

const formatMarkdownDaily = (
  entries: ReportEntry[],
  projectLabel: string,
  periodLabel: string,
): string => {
  const grouped = groupByDay(entries);
  const lines: string[] = [];
  lines.push(`## ${projectLabel} — ${periodLabel}`);
  lines.push("");
  lines.push("| Date | Hours | Notes |");
  lines.push("|---|---|---|");
  for (const g of grouped) {
    lines.push(`| ${g.date} | ${formatHHMM(g.minutes)} | ${g.notes.join("; ")} |`);
  }
  lines.push("");
  lines.push(
    `**Total: ${formatHHMM(totalMinutes(entries))}** (${grouped.length} days)`,
  );
  return lines.join("\n");
};

const formatCsvDetailed = (entries: ReportEntry[]): string => {
  const lines: string[] = ["Date,Hours,Minutes,Note"];
  for (const e of entries) {
    const h = Math.floor(e.minutes / 60);
    const m = e.minutes % 60;
    lines.push(`${e.date},${h},${m},${csvEscape(e.note ?? "")}`);
  }
  return lines.join("\n");
};

const formatCsvDaily = (entries: ReportEntry[]): string => {
  const grouped = groupByDay(entries);
  const lines: string[] = ["Date,Hours,Minutes,Notes"];
  for (const g of grouped) {
    const h = Math.floor(g.minutes / 60);
    const m = g.minutes % 60;
    lines.push(`${g.date},${h},${m},${csvEscape(g.notes.join("; "))}`);
  }
  return lines.join("\n");
};

export const formatReport = (opts: {
  entries: ReportEntry[];
  format: ReportFormat;
  detail: ReportDetail;
  projectLabel: string;
  periodLabel: string;
}): string => {
  const { entries, format, detail, projectLabel, periodLabel } = opts;
  if (format === "text") {
    return detail === "detailed"
      ? formatTextDetailed(entries, projectLabel, periodLabel)
      : formatTextDaily(entries, projectLabel, periodLabel);
  }
  if (format === "markdown") {
    return detail === "detailed"
      ? formatMarkdownDetailed(entries, projectLabel, periodLabel)
      : formatMarkdownDaily(entries, projectLabel, periodLabel);
  }
  return detail === "detailed" ? formatCsvDetailed(entries) : formatCsvDaily(entries);
};
