import { useEffect, useState } from "react";
import { EntryRow, type ManualEntry } from "./EntryRow";

type TimeEntry =
  | { id: string; type: "manual"; date: string; minutes: number; note?: string; createdAt?: string }
  | { id: string; type: "busy_block"; date: string; start: string; end: string; minutes: number }
  | { id: string; type: "reset"; date: string; ts: string };

type VisibleEntry = ManualEntry;

/**
 * EntriesList renders only the manual entries (busy_blocks contribute to the
 * page-level hero totals, not this list). The hero in ProjectTimePage owns
 * the "Today" totals display now, so this component intentionally renders no
 * totals header.
 */
export function EntriesList({
  project,
  refreshKey,
}: {
  project: string;
  refreshKey?: number;
}) {
  const [entries, setEntries] = useState<VisibleEntry[]>([]);
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

  if (loading)
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading…
      </p>
    );
  if (error)
    return (
      <p
        role="alert"
        className="text-sm"
        style={{ color: "var(--text-error, #f88)" }}
      >
        {error}
      </p>
    );

  if (entries.length === 0) {
    return (
      <p
        className="text-sm italic text-center py-4"
        style={{ color: "var(--text-muted)" }}
      >
        No entries yet.
      </p>
    );
  }

  return (
    <ul className="space-y-0">
      {entries.map((e) => (
        <EntryRow
          key={e.id}
          project={project}
          entry={e}
          onChange={() => setLocalRefresh((n) => n + 1)}
        />
      ))}
    </ul>
  );
}
