import { useState, useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Inbox, RotateCcw, Search } from "lucide-react";
import { useArchivedProjects, type ArchivedProject } from "./useArchivedProjects";
import { groupArchived } from "./archiveGroups";
import { ProjectMark } from "./ProjectMark";

type KindFilter = "all" | "project" | "research";

const KIND_OPTIONS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "project", label: "Projects" },
  { id: "research", label: "Research" },
];

/** Research and the knowledge project share the Research side of the switch. */
function isResearch(p: ArchivedProject): boolean {
  return p.kind === "research" || p.kind === "knowledge";
}

/** `YYYY-MM-DD` in local time, or the raw value when it does not parse. */
function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Wraps every case-insensitive occurrence of `query` (already lower-cased) in a `<mark>`. */
function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark
        key={at}
        data-testid="archive-hit"
        style={{
          background: "color-mix(in srgb, var(--accent) 28%, transparent)",
          color: "var(--text-primary)",
          borderRadius: 2,
        }}
      >
        {text.slice(at, at + query.length)}
      </mark>,
    );
    from = at + query.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

/** Research and knowledge open on their wiki; a plain project on its overview. */
function rowHref(p: ArchivedProject): string {
  const base = `/project/${encodeURIComponent(p.name)}`;
  return isResearch(p) ? `${base}/wiki` : base;
}

export function ArchivePage() {
  const { archived, restore, error } = useArchivedProjects();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");

  const counts = useMemo(() => {
    const research = archived.filter(isResearch).length;
    return { all: archived.length, project: archived.length - research, research };
  }, [archived]);

  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const visible = archived.filter((p) => {
      if (kind === "research" && !isResearch(p)) return false;
      if (kind === "project" && isResearch(p)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
      );
    });
    return groupArchived(visible, new Date());
  }, [archived, kind, q]);

  return (
    <div className="p-6 max-w-3xl">
      <header className="flex flex-wrap items-center gap-3 mb-6">
        <Inbox size={20} style={{ color: "var(--text-secondary)" }} />
        <h1 className="text-xl font-semibold">Archive</h1>
        <div
          role="group"
          aria-label="Kind"
          className="ml-auto flex items-center rounded-md p-0.5"
          style={{ border: "1px solid var(--border-subtle)" }}
        >
          {KIND_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              data-testid={`archive-kind-${o.id}`}
              onClick={() => setKind(o.id)}
              // Colour alone does not reach assistive tech; this does.
              aria-pressed={kind === o.id}
              className="px-2.5 py-0.5 rounded text-[12px]"
              style={{
                color: kind === o.id ? "var(--text-primary)" : "var(--text-secondary)",
                background: kind === o.id ? "var(--bg-hover)" : "transparent",
              }}
            >
              {o.label} <b>{counts[o.id]}</b>
            </button>
          ))}
        </div>
      </header>

      {error && (
        <p
          data-testid="archive-error"
          className="mb-4 text-sm px-3 py-2 rounded-md"
          style={{
            color: "var(--danger, #f87171)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          {error}
        </p>
      )}

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
          placeholder="Search archived names and descriptions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ color: "var(--text-primary)" }}
        />
      </div>

      {groups.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {archived.length === 0 ? "No archived projects yet." : "No matches."}
        </p>
      ) : (
        groups.map((group) => (
          <section
            key={group.label}
            data-testid="archive-group"
            data-label={group.label}
            className="mb-5"
          >
            <h2
              className="text-[11px] font-semibold uppercase tracking-wide mb-2"
              style={{ color: "var(--text-tertiary)" }}
            >
              {group.label}
            </h2>
            <ul className="space-y-2">
              {group.rows.map((p) => (
                <li
                  key={p.name}
                  data-testid={`archive-row-${p.name}`}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-md"
                  style={{
                    background: "var(--bg-base)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  {/* The row body is the link; Restore stays a sibling so it never navigates. */}
                  <Link
                    to={rowHref(p)}
                    data-testid={`archive-link-${p.name}`}
                    className="flex flex-1 min-w-0 items-start gap-3"
                    style={{ color: "inherit", textDecoration: "none" }}
                  >
                    <ProjectMark project={p.name} kind={p.kind} size={20} />
                    {/* Wraps at phone width: the description drops under the name. */}
                    <div className="flex flex-1 min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span
                        className="text-sm font-medium"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {highlight(p.name, q)}
                      </span>
                      {p.description && (
                        <span
                          data-testid="archive-description"
                          className="text-[12px] min-w-0"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {highlight(p.description, q)}
                        </span>
                      )}
                      <span
                        className="text-[11px] whitespace-nowrap"
                        style={{ color: "var(--text-muted)" }}
                      >
                        archived {formatDay(p.archivedAt)}
                      </span>
                    </div>
                  </Link>
                  <button
                    type="button"
                    data-testid={`archive-restore-${p.name}`}
                    onClick={() => restore(p.name)}
                    className="flex flex-none items-center gap-1.5 px-3 py-1 rounded text-[12px]"
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
          </section>
        ))
      )}

      <p
        className="mt-6 text-[11px] text-center"
        style={{ color: "var(--text-muted)" }}
      >
        Archived projects live in projects/archived/ and are hidden from navigation. Data is preserved.{" "}
        <Link to="/" style={{ color: "var(--text-secondary)" }}>
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
