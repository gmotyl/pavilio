import { useEffect, useMemo, useState } from "react";
import {
  formatReport,
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
  period: "last-month",
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
  if (period === "today") return range.from;
  if (period === "this-week" || period === "last-week") return `Week of ${range.from}`;
  // this-month / last-month -> YYYY-MM
  return `Month ${range.from.slice(0, 7)}`;
}

export function ReportBlock({
  project,
  projectLabel,
}: {
  project: string;
  projectLabel: string;
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
  }, [project, range.from, range.to]);

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
    <section className="space-y-3" aria-label="Time report">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label>
          Period{" "}
          <select
            data-testid="time-report-period"
            value={periodValue}
            onChange={(e) =>
              setPrefs((p) => ({ ...p, period: e.target.value as NamedPeriod }))
            }
          >
            <option value="today">Today</option>
            <option value="this-week">This week</option>
            <option value="last-week">Last week</option>
            <option value="this-month">This month</option>
            <option value="last-month">Last month</option>
          </select>
        </label>
        <label>
          Format{" "}
          <select
            data-testid="time-report-format"
            value={prefs.format}
            onChange={(e) =>
              setPrefs((p) => ({ ...p, format: e.target.value as ReportFormat }))
            }
          >
            <option value="text">Plain text</option>
            <option value="markdown">Markdown</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <label>
          Detail{" "}
          <select
            data-testid="time-report-detail"
            value={prefs.detail}
            onChange={(e) =>
              setPrefs((p) => ({ ...p, detail: e.target.value as ReportDetail }))
            }
          >
            <option value="detailed">Detailed</option>
            <option value="daily">Daily summary</option>
          </select>
        </label>
        <button type="button" data-testid="time-report-copy" onClick={onCopy}>
          Copy
        </button>
        <button type="button" data-testid="time-report-csv" onClick={onDownloadCSV}>
          Download .csv
        </button>
      </div>
      <pre
        className="text-xs p-3 rounded overflow-auto"
        style={{
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          maxHeight: "24rem",
        }}
      >
        {formatted}
      </pre>
    </section>
  );
}
