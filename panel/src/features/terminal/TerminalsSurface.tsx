import { useLayoutEffect, type RefObject } from "react";
import { TerminalToolbar } from "./TerminalToolbar";
import { TerminalLayoutGrid } from "./TerminalLayoutGrid";
import { TerminalShortcutBar } from "./TerminalShortcutBar";
import { TerminalMobileRail } from "./TerminalMobileRail";
import { TerminalSpine } from "./TerminalSpine";
import { TerminalSpineDrawer } from "./TerminalSpineDrawer";
import {
  sendDismiss,
  reconnectSession,
  reconnectAllDisconnected,
  reconnectOnActivate,
} from "./terminalInstances";
import { writeTerminalFocus } from "./useTerminalSessions";
import { useIsMobile } from "../shell/useIsMobile";
import type { SessionMeta, CreateSessionOpts } from "./useTerminalSessions";
import { useAnyAnswerPaneOpen } from "./answerPaneState";
import { visibleSessionId } from "./visibleSession";
import type { TerminalHandle } from "./TerminalView";
import type { RepoEntry } from "../projects/useProjects";
import type { LayoutPreset, TileLayout } from "./tileLayout";
import type { LayoutCommitKind } from "./orderingReducer";
import type { GridSpeech } from "../speech/types";

export interface TerminalsSurfaceProps {
  // Current project context
  currentProject: string;
  repos: RepoEntry[] | undefined;

  // Per-project terminal sessions hook values
  sessions: SessionMeta[];
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  onDeleteSession: (id: string) => void;
  onUpdateSession: (id: string, patch: { name?: string }) => void;

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


  // Column layout state + callbacks
  tiles?: TileLayout;
  onPlace?: (layout: TileLayout, kind: LayoutCommitKind) => void;
  onApplyPreset?: (preset: LayoutPreset) => void;

  // Minimised sessions on this surface (in session order) and the two
  // transitions; the surface layers focus and Max handling over them.
  minimisedIds?: string[];
  onMinimise?: (id: string) => void;
  onRestore?: (id: string) => void;

  /**
   * The surface's speech host — one channel and one player for every cell it
   * renders. Required, so neither host can forget it; see {@link GridSpeech}.
   */
  speech: GridSpeech;

  // When true: fills from below the breadcrumb bar (no negative margins, no p-6 offset)
  standalone?: boolean;

  // Fill the parent container's height instead of a viewport-relative calc.
  // Used when embedded in the Cmd+B drawer.
  fill?: boolean;
}

const NONE: string[] = [];

