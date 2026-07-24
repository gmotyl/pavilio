import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProjects } from "../projects/useProjects";
import { useITermShortcuts } from "../projects/useITermShortcuts";
import TerminalsSurface from "./TerminalsSurface";
import {
  useTerminalSessions,
  nextProjectName,
} from "./useTerminalSessions";
import type { CreateSessionOpts } from "./useTerminalSessions";
import { useTerminalMaximized } from "./useTerminalMaximized";
import { useAllTerminalSessions } from "./useAllTerminalSessions";
import type { TerminalHandle } from "./TerminalView";

interface Props {
  projectName: string;
  /** Bind iTerm keyboard shortcuts (only for the real iTerm tab, not the drawer). */
  active: boolean;
  /** Fill the parent container height instead of a viewport calc (drawer mode). */
  fill?: boolean;
}

export default function ProjectTerminalsSurface({
  projectName,
  active,
  fill = false,
}: Props) {
  const projects = useProjects();
  const project = projects.find((p) => p.name === projectName);
  const navTo = useNavigate();

  const terminal = useTerminalSessions(projectName);
  const allTerminals = useAllTerminalSessions();
  const { sessions: allSessions } = allTerminals;
  const [maximized, toggleMaximized, setMaximized] =
    useTerminalMaximized(projectName);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const terminalHandlesRef = useRef<Map<string, TerminalHandle>>(new Map());

  const createTerminal = useCallback(
    async (opts: CreateSessionOpts = {}) => {
      const targetProject = opts.project ?? projectName ?? "";
      if (!targetProject) return;
      if (targetProject === (projectName || "")) {
        await terminal.createSession(opts);
        return;
      }
      const targetSessions = allSessions.filter(
        (s) => s.project === targetProject,
      );
      const derivedName =
        opts.name || nextProjectName(targetProject, targetSessions);
      try {
        const res = await fetch("/api/terminal/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd: opts.cwd,
            name: derivedName,
            project: targetProject,
          }),
        });
        if (!res.ok) return;
        const created = await res.json();
        try {
          localStorage.setItem(
            `panel-terminal-focus-${targetProject}`,
            created.id,
          );
        } catch {
          // ignore
        }
        navTo(`/project/${targetProject}/iterm`);
      } catch {
        // ignore
      }
    },
    [projectName, terminal, navTo, allSessions],
  );

  useITermShortcuts({
    active,
    sessions: terminal.sessions,
    focusedId: terminal.focusedId,
    setFocusedId: terminal.setFocusedId,
    projects,
    navTo,
    maximized,
    setMaximized,
  });

  return (
    <TerminalsSurface
      currentProject={projectName}
      projects={projects}
      repos={project?.repos}
      sessions={terminal.sessions}
      focusedId={terminal.focusedId}
      onFocus={terminal.setFocusedId}
      onDeleteSession={terminal.deleteSession}
      onUpdateSession={terminal.updateSession}
      allSessions={allTerminals.sessions}
      maximized={maximized}
      onToggleMaximize={toggleMaximized}
      drawerOpen={drawerOpen}
      onSetDrawerOpen={setDrawerOpen}
      terminalHandlesRef={terminalHandlesRef}
      onCreateTerminal={(opts) => {
        void createTerminal(opts || {});
      }}
      onNavTo={navTo}
      onReorder={terminal.reorder}
      onSwap={terminal.swapOrder}
      fill={fill}
    />
  );
}
