import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  RotateCw,
  Settings,
  Smartphone,
  Star,
  Terminal as TerminalIcon,
  Wifi,
} from "lucide-react";
import { HamburgerSlot } from "./SidebarHamburger";
import { useIsMobile } from "./useIsMobile";
import { preferences } from "../../preferences/declarations";
import { readPreference, writePreference } from "../../preferences/store";
import { isPreferenceScope } from "../../preferences/types";
import GitSummary from "../git/GitSummary";
import { MobileAccessModal } from "../mobile-access/MobileAccessModal";
import { LanAccessModal } from "../lan-access/LanAccessModal";
import { AutoSyncModal } from "../auto-sync/AutoSyncModal";
import { Toggle } from "../mobile-access/MobileAccessModal/Toggle";
import { useMobileAccessStatus } from "../mobile-access/useMobileAccessStatus";
import { useAutoSyncStatus } from "../auto-sync/useAutoSyncStatus";
import { useArchivedProjects } from "../projects/useArchivedProjects";
import { useFavorites } from "../projects/useFavorites";
import { useProjects } from "../projects/useProjects";
import { ProjectActivityLed } from "../terminal/ProjectActivityLed";
import { SessionIndicator } from "../terminal/SessionIndicator";
import { useAllTerminalSessions } from "../terminal/useAllTerminalSessions";
import {
  TERMINAL_FOCUS_EVENT,
  dispatchTerminalFocus,
  readTerminalFocus,
  writeTerminalFocus,
  type SessionMeta,
  type TerminalFocusEventDetail,
} from "../terminal/useTerminalSessions";
import { createTerminalSession } from "../terminal/createTerminalSession";

/**
 * `leading` is the slot the corner hamburger occupies — passed to whichever
 * header renders FIRST, because that is the row the fixed button lands on. It
 * is a reserved box rather than the button itself: `.sidebar` is
 * `overflow: hidden` and `.sidebar-collapsed` is `pointer-events: none`, so the
 * control cannot live in this tree. See `SidebarHamburger`.
 */
