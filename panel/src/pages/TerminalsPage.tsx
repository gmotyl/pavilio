import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAllTerminalSessions } from "../features/terminal/useAllTerminalSessions";
import { useTerminalMaximized } from "../features/terminal/useTerminalMaximized";
import TerminalsSurface from "../features/terminal/TerminalsSurface";
import { useProjects } from "../features/projects/useProjects";
import type { TerminalHandle } from "../features/terminal/TerminalView";

export default function TerminalsPage() {
  const { sessions: allSessions } = useAllTerminalSessions();
  const projects = useProjects();
  const [maximized, toggleMaximized] = useTerminalMaximized("__all__");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const terminalHandlesRef = useRef<Map<string, TerminalHandle>>(new Map());
  const navigate = useNavigate();

  return (
    <div className="p-4 h-full">
      <h1 className="text-xl font-semibold mb-4">All terminals</h1>
      <TerminalsSurface
        currentProject=""
        projects={projects}
        repos={undefined}
        sessions={allSessions}
        allSessions={allSessions}
        focusedId={focusedId}
        onFocus={setFocusedId}
        onDeleteSession={() => {
          /* read-only global view */
        }}
        onUpdateSession={() => {
          /* read-only global view */
        }}
        maximized={maximized}
        onToggleMaximize={toggleMaximized}
        drawerOpen={drawerOpen}
        onSetDrawerOpen={setDrawerOpen}
        terminalHandlesRef={terminalHandlesRef}
        onCreateTerminal={() => {
          /* read-only: create inside a project */
        }}
        onNavTo={(path) => navigate(path)}
      />
    </div>
  );
}
