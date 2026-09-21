import {
  nextProjectName,
  writeTerminalFocus,
  type SessionMeta,
  type CreateSessionOpts,
} from "./useTerminalSessions";

/**
 * Create a terminal session in `project` via the API, persisting focus so the
 * iTerm tab selects it on mount. Returns the created session, or null on
 * failure. Caller handles navigation and any UI feedback.
 */
export async function createTerminalSession(
  project: string,
  existingSessions: SessionMeta[],
  opts: CreateSessionOpts = {},
): Promise<SessionMeta | null> {
  const name = opts.name || nextProjectName(project, existingSessions);
  try {
    const res = await fetch("/api/terminal/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: opts.cwd, name, project }),
    });
    if (!res.ok) return null;
    const created: SessionMeta = await res.json();
    // Persist BEFORE the caller dispatches the focus broadcast: LeftSidebar
    // drops a broadcast whose project does not match the one it is showing and
    // re-reads the stored focus after the switch, so a writer that dispatched
    // first would lose the focus across a project navigation.
    writeTerminalFocus(project, created.id);
    return created;
  } catch {
    return null;
  }
}
