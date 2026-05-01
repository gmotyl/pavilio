import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Archive as ArchiveIcon,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  GitBranch,
  HelpCircle,
  Inbox,
  Plus,
  Settings,
  Smartphone,
  Star,
  Wifi,
} from "lucide-react";
import GitSummary from "../git/GitSummary";
import { MobileAccessModal } from "../mobile-access/MobileAccessModal";
import { LanAccessModal } from "../lan-access/LanAccessModal";
import { Toggle } from "../mobile-access/MobileAccessModal/Toggle";
import { useMobileAccessStatus } from "../mobile-access/useMobileAccessStatus";
import { useArchivedProjects } from "../projects/useArchivedProjects";
import { useFavorites } from "../projects/useFavorites";
import { useProjects } from "../projects/useProjects";
import { TerminalActivityLed } from "../terminal/TerminalActivityLed";
import { useAllTerminalSessions } from "../terminal/useAllTerminalSessions";
import { getActivityState } from "../terminal/useTerminalActivityChannel";
import {
  TERMINAL_FOCUS_EVENT,
  dispatchTerminalFocus,
  nextProjectName,
  type SessionMeta,
  type TerminalFocusEventDetail,
} from "../terminal/useTerminalSessions";

function SectionHeader({
  icon: Icon,
  label,
}: {
  icon: typeof FolderOpen;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2 px-1">
      <Icon size={12} style={{ color: "var(--text-tertiary)" }} />
      <h2
        className="text-[11px] font-semibold uppercase tracking-widest"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </h2>
    </div>
  );
}

