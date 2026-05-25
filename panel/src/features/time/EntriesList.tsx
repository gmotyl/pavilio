import { useEffect, useState } from "react";
import { formatMinutes } from "./TimeBadge";

type TimeEntry =
  | { id: string; type: "manual"; date: string; minutes: number; note?: string; createdAt?: string }
  | { id: string; type: "busy_block"; date: string; start: string; end: string; minutes: number }
  | { id: string; type: "reset"; date: string; ts: string };

type VisibleEntry = Extract<TimeEntry, { type: "manual" }>;

type Totals = { busyMinutes: number; manualMinutes: number };

export function EntriesList({ project, refreshKey }: { project: string; refreshKey?: number }) {
  const [entries, setEntries] = useState<VisibleEntry[]>([]);
  const [totals, setTotals] = useState<Totals>({ busyMinutes: 0, manualMinutes: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/time/today?project=${encodeURIComponent(project)}`)
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        const visible = (data.entries ?? []).filter(
          (e: TimeEntry): e is VisibleEntry => e.type === "manual"
        );
        setEntries(visible);
        setTotals(data.totals ?? { busyMinutes: 0, manualMinutes: 0 });
        setError(null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project, refreshKey]);

  if (loading) return <p style={{ color: "var(--text-muted)" }}>Loading…</p>;
  if (error)
    return (
      <p role="alert" style={{ color: "var(--text-error, #f88)" }}>
        {error}
      </p>
    );

  return (
    <div className="space-y-4">
      <div className="flex gap-6 text-sm" style={{ color: "var(--text-tertiary)" }}>
        <span>
          Manual:{" "}
          <strong style={{ color: "var(--text-primary)" }}>
            {formatMinutes(totals.manualMinutes) || "0m"}
          </strong>
        </span>
        <span>
          Auto-tracked:{" "}
          <strong style={{ color: "var(--text-primary)" }}>
            {formatMinutes(totals.busyMinutes) || "0m"}
          </strong>
        </span>
      </div>
      {entries.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>No entries yet.</p>
      ) : (
        <ul className="space-y-1">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-3 text-sm">
              <span style={{ color: "var(--text-primary)" }}>{formatMinutes(e.minutes)}</span>
              <span style={{ color: "var(--text-tertiary)" }}>{e.note ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
