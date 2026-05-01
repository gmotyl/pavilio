import { useEffect } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import type { SessionMeta, CreateSessionOpts } from "./useTerminalSessions";
import { TerminalActivityLed } from "./TerminalActivityLed";

interface Props {
  sessions: SessionMeta[];
  focusedId: string | null;
  currentProject: string;
  onFocus: (sessionId: string, project: string) => void;
  onCreate: (opts: CreateSessionOpts) => void;
  onClose: () => void;
}

/**
 * Option D companion — the drawer half. Slides in from the left over the
 * terminal and shows every session grouped by project, plus a "New" picker
 * for creating a shell in any project. Designed for mobile (also works fine
 * on narrow desktop if invoked there).
 */
export function TerminalSpineDrawer({
  sessions,
  focusedId,
  currentProject,
  onFocus,
  onCreate,
  onClose,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Group by project, currentProject first
  const byProject = new Map<string, SessionMeta[]>();
  for (const s of sessions) {
    const list = byProject.get(s.project) || [];
    list.push(s);
    byProject.set(s.project, list);
  }
  const projectEntries = Array.from(byProject.entries()).sort(([a], [b]) => {
    if (a === currentProject) return -1;
    if (b === currentProject) return 1;
    return a.localeCompare(b);
  });

  return (
    <>
      <div
        className="absolute inset-0 z-30"
        style={{ background: "rgba(0,0,0,0.55)" }}
        onClick={onClose}
      />
      <aside
        className="absolute inset-y-0 left-0 z-40 flex flex-col"
        style={{
          width: "min(78%, 320px)",
          background: "var(--bg-surface)",
          borderRight: "1px solid var(--border-subtle)",
          boxShadow: "8px 0 32px rgba(0,0,0,0.45)",
        }}
      >
        <div
          className="flex items-center justify-between px-3 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <Link to="/terminals" title="Open all terminals" className="block hover:opacity-80">
            <div
              className="text-[9px] tracking-[0.3em] uppercase"
              style={{ color: "var(--text-tertiary)" }}
            >
              Terminals
            </div>
            <div
              className="text-[13px] font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {sessions.length} open
            </div>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
          {projectEntries.length === 0 && (
            <div
              className="px-3 py-4 text-[12px] text-center"
              style={{ color: "var(--text-muted)" }}
            >
              No terminals yet.
            </div>
          )}

          {projectEntries.map(([project, list]) => {
            const isCurrent = project === currentProject;
            return (
              <div key={project}>
                <div
                  className="px-2 mb-1 flex items-center justify-between text-[9.5px] tracking-[0.22em] uppercase font-mono"
                  style={{
                    color: isCurrent
                      ? "var(--text-secondary)"
                      : "var(--text-muted)",
                  }}
                >
                  <span className="truncate">{project}</span>
                  {isCurrent && (
                    <span style={{ color: "var(--accent, #f0c674)" }}>
                      here
                    </span>
                  )}
                </div>
                <ul className="space-y-0.5">
                  {list.map((s) => {
                    const active = s.id === focusedId && isCurrent;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => onFocus(s.id, s.project)}
                          className="flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-md transition-colors"
                          style={{
                            background: active
                              ? "var(--bg-elevated, var(--bg-active))"
                              : "transparent",
                            color: active
                              ? "var(--text-primary)"
                              : "var(--text-secondary)",
                            borderLeft: s.color
                              ? `2px solid ${s.color}`
                              : "2px solid transparent",
                            paddingLeft: s.color ? "8px" : undefined,
                          }}
                        >
                          <TerminalActivityLed sessionId={s.id} />
                          <span className="text-[12.5px] font-mono truncate flex-1">
                            {s.name}
                          </span>
                          {active && (
                            <span
                              className="text-[9px] tracking-widest"
                              style={{ color: "var(--accent, #f0c674)" }}
                            >
                              ON
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

      </aside>
    </>
  );
}

export default TerminalSpineDrawer;
