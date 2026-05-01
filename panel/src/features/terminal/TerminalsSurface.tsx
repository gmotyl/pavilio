import type { RefObject } from "react";
import { TerminalToolbar } from "./TerminalToolbar";
import { TerminalLayoutGrid } from "./TerminalLayoutGrid";
import { TerminalShortcutBar } from "./TerminalShortcutBar";
import { TerminalMobileRail } from "./TerminalMobileRail";
import { TerminalSpine } from "./TerminalSpine";
import { TerminalSpineDrawer } from "./TerminalSpineDrawer";
import { sendDismiss } from "./terminalInstances";
import type { SessionMeta, CreateSessionOpts } from "./useTerminalSessions";
import type { TerminalHandle } from "./TerminalView";
import type { Project } from "../projects/useProjects";
import type { RepoEntry } from "../projects/useProjects";

export interface TerminalsSurfaceProps {
  // Current project context
  currentProject: string;
  projects: Project[];
  repos: RepoEntry[] | undefined;

  // Per-project terminal sessions hook values
  sessions: SessionMeta[];
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  onDeleteSession: (id: string) => void;
  onUpdateSession: (id: string, patch: { color?: string | null; name?: string }) => void;

  // All-sessions (cross-project) data
  allSessions: SessionMeta[];

  // Maximize state
  maximized: boolean;
  onToggleMaximize: () => void;

  // Drawer state
  drawerOpen: boolean;
  onSetDrawerOpen: (open: boolean) => void;

  // Handle ref for shortcut bar sends
  terminalHandlesRef: RefObject<Map<string, TerminalHandle>>;

  // Create terminal (may navigate cross-project)
  onCreateTerminal: (opts?: CreateSessionOpts) => void;

  // Navigate to another project's iterm
  onNavTo: (path: string) => void;

  // Drag-to-reorder callbacks
  onReorder?: (fromId: string, toId: string) => void;
  onSwap?: (idA: string, idB: string) => void;

  // When true: fills from below the breadcrumb bar (no negative margins, no p-6 offset)
  standalone?: boolean;
}

export function TerminalsSurface({
  currentProject,
  projects,
  repos,
  sessions,
  focusedId,
  onFocus,
  onDeleteSession,
  onUpdateSession,
  allSessions,
  maximized,
  onToggleMaximize,
  drawerOpen,
  onSetDrawerOpen,
  terminalHandlesRef,
  onCreateTerminal,
  onNavTo,
  onReorder,
  onSwap,
  standalone = false,
}: TerminalsSurfaceProps) {
  // Dismiss attention state as soon as the user focuses a terminal — the
  // green "done" LED is a "check me" notification that clears on first look.
  const handleFocus = (id: string | null) => {
    if (id) sendDismiss(id);
    onFocus(id);
  };

  return (
    <div
      className={`flex flex-col relative ${
        standalone
          ? "h-[calc(100dvh-2.25rem)]"
          : "h-[calc(100dvh-5rem)] md:h-[calc(100dvh-10rem)]"
      }`}
      style={{
        ...(standalone ? {} : { margin: "-1.5rem", marginTop: 0 }),
        touchAction: "pan-y",
        overscrollBehaviorX: "contain",
        // Cap to the visual viewport so the on-screen keyboard can never push
        // the shortcut bar or xterm cursor below the fold. `--vv-height` is
        // written by `useVisualViewport`; on desktop (or pre-hydration) the
        // fallback resolves to 100dvh so there's no functional change.
        maxHeight: "var(--vv-height, 100dvh)",
      }}
    >
      {/* Desktop toolbar */}
      <div className="hidden md:block">
        <TerminalToolbar
          sessions={sessions}
          focusedId={focusedId}
          maximized={maximized}
          currentProject={currentProject}
          projects={projects}
          repos={repos}
          onFocus={handleFocus}
          onCreate={(opts) => {
            onCreateTerminal(opts || {});
          }}
          onDelete={onDeleteSession}
          onColorChange={(id, color) => onUpdateSession(id, { color })}
          onRename={(id, n) => onUpdateSession(id, { name: n })}
          onToggleMaximize={onToggleMaximize}
          onReorder={onReorder ?? (() => {})}
        />
      </div>

      {/* Mobile color-dot rail */}
      <div className="md:hidden">
        <TerminalMobileRail
          sessions={sessions}
          focusedId={focusedId}
          currentProject={currentProject}
          onFocus={handleFocus}
          onCreate={(opts) => {
            onCreateTerminal(opts || {});
          }}
          onOpenDrawer={() => onSetDrawerOpen(true)}
        />
      </div>

      {/* Terminal area: grid only. On mobile, the top rail handles session
          switching — the left-column spine is redundant and steals 16px of
          horizontal space. Drop the p-1 gutter on mobile too so the grid
          fills edge-to-edge. */}
      <div className="flex-1 min-h-0 flex relative">
        <div className="hidden md:block">
          <TerminalSpine
            sessions={sessions}
            focusedId={focusedId}
            onFocus={handleFocus}
            onOpenDrawer={() => onSetDrawerOpen(true)}
          />
        </div>
        <div className="flex-1 min-w-0 p-0 md:p-1">
          <TerminalLayoutGrid
            sessions={sessions}
            focusedId={focusedId}
            maximized={maximized}
            onFocus={handleFocus}
            onExit={onDeleteSession}
            onToggleMaximize={onToggleMaximize}
            onReady={(sessionId, handle) => {
              terminalHandlesRef.current.set(sessionId, handle);
            }}
            onSwap={onSwap}
          />
        </div>

        {/* Cross-project drawer (mobile-first, desktop-compatible) */}
        {drawerOpen && (
          <TerminalSpineDrawer
            sessions={allSessions}
            focusedId={focusedId}
            currentProject={currentProject}
            onFocus={(sessionId, sessionProject) => {
              try {
                localStorage.setItem(
                  `panel-terminal-focus-${sessionProject}`,
                  sessionId,
                );
              } catch {
                // ignore
              }
              if (sessionProject === currentProject) {
                handleFocus(sessionId);
              } else {
                onNavTo(`/project/${sessionProject}/iterm`);
              }
              onSetDrawerOpen(false);
            }}
            onCreate={(opts) => {
              onCreateTerminal(opts);
            }}
            onClose={() => onSetDrawerOpen(false)}
          />
        )}
      </div>

      {/* Mobile shortcut bar */}
      <TerminalShortcutBar
        onSend={(data) => {
          const targetId = focusedId ?? sessions[0]?.id;
          if (!targetId) return;
          const handle = terminalHandlesRef.current.get(targetId);
          handle?.send(data);
          // Re-focus the xterm on the next frame so subsequent taps on
          // the on-screen keyboard still go into the terminal.
          requestAnimationFrame(() => handle?.focus());
        }}
        onToggleKeyboard={() => {
          const targetId = focusedId ?? sessions[0]?.id;
          if (targetId) terminalHandlesRef.current.get(targetId)?.focus();
        }}
      />
    </div>
  );
}

export default TerminalsSurface;