export function TerminalsSurface({
  currentProject,
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
  tiles,
  onPlace,
  onApplyPreset,
  minimisedIds = NONE,
  onMinimise,
  onRestore,
  speech,
  standalone = false,
  fill = false,
}: TerminalsSurfaceProps) {
  // Dismiss attention state as soon as the user focuses a terminal — the
  // green "done" LED is a "check me" notification that clears on first look.
  //
  // Activation is also consent to repair: a session whose socket died is
  // reconnected right here, so a frozen pane thaws on the click that selects
  // it instead of waiting for the user to aim at its warning badge (ADR 0010).
  // The guard lives in `reconnectOnActivate`, which shares the badge's
  // predicate — this is every surface's focus path (grid cell, toolbar tab,
  // rail dot, spine, drawer row, keyboard nav), so one call covers them all.
  const handleFocus = (id: string | null) => {
    if (id) {
      sendDismiss(id);
      reconnectOnActivate(id);
    }
    onFocus(id);
  };

  // The sessions the grid tiles, in order — everything not minimised here.
  const visibleSessions =
    minimisedIds.length === 0
      ? sessions
      : sessions.filter((s) => !minimisedIds.includes(s.id));

  // Minimising never leaves focus or Max on a session the grid no longer shows:
  // focus moves to the next visible session in order (wrapping to the first),
  // and Max — which shows exactly one session — returns to the grid of the rest.
  // A minimise the model would refuse (the id is not in the grid, or it is the
  // last one there) changes nothing here either.
  //
  // Focus moves with the plain `onFocus`, not `handleFocus`: the session that
  // inherits focus was not chosen by the user, so it is not an activation — no
  // reconnect over its content and no dismissing its "done" LED (ADR 0010).
  const handleMinimise = (id: string) => {
    const i = visibleSessions.findIndex((s) => s.id === id);
    if (i === -1 || visibleSessions.length < 2) return;
    const shown = maximized ? visibleSessionId(visibleSessions, focusedId) : null;
    onMinimise?.(id);
    if (focusedId === id) {
      const rest = [...visibleSessions.slice(i + 1), ...visibleSessions.slice(0, i)];
      onFocus(rest[0].id);
    }
    if (shown === id) onToggleMaximize();
  };

  // A session brought back from the tray or the rail's aggregate is the one the
  // user reached for, so it takes focus.
  const handleRestore = (id: string) => {
    onRestore?.(id);
    handleFocus(id);
  };

  // Focus that lands on a minimised session was a pick of it — the spine, the
  // drawer, a sidebar row, a notification tap — so it comes back into the grid.
  // Left out, it would be focused but unshown: Max and the mobile view would
  // show another terminal while the focus-driven controls aimed at this one.
  // A layout effect, so the grid never paints a frame without it. Minimising
  // the focused session cannot trip this: `handleMinimise` moves focus off it
  // in the same update.
  useLayoutEffect(() => {
    if (focusedId && minimisedIds.includes(focusedId)) onRestore?.(focusedId);
  }, [focusedId, minimisedIds, onRestore]);

  // Sockets die in bursts, so the Reconnect control repairs all of them. With
  // nothing disconnected it keeps its second, deliberate use: repaint the pane
  // being looked at, which is how it is used on a terminal that looks wrong
  // while still connected.
  const handleReconnect = () => {
    if (reconnectAllDisconnected() > 0) return;
    if (focusedId) reconnectSession(focusedId);
  };

  // The mobile shortcut bar and an open answer pane both live in the row
  // above the keyboard — on a phone there isn't room for both, and the pane
  // (a live reply) wins. Only the visible session's pane counts (see
  // `visibleSessionId`): hidden sessions stay mounted and their panes can
  // auto-open, which must not blank the bar under the terminal on screen.
  const visibleId = visibleSessionId(visibleSessions, focusedId);
  const shortcutBarYielded = useAnyAnswerPaneOpen(visibleId ? [visibleId] : []);
  const isMobile = useIsMobile();

  return (
    <div
      className={`flex flex-col relative ${
        fill
          ? "h-full"
          : standalone
            ? "h-[calc(100dvh-2.25rem)]"
            : "h-[calc(100dvh-5rem)] md:h-[calc(100dvh-10rem)]"
      }`}
      style={{
        ...(standalone || fill ? {} : { margin: "-1.5rem", marginTop: 0 }),
        touchAction: "pan-y",
        overscrollBehaviorX: "contain",
        // Cap to the visual viewport so the on-screen keyboard can never push
        // the shortcut bar or xterm cursor below the fold. `--vv-height` is
        // written by `useVisualViewport`; on desktop (or pre-hydration) the
        // fallback resolves to 100dvh so there's no functional change.
        ...(fill ? {} : { maxHeight: "var(--vv-height, 100dvh)" }),
      }}
    >
      {/* Desktop toolbar */}
      <div className="hidden md:block">
        <TerminalToolbar
          sessions={sessions}
          focusedId={focusedId}
          maximized={maximized}
          currentProject={currentProject}
          repos={repos}
          onFocus={handleFocus}
          onCreate={(opts) => {
            onCreateTerminal(opts || {});
          }}
          onDelete={onDeleteSession}
          onRename={(id, n) => onUpdateSession(id, { name: n })}
          onToggleMaximize={onToggleMaximize}
          onReorder={onReorder ?? (() => {})}
          onReconnect={handleReconnect}
          onApplyPreset={onApplyPreset}
          minimisedIds={minimisedIds}
          onRestore={handleRestore}
        />
      </div>

      {/* Mobile session-dot rail */}
      <div className="md:hidden">
        <TerminalMobileRail
          sessions={sessions}
          focusedId={focusedId}
          currentProject={currentProject}
          onFocus={handleFocus}
          onCreate={(opts) => {
            onCreateTerminal(opts || {});
          }}
          onReconnect={handleReconnect}
          minimisedIds={minimisedIds}
          onRestore={handleRestore}
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
            onReady={(sessionId, handle) => {
              terminalHandlesRef.current.set(sessionId, handle);
            }}

            onRename={(id, n) => onUpdateSession(id, { name: n })}
            tiles={tiles}
            onPlace={onPlace}
            minimisedIds={minimisedIds}
            onMinimise={handleMinimise}
            onToggleMaximize={onToggleMaximize}
            speech={speech}
          />
        </div>

        {/* Cross-project drawer, opened from the desktop spine. Never on a
            phone: there the global corner ☰ (the left sidebar) is the one
            menu, so a second session list would only duplicate it. */}
        {drawerOpen && !isMobile && (
          <TerminalSpineDrawer
            sessions={allSessions}
            focusedId={focusedId}
            currentProject={currentProject}
            onFocus={(sessionId, sessionProject) => {
              // Persist first, then navigate or focus — LeftSidebar re-reads
              // the stored focus across a project switch.
              writeTerminalFocus(sessionProject, sessionId);
              if (sessionProject === currentProject) {
                handleFocus(sessionId);
              } else {
                onNavTo(`/project/${sessionProject}/iterm`);
              }
              onSetDrawerOpen(false);
            }}
            onClose={() => onSetDrawerOpen(false)}
          />
        )}
      </div>

      {/* Mobile shortcut bar — yields its row to an open answer pane */}
      {!shortcutBarYielded && (
        <TerminalShortcutBar
          onSend={(data) => {
            if (!visibleId) return;
            const handle = terminalHandlesRef.current.get(visibleId);
            handle?.send(data);
            // Re-focus the xterm on the next frame so subsequent taps on
            // the on-screen keyboard still go into the terminal.
            requestAnimationFrame(() => handle?.focus());
          }}
          onToggleKeyboard={() => {
            if (visibleId) terminalHandlesRef.current.get(visibleId)?.focus();
          }}
        />
      )}
    </div>
  );
}

export default TerminalsSurface;
