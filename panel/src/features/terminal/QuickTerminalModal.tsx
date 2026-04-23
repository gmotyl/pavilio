import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, X } from "lucide-react";
import TerminalView from "./TerminalView";
import { TerminalActivityLed } from "./TerminalActivityLed";
import type { SessionMeta } from "./useTerminalSessions";
import { dispatchTerminalFocus } from "./useTerminalSessions";

function matchProjectFromPath(
  pathname: string,
): { name: string; section: string | null } | null {
  const m = /^\/project\/([^/]+)(?:\/([^/]+))?/.exec(pathname);
  if (!m) return null;
  return { name: decodeURIComponent(m[1]), section: m[2] ?? null };
}

function readProjectOrder(project: string): string[] {
  try {
    const raw = localStorage.getItem(`panel-terminal-order-${project}`);
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    // ignore
  }
  return [];
}

function readLastFocus(project: string): string | null {
  try {
    return localStorage.getItem(`panel-terminal-focus-${project}`);
  } catch {
    return null;
  }
}

function writeLastFocus(project: string, id: string): void {
  try {
    localStorage.setItem(`panel-terminal-focus-${project}`, id);
  } catch {
    // ignore
  }
}

/** Order the subset of `sessions` belonging to `project` using the saved order. */
export function orderProjectSessions(
  sessions: SessionMeta[],
  project: string,
): SessionMeta[] {
  const mine = sessions.filter((s) => s.project === project);
  if (mine.length === 0) return [];
  const order = readProjectOrder(project);
  if (order.length === 0) return mine;
  const index = new Map(order.map((id, i) => [id, i]));
  return [...mine].sort(
    (a, b) =>
      (index.get(a.id) ?? mine.length) - (index.get(b.id) ?? mine.length),
  );
}

export function pickFirstSessionId(
  sessions: SessionMeta[],
  project: string,
): string | null {
  const ordered = orderProjectSessions(sessions, project);
  return ordered[0]?.id ?? null;
}

/** Prefer the last-selected terminal for this project; fall back to first. */
export function pickInitialSessionId(
  sessions: SessionMeta[],
  project: string,
): string | null {
  const mine = sessions.filter((s) => s.project === project);
  if (mine.length === 0) return null;
  const last = readLastFocus(project);
  if (last && mine.some((s) => s.id === last)) return last;
  return pickFirstSessionId(sessions, project);
}

