import {
  nextProjectName,
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
    try {
      localStorage.setItem(`panel-terminal-focus-${project}`, created.id);
    } catch {
      // ignore
    }
    return created;
  } catch {
    return null;
  }
}
