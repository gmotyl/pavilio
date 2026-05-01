import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Inbox, RotateCcw, Search } from "lucide-react";
import { useArchivedProjects } from "../features/projects/useArchivedProjects";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function ArchivePage() {
  const { archived, restore } = useArchivedProjects();
  const [filter, setFilter] = useState("");

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return archived;
    return archived.filter((p) => p.name.toLowerCase().includes(q));
  }, [archived, filter]);

  return (
    <div className="p-6 max-w-3xl">
      <header className="flex items-center gap-3 mb-6">
        <Inbox size={20} style={{ color: "var(--text-secondary)" }} />
        <h1 className="text-xl font-semibold">Archive</h1>
      </header>

      <div
        className="flex items-center gap-2 px-3 py-2 rounded-md mb-4"
        style={{
          background: "var(--bg-base)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <Search size={14} style={{ color: "var(--text-tertiary)" }} />
        <input
          type="text"
          placeholder="Filter archived projects…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ color: "var(--text-primary)" }}
        />
      </div>

      {visible.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {archived.length === 0
            ? "No archived projects yet."
            : "No matches."}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((p) => (
            <li
              key={p.name}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md"
              style={{
                background: "var(--bg-base)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <Inbox size={14} style={{ color: "var(--text-tertiary)" }} />
              <Link
                to={`/project/${p.name}`}
                className="flex-1 min-w-0 no-underline"
                title={`Open ${p.name}`}
              >
                <div
                  className="text-sm font-medium truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {p.name}
                </div>
                <div
                  className="text-[11px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  Archived {formatDate(p.archivedAt)}
                </div>
              </Link>
              <button
                type="button"
                onClick={() => restore(p.name)}
                className="flex items-center gap-1.5 px-3 py-1 rounded text-[12px]"
                style={{
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-secondary)",
                  background: "transparent",
                }}
              >
                <RotateCcw size={12} />
                <span>Restore</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p
        className="mt-6 text-[11px] text-center"
        style={{ color: "var(--text-muted)" }}
      >
        Archived projects are hidden from navigation. Data is preserved.{" "}
        <Link to="/" style={{ color: "var(--text-secondary)" }}>
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
