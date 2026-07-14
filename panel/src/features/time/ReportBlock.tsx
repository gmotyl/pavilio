import { useEffect, useMemo, useState } from "react";
import {
  formatReport,
  formatHHMM,
  ReportEntry,
  ReportFormat,
  ReportDetail,
} from "./reportFormatters";
import { rangeForPeriod, Period, DateRange } from "./periodRange";

type NamedPeriod = Exclude<Period, object>;

type Prefs = {
  period: Period;
  format: ReportFormat;
  detail: ReportDetail;
};

const lsKey = (project: string) => `pavilio.time.report.${project}`;

const DEFAULT_PREFS: Prefs = {
  period: "this-week",
  format: "text",
  detail: "detailed",
};

function loadPrefs(project: string): Prefs {
  try {
    const raw = localStorage.getItem(lsKey(project));
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(project: string, p: Prefs): void {
  try {
    localStorage.setItem(lsKey(project), JSON.stringify(p));
  } catch {
    // localStorage unavailable; ignore
  }
}

function periodLabel(period: Period, range: DateRange): string {
  if (typeof period === "object") return `${range.from} – ${range.to}`;
  if (period === "today" || period === "yesterday") return range.from;
  if (period === "this-week" || period === "last-week") return `Week of ${range.from}`;
  if (period === "this-year" || period === "last-year") return range.from.slice(0, 4);
  return `Month ${range.from.slice(0, 7)}`;
}

const fieldLabelClass = "text-[10px] tracking-[0.15em] uppercase mb-1 block";
const fieldLabelStyle = { color: "var(--text-tertiary)" } as const;

const underlineSelectClass =
  "border-0 border-b bg-transparent px-0 py-2 text-sm outline-none transition-colors focus:border-[color:var(--accent)] cursor-pointer";
const underlineSelectStyle = {
  borderBottomColor: "var(--border-subtle)",
  color: "var(--text-primary)",
} as const;

// `colorScheme: dark` renders the native date picker's calendar glyph legibly
// on the warm-dark surface (otherwise a dark glyph on a dark background).
const dateInputStyle = { ...underlineSelectStyle, colorScheme: "dark" } as const;

const textLinkClass =
  "text-sm hover:underline bg-transparent border-0 cursor-pointer p-0";

export function ReportBlock({
  project,
  projectLabel,
  refreshKey,
}: {
  project: string;
  projectLabel: string;
  refreshKey?: number;
}) {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(project));
  const [entries, setEntries] = useState<ReportEntry[]>([]);
  const range = useMemo(() => rangeForPeriod(prefs.period, new Date()), [prefs.period]);

  useEffect(() => {
    savePrefs(project, prefs);
  }, [project, prefs]);

  useEffect(() => {
    const url = `/api/time/range?project=${encodeURIComponent(project)}&from=${range.from}&to=${range.to}`;
    let cancelled = false;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { entries?: ReportEntry[] }) => {
        if (!cancelled) setEntries(data.entries ?? []);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [project, range.from, range.to, refreshKey]);

  const label = periodLabel(prefs.period, range);

  const formatted = useMemo(
    () =>
      formatReport({
        entries,
        format: prefs.format,
        detail: prefs.detail,
        projectLabel,
        periodLabel: label,
      }),
    [entries, prefs.format, prefs.detail, projectLabel, label],
  );

  const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatted);
    } catch {
      // clipboard unavailable; ignore
    }
  };

  const onDownloadCSV = () => {
    const csv = formatReport({
      entries,
      format: "csv",
      detail: prefs.detail,
      projectLabel,
      periodLabel: label,
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project}-time-${range.from}_${range.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const periodValue: string = typeof prefs.period === "string" ? prefs.period : "custom";

  return (
    <section className="space-y-4" aria-label="Time report">
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <label htmlFor="report-period" className={fieldLabelClass} style={fieldLabelStyle}>
            Period
          </label>
          <select
            id="report-period"
            data-testid="time-report-period"
            value={periodValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") {
                setPrefs((p) => ({ ...p, period: { from: range.from, to: range.to } }));
              } else {
                setPrefs((p) => ({ ...p, period: v as NamedPeriod }));
              }
            }}
            className={underlineSelectClass}
            style={underlineSelectStyle}
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="this-week">This week</option>
            <option value="last-week">Last week</option>
            <option value="this-month">This month</option>
            <option value="last-month">Last month</option>
            <option value="this-year">This year</option>
            <option value="last-year">Last year</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div>
          <label htmlFor="report-from" className={fieldLabelClass} style={fieldLabelStyle}>
            From
          </label>
          <input
            id="report-from"
            type="date"
            data-testid="time-report-from"
            value={range.from}
            onChange={(e) =>
              setPrefs((p) => ({ ...p, period: { from: e.target.value, to: range.to } }))
            }
            className={underlineSelectClass}
            style={dateInputStyle}
          />
        </div>
        <div>
          <label htmlFor="report-to" className={fieldLabelClass} style={fieldLabelStyle}>
            To
          </label>
          <input
            id="report-to"
            type="date"
            data-testid="time-report-to"
            value={range.to}
            onChange={(e) =>
              setPrefs((p) => ({ ...p, period: { from: range.from, to: e.target.value } }))
            }
            className={underlineSelectClass}
            style={dateInputStyle}
          />
        </div>
        <div>
          <label htmlFor="report-format" className={fieldLabelClass} style={fieldLabelStyle}>
            Format
          </label>
          <select
            id="report-format"
            data-testid="time-report-format"
            value={prefs.format}
            onChange={(e) =>
              setPrefs((p) => ({ ...p, format: e.target.value as ReportFormat }))
            }
            className={underlineSelectClass}
            style={underlineSelectStyle}
          >
            <option value="text">Plain text</option>
            <option value="markdown">Markdown</option>
            <option value="csv">CSV</option>
          </select>
        </div>
        <div>
          <label htmlFor="report-detail" className={fieldLabelClass} style={fieldLabelStyle}>
            Detail
          </label>
          <select
            id="report-detail"
            data-testid="time-report-detail"
            value={prefs.detail}
            onChange={(e) =>
              setPrefs((p) => ({ ...p, detail: e.target.value as ReportDetail }))
            }
            className={underlineSelectClass}
            style={underlineSelectStyle}
          >
            <option value="detailed">Detailed</option>
            <option value="daily">Daily summary</option>
          </select>
        </div>
        <div className="flex items-center gap-4 pb-2">
          <button
            type="button"
            data-testid="time-report-copy"
            onClick={onCopy}
            className={textLinkClass}
            style={{ color: "var(--accent)" }}
          >
            Copy
          </button>
          <button
            type="button"
            data-testid="time-report-csv"
            onClick={onDownloadCSV}
            className={textLinkClass}
            style={{ color: "var(--accent)" }}
          >
            Download .csv
          </button>
        </div>
      </div>

      <div
        className="text-right text-[11px]"
        style={{ color: "var(--text-tertiary)" }}
      >
        {entries.length} {entries.length === 1 ? "entry" : "entries"} ·{" "}
        {formatHHMM(totalMinutes)} · {label}
      </div>

      <pre
        className="font-mono text-[12px] leading-[1.65] p-5 overflow-auto"
        style={{
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "2px",
          maxHeight: "28rem",
        }}
      >
        {entries.length === 0
          ? `No entries in ${label}.\nTry a different period above (e.g. Today or This week).`
          : formatted}
      </pre>
    </section>
  );
}
