import { useCallback, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAllTerminalSessions } from "../features/terminal/useAllTerminalSessions";
import { useTerminalMaximized } from "../features/terminal/useTerminalMaximized";
import TerminalsSurface from "../features/terminal/TerminalsSurface";
import { useProjects } from "../features/projects/useProjects";
import { destroyTerminal } from "../features/terminal/terminalInstances";
import type { TerminalHandle } from "../features/terminal/TerminalView";

export default function TerminalsPage() {
  const { sessions: allSessions, refresh } = useAllTerminalSessions();
  const projects = useProjects();
  const [maximized, toggleMaximized] = useTerminalMaximized("__all__");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const terminalHandlesRef = useRef<Map<string, TerminalHandle>>(new Map());
  const navigate = useNavigate();

  // Global-view delete: works for any session regardless of owning project.
  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/terminal/sessions/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          console.warn(
            `[terminals-page] DELETE session ${id} returned ${res.status}`,
          );
          return;
        }
        destroyTerminal(id);
        if (focusedId === id) setFocusedId(null);
        await refresh();
      } catch (err) {
        console.warn(`[terminals-page] delete session ${id} failed:`, err);
      }
    },
    [refresh, focusedId],
  );

  // Global-view rename/recolor: same shape as the per-project update.
  const handleUpdate = useCallback(
    async (
      id: string,
      patch: { name?: string; color?: string | null },
    ) => {
      try {
        const res = await fetch(`/api/terminal/sessions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          console.warn(
            `[terminals-page] PATCH session ${id} returned ${res.status}`,
          );
          return;
        }
        await refresh();
      } catch (err) {
        console.warn(`[terminals-page] update session ${id} failed:`, err);
      }
    },
    [refresh],
  );

  return (
    <TerminalsSurface
      standalone
      currentProject=""
      projects={projects}
      repos={undefined}
      sessions={allSessions}
      allSessions={allSessions}
      focusedId={focusedId}
      onFocus={setFocusedId}
      onDeleteSession={handleDelete}
      onUpdateSession={handleUpdate}
      maximized={maximized}
      onToggleMaximize={toggleMaximized}
      drawerOpen={drawerOpen}
      onSetDrawerOpen={setDrawerOpen}
      terminalHandlesRef={terminalHandlesRef}
      onCreateTerminal={() => {
        /* global view: create inside a project */
      }}
      onNavTo={(path) => navigate(path)}
    />
  );
}
