import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useProjectBusyTracker } from "../features/time/useProjectBusyTracker";
import { formatHHMM } from "../features/time/reportFormatters";
import { EntriesList } from "../features/time/EntriesList";
import { ManualEntryForm } from "../features/time/ManualEntryForm";
import { ReportBlock } from "../features/time/ReportBlock";

const overlineClass = "text-[10px] tracking-[0.2em] uppercase";
const overlineStyle = { color: "var(--text-tertiary)" } as const;

const sectionRuleStyle = { borderTopColor: "var(--border-subtle)" } as const;

function todayLabel(): string {
  // e.g. "26 May 2026"
  const now = new Date();
  return now.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function ProjectTimePage() {
  const { name } = useParams<{ name: string }>();
  const project = name ?? "";
  const { todayMinutes, resetToday } = useProjectBusyTracker(project);
  const [refreshKey, setRefreshKey] = useState(0);
  const [manualToday, setManualToday] = useState(0);

  const bumpRefresh = (): void => setRefreshKey((k) => k + 1);

  // Pull today's manual total from the same endpoint EntriesList uses.
  // Kept here (not lifted out of EntriesList) because EntriesList already
  // owns the entry rows; we just need the totals for the hero.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/time/today?project=${encodeURIComponent(project)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((data) => {
        if (cancelled) return;
        const m = data?.totals?.manualMinutes;
        setManualToday(typeof m === "number" ? m : 0);
      })
      .catch(() => {
        if (!cancelled) setManualToday(0);
      });
    return () => {
      cancelled = true;
    };
  }, [project, refreshKey]);

  async function handleReset(): Promise<void> {
    if (!window.confirm(`Reset today's time for ${project}?`)) return;
    await resetToday();
    bumpRefresh();
  }

  return (
    <div className="p-6">
      <div className="max-w-[760px] mx-auto space-y-16">
        {/* Header — modest, lets the hero numbers dominate */}
        <header className="flex items-center gap-4 pt-2">
          <Link
            to={`/project/${project}`}
            className="text-sm hover:underline"
            style={{ color: "var(--text-tertiary)" }}
          >
            ← Back to project
          </Link>
          <h1
            className="text-base capitalize font-normal"
            style={{ color: "var(--text-secondary)" }}
          >
            {project} · Time
          </h1>
        </header>

        {/* Hero — Today's totals as big monospace numerals */}
        <section>
          <div className="flex items-baseline justify-between mb-6">
            <div className={overlineClass} style={overlineStyle}>
              Today · {todayLabel()}
            </div>
            <button
              type="button"
              onClick={handleReset}
              data-testid="time-reset-today"
              className="text-sm hover:underline bg-transparent border-0 cursor-pointer p-0"
              style={{ color: "var(--text-tertiary)" }}
            >
              Reset today
            </button>
          </div>

          <div className="grid grid-cols-2 gap-12">
            <div>
              <div
                className="font-mono text-5xl"
                style={{ fontWeight: 200, color: "var(--text-primary)" }}
              >
                {formatHHMM(manualToday)}
              </div>
              <div
                className="border-t mt-3"
                style={{
                  ...sectionRuleStyle,
                  width: "36px",
                }}
              />
              <div
                className="text-[10px] tracking-[0.2em] uppercase mt-2"
                style={{ color: "var(--text-tertiary)" }}
              >
                Manual
              </div>
            </div>
            <div>
              <div
                className="font-mono text-5xl"
                style={{ fontWeight: 200, color: "var(--text-primary)" }}
              >
                {formatHHMM(todayMinutes)}
              </div>
              <div
                className="border-t mt-3"
                style={{
                  ...sectionRuleStyle,
                  width: "36px",
                }}
              />
              <div
                className="text-[10px] tracking-[0.2em] uppercase mt-2"
                style={{ color: "var(--text-tertiary)" }}
              >
                Auto-tracked
              </div>
            </div>
          </div>
        </section>

        {/* Add entry */}
        <section className="space-y-4">
          <div className="border-t pt-8" style={sectionRuleStyle}>
            <div className={overlineClass} style={overlineStyle}>
              Add entry
            </div>
          </div>
          <div className="pt-2">
            <ManualEntryForm project={project} onSaved={bumpRefresh} />
          </div>
        </section>

        {/* Entries */}
        <section className="space-y-4">
          <div className="border-t pt-8" style={sectionRuleStyle}>
            <div className={overlineClass} style={overlineStyle}>
              Entries
            </div>
          </div>
          <div className="pt-2">
            <EntriesList
              project={project}
              refreshKey={refreshKey}
            />
          </div>
        </section>

        {/* Report */}
        <section className="space-y-4">
          <div className="border-t pt-8" style={sectionRuleStyle}>
            <div className={overlineClass} style={overlineStyle}>
              Report
            </div>
          </div>
          <div className="pt-2">
            <ReportBlock
              project={project}
              projectLabel={project}
              refreshKey={refreshKey}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
