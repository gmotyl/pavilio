import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { startTaskRun } from "./startTaskRun";
import { dispatchTerminalFocus } from "../terminal/useTerminalSessions";
import { useTerminalDrawerVisible } from "../terminal/useTerminalDrawer";

/**
 * Starts a session in `project` typing `line`, then lands where the terminal
 * shows: the focus is already stored by the create and the broadcast tells a
 * mounted Terminal view (the drawer included); only with the drawer not
 * visible does the panel navigate to the Terminals page to show it. Rejects
 * with the launch error so each caller reports it in its own place.
 */
export function useLaunchRun(project: string): (line: string) => Promise<void> {
  const navigate = useNavigate();
  // `useTerminalDrawerVisible` rather than `useTerminalDrawer().visible`: the
  // same flag, but false (not a throw) outside a drawer provider.
  const drawerVisible = useTerminalDrawerVisible();
  return useCallback(
    async (line: string) => {
      const sessionId = await startTaskRun({ project, runLine: line });
      dispatchTerminalFocus(project, sessionId);
      if (!drawerVisible) navigate(`/project/${encodeURIComponent(project)}/iterm`);
    },
    [project, navigate, drawerVisible],
  );
}