function SectionHeader({
  icon: Icon,
  label,
  leading,
}: {
  icon: typeof FolderOpen;
  label: string;
  leading?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-2 px-1">
      {leading}
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

/**
 * The project's remembered focused session, or null when nothing is stored.
 *
 * The read and the writers below now share ONE pair of functions, exported by
 * `useTerminalSessions` — which is why this could not move before Task 8: a
 * reader that changed key ahead of its writers would highlight nothing. A null
 * or blank project is not a scope, and `readTerminalFocus` answers the declared
 * default for one rather than letting every project share a key.
 */
function readStoredFocus(project: string | null): string | null {
  return readTerminalFocus(project);
}

export default function LeftSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const projects = useProjects();
  const { isFavorite, toggle } = useFavorites();
  const { sessions } = useAllTerminalSessions();
  const isMobile = useIsMobile();
  const { archive, archivedNames } = useArchivedProjects();
  const [mobileAccessOpen, setMobileAccessOpen] = useState(false);
  const [lanAccessOpen, setLanAccessOpen] = useState(false);
  const [autoSyncOpen, setAutoSyncOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const currentProject =
    location.pathname.match(/^\/project\/([^/]+)/)?.[1] ?? null;

  // Focused session id (for highlighting individual terminals)
  const [focusedId, setFocusedId] = useState<string | null>(() =>
    readStoredFocus(currentProject),
  );
  useEffect(() => {
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent<TerminalFocusEventDetail>).detail;
      // Every project keeps its own focused session, so a broadcast from
      // another project's surface must not move this project's highlight.
      //
      // WHY this filter is safe despite being keyed on [currentProject]: a
      // broadcast for a project we are navigating *to*, fired in the same tick
      // as the navigation, is still compared against the *old* currentProject
      // (this effect has not re-subscribed yet) and is dropped. Nothing is lost
      // only because every broadcaster calls `writeTerminalFocus` *before*
      // dispatching (useTerminalSessions.setFocusedId, createTerminalSession,
      // QuickTerminalModal, TerminalsSurface, and the sidebar row click
      // below), and the
      // [currentProject] effect underneath re-reads that storage immediately
      // after the switch. A future broadcaster that dispatches without
      // persisting first would have its event silently dropped across a
      // project switch: persist, then dispatch.
      if (detail.project !== currentProject) return;
      setFocusedId(detail.sessionId);
    };
    window.addEventListener(TERMINAL_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(TERMINAL_FOCUS_EVENT, onFocus);
  }, [currentProject]);
  // Follow the project, not the section: on switching projects adopt the new
  // one's stored focus — which the sidebar row click and every other focus
  // surface write before navigating. Moving within a project keeps whatever
  // the last broadcast set, so the stored value never overwrites a fresher one.
  useEffect(() => {
    setFocusedId(readStoredFocus(currentProject));
  }, [currentProject]);

  // Per-project expand state — hydrated once from the stored preference when
  // projects load
  const [expanded, setExpandedState] = useState<Record<string, boolean>>(
    () => ({}),
  );
  // Hydrate expand state from the stored preference for any projects not yet
  // in state. One preference per project, read directly rather than through
  // `usePreference`: the project list is dynamic, so a hook per project would
  // change in number between renders.
  useEffect(() => {
    if (projects.length === 0) return;
    setExpandedState((prev) => {
      const patch: Record<string, boolean> = {};
      for (const p of projects) {
        if (prev[p.name] !== undefined) continue;
        // An unresolved name is not a scope: `storageKey` throws on a blank
        // one rather than letting every project share `key@`, and this runs
        // inside a state updater during an effect, where that throw is an
        // unhandled render error. Declared default, and nothing written —
        // the same rule every other Task 6 call site follows.
        patch[p.name] = isPreferenceScope(p.name)
          ? readPreference(preferences.projectExpanded, p.name)
          : preferences.projectExpanded.default;
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
    // Same rule on the way out: an unresolved name writes nothing.
    if (!isPreferenceScope(name)) return;
    writePreference(preferences.projectExpanded, value, name);
  }, []);

  const handleCreateTerminal = useCallback(
    async (project: string) => {
      const projectSessions = sessions.filter((s) => s.project === project);
      const created = await createTerminalSession(project, projectSessions);
      if (created) {
        dispatchTerminalFocus(project, created.id);
        setExpanded(project, true);
        navigate(`/project/${project}/iterm`);
      } else {
        setCreateError("Could not create terminal");
        setTimeout(() => setCreateError(null), 4000);
      }
    },
    [sessions, navigate, setExpanded],
  );

  const anyModalOpen = mobileAccessOpen || lanAccessOpen || autoSyncOpen;
  const {
    status: mobileStatus,
    enable: enableMobile,
    disable: disableMobile,
    enableLan,
    disableLan,
  } = useMobileAccessStatus(true, anyModalOpen ? 2000 : 30000);
  const { status: autoSync, enable: enableSync, disable: disableSync } = useAutoSyncStatus();
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

  const onAutoSyncToggle = (next: boolean) => { if (next) enableSync(); else disableSync(); };

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

  /**
   * Where tapping a project goes — from its NAME or from any of its session
   * rows. One function for both, because the reason below is about what is
   * worth arriving at on a phone and says nothing about which row the thumb
   * landed on; two copies of it would be one edit away from disagreeing, and
   * did disagree until the session rows were brought in with it.
   *
   * On a desktop it is the bare project route, which `ProjectRedirect` resolves
   * through the Last-open-view bookmark — the user is returned to whichever view
   * they left the project in. A phone has one view worth arriving at, and it is
   * the terminal: the sections are reading surfaces opened deliberately, while
   * the reason to pick the phone up at all is an agent waiting in a session. So
   * the tap is sent straight there, over the top of whatever the bookmark holds.
   *
   * This overrides the DESTINATION and nothing else. The bookmark goes on being
   * written by the page the user lands on (`useLastPath`, mounted in
   * `ProjectView`), so a phone visit still records where they were, and the bare
   * route still restores it on their desktop. Suppressing the write instead would
   * be the easy mistake here: it looks the same from the phone and quietly loses
   * the desktop's place.
   *
   * Derived from the live `useIsMobile()` rather than a `matchMedia` read taken
   * once at mount, so a rotation moves the destination with it — and never
   * stored, because being on a phone is a fact about the viewport, not a
   * preference the user expressed.
   *
   * The name is percent-encoded, matching `QuickTerminalModal`, which builds
   * this same `/project/<name>/iterm` target. A project may be named with a
   * space or a `#`, and unencoded those do not survive the trip: a `#` starts
   * the fragment, so the route would see a truncated name. Encoding is safe on
   * the far side — `matchProjectFromPath` decodes the segment itself, and the
   * router hands `useParams` the decoded form, which is what every preference
   * scope downstream (the bookmark, the expand state) is keyed on.
   */
  const projectHref = (name: string) =>
    isMobile
      ? `/project/${encodeURIComponent(name)}/iterm`
      : `/project/${encodeURIComponent(name)}`;

  const renderProjectRow = (project: { name: string }) => {
    const projectSessions = sessionsByProject.get(project.name) ?? [];
    const projectSessionIds = projectSessions.map((s) => s.id);
    const expandedNow = isExpanded(project.name);
    const isCurrent =
      location.pathname === `/project/${project.name}` ||
      location.pathname.startsWith(`/project/${project.name}/`);

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
            data-testid={`sidebar-project-expand-${project.name}`}
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
          {!expandedNow && (
            <span className="flex items-center">
              {/* The aggregate group shows every status this project has at
                  once — busy, attention, and the speaker when one of its
                  sessions is talking. */}
              <ProjectActivityLed sessionIds={projectSessionIds} />
            </span>
          )}
          <NavLink
            to={projectHref(project.name)}
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
          <button
            type="button"
            data-testid={`sidebar-project-create-terminal-${project.name}`}
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
            data-testid={`sidebar-project-favorite-${project.name}`}
            onClick={(e) => {
              e.preventDefault();
              toggle(project.name);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded shrink-0"
            style={{
              border: "1px solid var(--border-subtle)",
              color: fav ? "var(--accent)" : "var(--text-tertiary)",
            }}
            title={fav ? "Remove from favorites" : "Add to favorites"}
            aria-label={fav ? "Remove from favorites" : "Add to favorites"}
          >
            <Star size={11} fill={fav ? "var(--accent)" : "none"} />
          </button>
          <button
            type="button"
            data-testid={`sidebar-project-archive-${project.name}`}
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
          <ul
            className="ml-3 mt-0.5 pl-3 space-y-0.5 border-l"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            {projectSessions.map((s) => {
              // The highlight tracks the project, not the route: a focused
              // terminal can be on screen in the Cmd+B drawer, which renders
              // only OUTSIDE the terminal section. The old route gate made the
              // drawer's own session the one row that could never light up.
              const isFocused =
                currentProject === project.name && s.id === focusedId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    data-testid={`sidebar-session-${s.id}`}
                    onClick={() => {
                      // Persist, then dispatch — see the note on the focus
                      // listener above for why that order is load-bearing.
                      writeTerminalFocus(s.project, s.id);
                      dispatchTerminalFocus(s.project, s.id);
                      // The same destination as the project-name link, from
                      // the same function: the bare project route on a
                      // desktop, where `ProjectRedirect` resolves it via the
                      // Last-open-view bookmark (or falls through to the
                      // default section when there is none), and the terminal
                      // tab on a phone. Tapping a SESSION and landing on notes
                      // was the sharpest form of the problem the phone rule
                      // exists to solve.
                      navigate(projectHref(s.project));
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
                    <SessionIndicator sessionId={s.id} />
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

  // Which header row reserves the hamburger's box, decided ONCE. It belongs to
  // the first row on screen, which is Starred when there is one and Projects
  // otherwise — an invariant, and one that two independent `leading` ternaries
  // could disagree about. Two slots would double-indent, none would put the
  // heading under the button, and both are a single edit away when the answer
  // lives in two places.
  const starredIsFirst = starredProjects.length > 0;
  const hamburgerSlot = <HamburgerSlot />;

  return (
    // `pt-10` used to clear the floating toggle that hovered over this column.
    // The hamburger sits in the first header row instead, so the row starts at
    // the padding like every other one.
    //
    // That row is inside this `overflow-auto` box while the button is fixed to
    // the viewport, so the two line up at `scrollTop === 0` and only there:
    // scroll the project list and the button floats over whatever row has
    // risen to the top, exactly as the floating toggle it replaced did. Not a
    // regression, and not fixed by a `sticky` header either — sticky is
    // constrained by its own `<section>`, so the pinned row is pushed off as
    // soon as that section's box scrolls past, and the next header arrives at
    // the top with no slot in it. Pinning it for real means lifting the row out
    // of this scrollport and away from the list it heads, which is a bigger
    // change than the misalignment earns.
    <div className="p-3 overflow-auto h-full flex flex-col gap-5">
      {starredIsFirst && (
        <section>
          <SectionHeader icon={Star} label="Starred" leading={hamburgerSlot} />
          <ul className="space-y-0.5">
            {starredProjects.map(renderProjectRow)}
          </ul>
        </section>
      )}
      <section>
        <SectionHeader
          icon={FolderOpen}
          label="Projects"
          leading={starredIsFirst ? undefined : hamburgerSlot}
        />
        <ul className="space-y-0.5">
          {otherProjects.map(renderProjectRow)}
          <li>
            <NavLink
              to="/terminals"
              data-testid="sidebar-terminals-link"
              className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12px]"
              style={({ isActive }) => ({
                color: isActive
                  ? "var(--text-primary)"
                  : "var(--text-tertiary)",
                background: isActive ? "var(--bg-active)" : "transparent",
              })}
            >
              <TerminalIcon size={12} />
              <span>Terminals</span>
            </NavLink>
          </li>
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
          data-testid="sidebar-help"
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
          data-testid="sidebar-agent-settings"
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
          Settings
        </button>
        <div
          className="flex items-center gap-2 w-full text-[12px] px-2 py-1.5 rounded-md"
          style={{ color: "var(--text-muted)" }}
        >
          <button
            type="button"
            data-testid="sidebar-mobile-access-open"
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
            data-testid="sidebar-lan-access-open"
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
        <div
          className="flex items-center gap-2 w-full text-[12px] px-2 py-1.5 rounded-md"
          style={{ color: "var(--text-muted)" }}
        >
          <button
            type="button"
            data-testid="sidebar-auto-sync-open"
            onClick={() => setAutoSyncOpen(true)}
            className="flex items-center gap-2 flex-1 text-left transition-colors"
            style={{ color: "inherit" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
            title="Auto-sync notes & progress across machines"
          >
            <RotateCw size={14} />
            <span>Auto-sync</span>
          </button>
          <Toggle on={!!autoSync?.enabled} onChange={onAutoSyncToggle} label="Auto-sync" />
        </div>
      </section>
      {mobileAccessOpen && (
        <MobileAccessModal onClose={() => setMobileAccessOpen(false)} />
      )}
      {lanAccessOpen && (
        <LanAccessModal onClose={() => setLanAccessOpen(false)} />
      )}
      {autoSyncOpen && <AutoSyncModal onClose={() => setAutoSyncOpen(false)} />}
    </div>
  );
}