export default function QuickTerminalModal() {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const match = matchProjectFromPath(location.pathname);
  const project = match?.name ?? null;
  const onItermRoute = match?.section === "iterm";

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/terminal/sessions");
      if (res.ok) {
        const data: SessionMeta[] = await res.json();
        setSessions(data);
      } else {
        setSessions([]);
      }
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    fetchSessions();
  }, [open, fetchSessions]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        if (!project || onItermRoute) {
          setOpen(false);
          return;
        }
        setOpen((p) => !p);
      }
      // Do NOT intercept Escape — xterm needs it so Claude (or any TUI)
      // can be cancelled from inside the modal.
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [project, onItermRoute]);

  useEffect(() => {
    if (!open) return;
    if (!project || onItermRoute) setOpen(false);
  }, [project, onItermRoute, open]);

  // Reset internal selection every time the modal reopens so the newly
  // computed "last selected / first" takes over cleanly.
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setMenuOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !project || !sessions || selectedId) return;
    const initial = pickInitialSessionId(sessions, project);
    if (initial) setSelectedId(initial);
  }, [open, project, sessions, selectedId]);

  // Broadcast focus so the side rail highlight stays in sync.
  useEffect(() => {
    if (open && project && selectedId) {
      dispatchTerminalFocus(project, selectedId);
    }
  }, [open, project, selectedId]);

  // Close the dropdown when clicking outside of it (inside the modal).
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const selectSession = useCallback(
    (id: string) => {
      if (!project) return;
      setSelectedId(id);
      writeLastFocus(project, id);
      setMenuOpen(false);
    },
    [project],
  );

  const openDotTarget = useCallback(
    (s: SessionMeta) => {
      if (!project) return;
      if (s.project === project) {
        selectSession(s.id);
        return;
      }
      // Different project → bring the user to that project's iTerm tab,
      // with the clicked session focused. Close the modal so the
      // underlying TerminalView can claim the xterm DOM holder.
      writeLastFocus(s.project, s.id);
      setOpen(false);
      navigate(`/project/${encodeURIComponent(s.project)}/iterm`);
      // Dispatch after navigation; the listener is mounted on window.
      setTimeout(() => dispatchTerminalFocus(s.project, s.id), 0);
    },
    [project, selectSession, navigate],
  );

  const currentProjectSessions = useMemo(
    () => (project && sessions ? orderProjectSessions(sessions, project) : []),
    [sessions, project],
  );

  // All sessions for the dot row — group by project (current first), then
  // by saved order within the project.
  const allSessionsOrdered = useMemo(() => {
    if (!sessions || !project) return [];
    const byProject = new Map<string, SessionMeta[]>();
    for (const s of sessions) {
      const list = byProject.get(s.project) ?? [];
      list.push(s);
      byProject.set(s.project, list);
    }
    const projectsOrdered = [
      project,
      ...[...byProject.keys()].filter((p) => p !== project).sort(),
    ];
    const out: SessionMeta[] = [];
    for (const p of projectsOrdered) {
      const mine = byProject.get(p);
      if (!mine) continue;
      out.push(...orderProjectSessions(mine, p));
    }
    return out;
  }, [sessions, project]);

  const selectedSession = useMemo(
    () =>
      sessions && selectedId
        ? sessions.find((s) => s.id === selectedId) ?? null
        : null,
    [sessions, selectedId],
  );

  if (!open || !project) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quick terminal"
      data-testid="quick-terminal-modal"
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
      onClick={() => setOpen(false)}
    >
      <div
        className="rounded-xl shadow-2xl overflow-hidden flex flex-col"
        style={{
          width: "80vw",
          height: "90vh",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-3 px-3 py-2 shrink-0"
          style={{
            borderBottom: "1px solid var(--border-subtle)",
            color: "var(--text-tertiary)",
          }}
        >
          {/* Project-scoped terminal dropdown (left) */}
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              data-testid="quick-terminal-project-dropdown"
              onClick={() => setMenuOpen((p) => !p)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-mono transition-colors"
              style={{
                color: "var(--text-primary)",
                background: menuOpen ? "var(--bg-active)" : "transparent",
                border: "1px solid var(--border-subtle)",
              }}
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
            >
              <span>{project}</span>
              {selectedSession && (
                <span
                  className="text-[11px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  / {selectedSession.name}
                </span>
              )}
              <ChevronDown size={12} />
            </button>
            {menuOpen && (
              <div
                role="listbox"
                data-testid="quick-terminal-project-menu"
                className="absolute left-0 top-full mt-1 min-w-[220px] rounded-md shadow-lg z-10 py-1"
                style={{
                  background: "var(--bg-elevated, var(--bg-surface))",
                  border: "1px solid var(--border-default)",
                }}
              >
                {currentProjectSessions.length === 0 ? (
                  <div
                    className="px-3 py-2 text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    No terminals in {project}
                  </div>
                ) : (
                  currentProjectSessions.map((s) => {
                    const active = s.id === selectedId;
                    return (
                      <button
                        key={s.id}
                        role="option"
                        aria-selected={active}
                        type="button"
                        onClick={() => selectSession(s.id)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm font-mono transition-colors"
                        style={{
                          background: active
                            ? "var(--bg-active)"
                            : "transparent",
                          color: active
                            ? "var(--text-primary)"
                            : "var(--text-secondary)",
                        }}
                      >
                        <TerminalActivityLed sessionId={s.id} />
                        <span className="truncate">{s.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Global status dots for every terminal across every project */}
          <div
            className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto scrollbar-none"
            data-testid="quick-terminal-global-dots"
          >
            {allSessionsOrdered.map((s) => {
              const isCurrentProject = s.project === project;
              const isSelected = s.id === selectedId && isCurrentProject;
              return (
                <button
                  key={s.id}
                  type="button"
                  data-testid={`quick-terminal-dot-${s.id}`}
                  onClick={() => openDotTarget(s)}
                  title={
                    isCurrentProject
                      ? s.name
                      : `${s.project} / ${s.name}`
                  }
                  className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors"
                  style={{
                    background: isSelected
                      ? "var(--bg-active)"
                      : "transparent",
                    border: isCurrentProject
                      ? "1px solid var(--border-subtle)"
                      : "1px dashed var(--border-subtle)",
                    opacity: isCurrentProject ? 1 : 0.75,
                  }}
                >
                  <TerminalActivityLed
                    sessionId={s.id}
                    title={
                      isCurrentProject
                        ? s.name
                        : `${s.project} / ${s.name}`
                    }
                  />
                </button>
              );
            })}
          </div>

          <span
            className="text-[11px] shrink-0"
            style={{ color: "var(--text-muted)" }}
          >
            ⌘O to close
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-white/5 transition-colors shrink-0"
            style={{ color: "var(--text-tertiary)" }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 min-h-0" style={{ background: "#1a1b26" }}>
          {loading && !selectedId ? (
            <div
              className="h-full flex items-center justify-center text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              Loading sessions…
            </div>
          ) : selectedId ? (
            <TerminalView key={selectedId} sessionId={selectedId} focused />
          ) : (
            <div
              className="h-full flex items-center justify-center text-sm px-6 text-center"
              style={{ color: "var(--text-muted)" }}
            >
              No terminal in this project — open the iTerm tab to create one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
