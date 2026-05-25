import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useProjectBusyTracker } from "../features/time/useProjectBusyTracker";
import { formatMinutes } from "../features/time/TimeBadge";
import { EntriesList } from "../features/time/EntriesList";
import { ManualEntryForm } from "../features/time/ManualEntryForm";
import { ReportBlock } from "../features/time/ReportBlock";

const sectionLabelClass = "text-xs uppercase tracking-wide";
const sectionLabelStyle = { color: "var(--text-tertiary)" };

export default function ProjectTimePage() {
  const { name } = useParams<{ name: string }>();
  const project = name ?? "";
  const { todayMinutes, resetToday } = useProjectBusyTracker(project);
  const [refreshKey, setRefreshKey] = useState(0);

  const bumpRefresh = (): void => setRefreshKey((k) => k + 1);

  async function handleReset(): Promise<void> {
    if (!window.confirm(`Reset today's time for ${project}?`)) return;
    await resetToday();
    bumpRefresh();
  }

  return (
    <div className="p-6">
      <header className="flex items-center gap-3 mb-6">
        <Link
          to={`/project/${project}`}
          className="text-sm"
          style={{ color: "var(--text-tertiary)" }}
        >
          ← Back to project
        </Link>
        <h1 className="text-2xl capitalize">{project} · Time</h1>
      </header>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>
          Today:{" "}
          <strong style={{ color: "var(--text-primary)" }}>
            {formatMinutes(todayMinutes) || "0m"}
          </strong>
        </span>
        <button
          type="button"
          onClick={handleReset}
          data-testid="time-reset-today"
          className="text-sm bg-transparent border-0 cursor-pointer p-0"
          style={{ color: "var(--text-tertiary)" }}
        >
          Reset today
        </button>
      </div>

      <section className="mb-6">
        <h2 className={sectionLabelClass} style={sectionLabelStyle}>
          Add entry
        </h2>
        <div className="mt-2">
          <ManualEntryForm project={project} onSaved={bumpRefresh} />
        </div>
      </section>

      <section className="mb-6">
        <h2 className={sectionLabelClass} style={sectionLabelStyle}>
          Entries (today)
        </h2>
        <div className="mt-2">
          <EntriesList project={project} refreshKey={refreshKey} />
        </div>
      </section>

      <section className="mb-6">
        <h2 className={sectionLabelClass} style={sectionLabelStyle}>
          Report
        </h2>
        <div className="mt-2">
          <ReportBlock project={project} projectLabel={project} />
        </div>
      </section>
    </div>
  );
}