export default function LeftSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const projects = useProjects();
  const { isFavorite, toggle } = useFavorites();
  const { sessions } = useAllTerminalSessions();
  const { archive, archivedNames } = useArchivedProjects();
  const [mobileAccessOpen, setMobileAccessOpen] = useState(false);
  const [lanAccessOpen, setLanAccessOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const inIterm = /\/project\/[^/]+\/iterm/.test(location.pathname);
  const currentProject =
    location.pathname.match(/^\/project\/([^/]+)/)?.[1] ?? null;

  // Focused session id (for highlighting individual terminals)
  const [focusedId, setFocusedId] = useState<string | null>(() => {
    if (!currentProject) return null;
    try {
      return localStorage.getItem(`panel-terminal-focus-${currentProject}`);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const onFocus = (e: Event) => {
      setFocusedId(
        (e as CustomEvent<TerminalFocusEventDetail>).detail.sessionId,
      );
    };
    window.addEventListener(TERMINAL_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(TERMINAL_FOCUS_EVENT, onFocus);
  }, []);
  useEffect(() => {
    if (!inIterm) setFocusedId(null);
  }, [inIterm]);
  useEffect(() => {
    if (!currentProject) return;
    try {
      setFocusedId(
        localStorage.getItem(`panel-terminal-focus-${currentProject}`),
      );
    } catch {
      // ignore
    }
  }, [currentProject]);

  // Per-project expand state — hydrated once from localStorage when projects load
  const [expanded, setExpandedState] = useState<Record<string, boolean>>(
    () => ({}),
  );
  // Hydrate expand state from localStorage for any projects not yet in state
  useEffect(() => {
    if (projects.length === 0) return;
    setExpandedState((prev) => {
      const patch: Record<string, boolean> = {};
      for (const p of projects) {
        if (prev[p.name] === undefined) {
          try {
            patch[p.name] =
              localStorage.getItem(`panel-project-expanded-${p.name}`) === "true";
          } catch {
            patch[p.name] = false;
          }
        }
      }
      return Object.keys(patch).length > 0 ? { ...prev, ...patch } : prev;
    });
  }, [projects]);
  const isExpanded = useCallback(
    (name: string) => expanded[name] ?? false,
    [expanded],
  );
  const setExpanded = useCallback((name: string, value: boolean) => {
    setExpandedState((prev) => ({ ...prev, [name]: value }));
    try {
      localStorage.setItem(`panel-project-expanded-${name}`, String(value));
    } catch {
      // ignore
    }
  }, []);

  const handleCreateTerminal = useCallback(
    async (project: string) => {
      const projectSessions = sessions.filter((s) => s.project === project);
      const name = nextProjectName(project, projectSessions);
      try {
        const res = await fetch("/api/terminal/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project, name }),
        });
        if (res.ok) {
          const data: SessionMeta = await res.json();
          // Persist focus before navigating so the iTerm tab picks the
          // new session as focusedId on initial mount (the focus event
          // alone fires before the route mounts and is missed otherwise).
          try {
            localStorage.setItem(
              `panel-terminal-focus-${project}`,
              data.id,
            );
          } catch {
            // ignore
          }
          dispatchTerminalFocus(project, data.id);
          setExpanded(project, true);
          navigate(`/project/${project}/iterm`);
        } else {
          setCreateError("Could not create terminal");
          setTimeout(() => setCreateError(null), 4000);
        }
      } catch (err) {
        console.warn("[sidebar] create terminal failed:", err);
        setCreateError("Could not create terminal");
        setTimeout(() => setCreateError(null), 4000);
      }
    },
    [sessions, navigate, setExpanded],
  );

  const anyModalOpen = mobileAccessOpen || lanAccessOpen;
  const {
    status: mobileStatus,
    enable: enableMobile,
    disable: disableMobile,
    enableLan,
    disableLan,
  } = useMobileAccessStatus(true, anyModalOpen ? 2000 : 30000);
  const mobileIsOn = mobileStatus?.tailscale.state === "on";
  const lanIsOn = mobileStatus?.lan.state === "on";
  const lanHasInterface =
    mobileStatus?.lan.state === "on" ||
    (mobileStatus?.lan.state === "off" && mobileStatus.lan.lanIp !== null);

  const onMobileToggle = (next: boolean) => {
    if (next) {
      enableMobile();
      setMobileAccessOpen(true);
    } else {
      disableMobile();
      setMobileAccessOpen(false);
    }
  };

  const onLanToggle = (next: boolean) => {
    if (next) {
      enableLan();
      setLanAccessOpen(true);
    } else {
      disableLan();
      setLanAccessOpen(false);
    }
  };

  const visibleProjects = projects.filter((p) => !archivedNames.has(p.name));
  const starredProjects = visibleProjects.filter((p) => isFavorite(p.name));
  const otherProjects = visibleProjects.filter((p) => !isFavorite(p.name));

  const sessionsByProject = useMemo(() => {
    const m = new Map<string, SessionMeta[]>();
    for (const s of sessions) {
      const arr = m.get(s.project);
      if (arr) arr.push(s);
      else m.set(s.project, [s]);
    }
    return m;
  }, [sessions]);

  const renderProjectRow = (project: { name: string }) => {
    const projectSessions = sessionsByProject.get(project.name) ?? [];
    const expandedNow = isExpanded(project.name);
    const isCurrent =
      location.pathname === `/project/${project.name}` ||
      location.pathname.startsWith(`/project/${project.name}/`);
    const aggregate: "busy" | "attention" | "idle" = (() => {
      const states = projectSessions.map((s) => getActivityState(s.id));
      if (states.some((s) => s === "busy")) return "busy";
      if (states.some((s) => s === "attention")) return "attention";
      return "idle";
    })();

    const fav = isFavorite(project.name);

    return (
      <li key={project.name}>
        <div
          className="group flex items-center gap-1 rounded-md px-1 py-0.5"
          style={{
            background: isCurrent ? "var(--bg-active)" : "transparent",
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              toggle(project.name);
            }}
            className="p-1 rounded transition-colors shrink-0 opacity-0 group-hover:opacity-100"
            title={fav ? "Remove from favorites" : "Add to favorites"}
          >
            <Star
              size={12}
              fill={fav ? "var(--accent)" : "none"}
              style={{
                color: fav ? "var(--accent)" : "var(--text-muted)",
                transition: "all 150ms",
              }}
            />
          </button>
          <button
            type="button"
            onClick={() => setExpanded(project.name, !expandedNow)}
            className="w-4 h-4 flex items-center justify-center shrink-0 rounded hover:bg-[var(--bg-hover)]"
            style={{ color: "var(--text-tertiary)" }}
            title={expandedNow ? "Collapse" : "Expand"}
            aria-label={
              expandedNow ? "Collapse terminals" : "Expand terminals"
            }
          >
            {expandedNow ? (
              <ChevronDown size={11} />
            ) : (
              <ChevronRight size={11} />
            )}
          </button>
          <NavLink
            to={`/project/${project.name}/iterm`}
            className="flex-1 truncate text-[13px] py-0.5"
            style={({ isActive }) => ({
              color:
                isCurrent || isActive
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
            })}
          >
            {project.name}
          </NavLink>
          {!expandedNow && aggregate !== "idle" && (
            <span
              aria-hidden
              className="w-1.5 h-1.5 rounded-full mr-1"
              style={{
                background:
                  aggregate === "busy" ? "#f9e2af" : "#a6e3a1",
              }}
            />
          )}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              handleCreateTerminal(project.name);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded shrink-0"
            style={{
              border: "1px solid var(--border-subtle)",
              color: "var(--text-tertiary)",
            }}
            title={`New terminal in ${project.name}`}
            aria-label={`New terminal in ${project.name}`}
          >
            <Plus size={11} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              archive(project.name);
              if (currentProject === project.name) navigate("/");
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded shrink-0"
            style={{
              border: "1px solid var(--border-subtle)",
              color: "var(--text-tertiary)",
            }}
            title={`Archive ${project.name}`}
            aria-label={`Archive ${project.name}`}
          >
            <ArchiveIcon size={11} />
          </button>
        </div>
        {expandedNow && projectSessions.length > 0 && (
          <ul className="ml-4 mt-0.5 space-y-0.5">
            {projectSessions.map((s) => {
              const isFocused = inIterm && s.id === focusedId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        localStorage.setItem(
                          `panel-terminal-focus-${s.project}`,
                          s.id,
                        );
                      } catch {
                        // ignore
                      }
                      dispatchTerminalFocus(s.project, s.id);
                      navigate(`/project/${s.project}/iterm`);
                    }}
                    className="w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded text-left"
                    style={{
                      background: isFocused
                        ? "var(--bg-active)"
                        : "transparent",
                      color: isFocused
                        ? "var(--text-primary)"
                        : "var(--text-secondary)",
                    }}
                  >
                    <TerminalActivityLed sessionId={s.id} />
                    <span className="font-mono text-[11px] truncate">
                      {s.name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="p-3 overflow-auto h-full flex flex-col gap-5 pt-10">
      {starredProjects.length > 0 && (
        <section>
          <SectionHeader icon={Star} label="Starred" />
          <ul className="space-y-0.5">
            {starredProjects.map(renderProjectRow)}
          </ul>
        </section>
      )}
      <section>
        <SectionHeader icon={FolderOpen} label="Projects" />
        <ul className="space-y-0.5">
          {otherProjects.map(renderProjectRow)}
          <li>
            <NavLink
              to="/archive"
              className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12px]"
              style={({ isActive }) => ({
                color: isActive
                  ? "var(--text-primary)"
                  : "var(--text-tertiary)",
                background: isActive ? "var(--bg-active)" : "transparent",
              })}
            >
              <Inbox size={12} />
              <span>Archive</span>
            </NavLink>
          </li>
        </ul>
      </section>

      <section className="mt-auto">
        <SectionHeader icon={GitBranch} label="Git" />
        <GitSummary />
      </section>

      {createError && (
        <div
          className="mx-1 px-2 py-1.5 rounded-md text-[11px]"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid color-mix(in srgb, var(--red) 40%, transparent)",
            color: "var(--red)",
          }}
        >
          {createError}
        </div>
      )}

      <section className="px-1 pb-3 space-y-0.5">
        <button
          onClick={() => navigate("/view/_help/panel-guide.md")}
          className="flex items-center gap-2 w-full text-[12px] px-2 py-1.5 rounded-md transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          <HelpCircle size={14} />
          Help & Shortcuts
        </button>
        <button
          onClick={() => navigate("/settings")}
          className="flex items-center gap-2 w-full text-[12px] px-2 py-1.5 rounded-md transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          <Settings size={14} />
          Agent Settings
        </button>
        <div
          className="flex items-center gap-2 w-full text-[12px] px-2 py-1.5 rounded-md"
          style={{ color: "var(--text-muted)" }}
        >
          <button
            type="button"
            onClick={() => setMobileAccessOpen(true)}
            className="flex items-center gap-2 flex-1 text-left transition-colors"
            style={{ color: "inherit" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
            }}
            title={mobileIsOn ? "Show QR code" : "Enable to show QR code"}
          >
            <Smartphone size={14} />
            <span>Mobile access</span>
          </button>
          <Toggle
            on={mobileIsOn}
            onChange={onMobileToggle}
            label="Mobile access"
          />
        </div>
        <div
          className="flex items-center gap-2 w-full text-[12px] px-2 py-1.5 rounded-md"
          style={{ color: "var(--text-muted)" }}
        >
          <button
            type="button"
            onClick={() => setLanAccessOpen(true)}
            className="flex items-center gap-2 flex-1 text-left transition-colors"
            style={{ color: "inherit" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
            }}
            title={
              lanIsOn
                ? "Show LAN link"
                : lanHasInterface
                  ? "Enable to show LAN link"
                  : "No LAN interface detected"
            }
          >
            <Wifi size={14} />
            <span>LAN access</span>
          </button>
          <Toggle
            on={!!lanIsOn}
            onChange={onLanToggle}
            label="LAN access"
            disabled={!lanIsOn && !lanHasInterface}
          />
        </div>
      </section>
      {mobileAccessOpen && (
        <MobileAccessModal onClose={() => setMobileAccessOpen(false)} />
      )}
      {lanAccessOpen && (
        <LanAccessModal onClose={() => setLanAccessOpen(false)} />
      )}
    </div>
  );
}
