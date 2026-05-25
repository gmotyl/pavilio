import { useEffect, useState } from "react";
import { formatMinutes } from "./TimeBadge";
import { EntryRow, type ManualEntry } from "./EntryRow";

type TimeEntry =
  | { id: string; type: "manual"; date: string; minutes: number; note?: string; createdAt?: string }
  | { id: string; type: "busy_block"; date: string; start: string; end: string; minutes: number }
  | { id: string; type: "reset"; date: string; ts: string };

type VisibleEntry = ManualEntry;

type Totals = { busyMinutes: number; manualMinutes: number };

export function EntriesList({ project, refreshKey }: { project: string; refreshKey?: number }) {
  const [entries, setEntries] = useState<VisibleEntry[]>([]);
  const [totals, setTotals] = useState<Totals>({ busyMinutes: 0, manualMinutes: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

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
  }, [project, refreshKey, localRefresh]);

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
            <EntryRow
              key={e.id}
              project={project}
              entry={e}
              onChange={() => setLocalRefresh((n) => n + 1)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
