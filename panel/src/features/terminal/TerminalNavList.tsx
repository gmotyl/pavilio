import { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation, Link } from "react-router-dom";
import { Terminal as TerminalIcon, Plus } from "lucide-react";
import { useAllTerminalSessions } from "./useAllTerminalSessions";
import type { SessionMeta } from "./useTerminalSessions";
import {
  dispatchTerminalFocus,
  TERMINAL_FOCUS_EVENT,
  type TerminalFocusEventDetail,
} from "./useTerminalSessions";
import { TerminalActivityLed } from "./TerminalActivityLed";

function useFocusedSessionId(): string | null {
  const { name: project } = useParams<{ name?: string }>();
  const location = useLocation();
  const inIterm = /\/project\/[^/]+\/iterm/.test(location.pathname);

  const [focusedId, setFocusedId] = useState<string | null>(() => {
    if (!project) return null;
    try {
      return localStorage.getItem(`panel-terminal-focus-${project}`);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent<TerminalFocusEventDetail>).detail;
      setFocusedId(detail.sessionId);
    };
    window.addEventListener(TERMINAL_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(TERMINAL_FOCUS_EVENT, onFocus);
  }, []);

  // Reset focus when navigating away from iterm
  useEffect(() => {
    if (!inIterm) setFocusedId(null);
  }, [inIterm]);

  // Re-seed when project changes
  useEffect(() => {
    if (!project) {
      setFocusedId(null);
      return;
    }
    try {
      setFocusedId(localStorage.getItem(`panel-terminal-focus-${project}`));
    } catch {
      setFocusedId(null);
    }
  }, [project]);

  return inIterm ? focusedId : null;
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-2 px-1">
      <TerminalIcon size={12} style={{ color: "var(--text-tertiary)" }} />
      <h2
        className="text-[11px] font-semibold uppercase tracking-widest flex-1"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </h2>
      {count > 0 && (
        <span
          className="text-[10px] font-mono px-1.5 rounded"
          style={{
            color: "var(--text-tertiary)",
            background: "var(--bg-hover)",
          }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

export function TerminalNavList() {
  const navigate = useNavigate();
  const { name: currentProject } = useParams<{ name?: string }>();
  const { sessions } = useAllTerminalSessions();
  const focusedId = useFocusedSessionId();

  // Group sessions by project
  const byProject = new Map<string, SessionMeta[]>();
  for (const s of sessions) {
    const arr = byProject.get(s.project) || [];
    arr.push(s);
    byProject.set(s.project, arr);
  }
  const projectEntries = Array.from(byProject.entries()).sort(([a], [b]) => {
    if (a === currentProject) return -1;
    if (b === currentProject) return 1;
    return a.localeCompare(b);
  });

  const openSession = (session: SessionMeta) => {
    try {
      localStorage.setItem(
        `panel-terminal-focus-${session.project}`,
        session.id,
      );
    } catch (err) {
      console.warn("[terminal] persist focus from nav list:", err);
    }
    // Tell any live hook for this project to switch focus. Needed when
    // the user is already on this project's iTerm tab (no remount).
    dispatchTerminalFocus(session.project, session.id);
    navigate(`/project/${session.project}/iterm`);
  };

  const openNew = () => {
    if (currentProject) navigate(`/project/${currentProject}/iterm`);
  };

  return (
    <section>
      <Link to="/terminals" title="Open all terminals" className="block hover:opacity-80">
        <SectionHeader label="Terminals" count={sessions.length} />
      </Link>
      {sessions.length === 0 ? (
        <button
          type="button"
          onClick={openNew}
          disabled={!currentProject}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-[12px] transition-colors disabled:opacity-40"
          style={{
            color: "var(--text-muted)",
            background: "var(--bg-surface)",
          }}
          onMouseEnter={(e) => {
            if (currentProject)
              e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "var(--bg-surface)")
          }
          title={
            currentProject
              ? "Open iTerm tab to create a terminal"
              : "Select a project first"
          }
        >
          <Plus size={12} />
          <span>New terminal</span>
        </button>
      ) : (
        <ul className="space-y-2">
          {projectEntries.map(([project, list]) => (
            <li key={project}>
              <div
                className="flex items-center gap-1.5 px-1 mb-0.5 text-[10px] font-mono uppercase tracking-[0.15em]"
                style={{
                  color:
                    project === currentProject
                      ? "var(--text-secondary)"
                      : "var(--text-muted)",
                }}
              >
                <span className="truncate">{project}</span>
              </div>
              <ul className="space-y-0.5">
                {list.map((s) => {
                  const isActive = s.id === focusedId;
                  return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => openSession(s)}
                      className="flex items-center gap-2 w-full px-2 py-1 rounded-md text-left transition-colors"
                      style={{
                        color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                        background: isActive ? "var(--bg-active)" : "transparent",
                        borderLeft: s.color
                          ? `2px solid ${s.color}`
                          : "2px solid transparent",
                        paddingLeft: s.color ? "6px" : undefined,
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = isActive ? "var(--bg-active)" : "var(--bg-hover)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = isActive ? "var(--bg-active)" : "transparent")
                      }
                    >
                      <TerminalActivityLed sessionId={s.id} />
                      <span
                        className="text-[12px] font-mono truncate flex-1"
                        title={s.name}
                      >
                        {s.name}
                      </span>
                    </button>
                  </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default TerminalNavList;
