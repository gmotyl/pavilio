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

  let created: SessionMeta;
  // The try covers the CALL, and nothing past it. A session the server created
  // exists whether or not this page manages to remember it, so a throw from the
  // focus write must not come back as `null` — the caller reads that as
  // "creation failed", skips the navigation and the focus broadcast, and leaves
  // a live terminal nobody is looking at.
  try {
    const res = await fetch("/api/terminal/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: opts.cwd, name, project }),
    });
    if (!res.ok) return null;
    created = (await res.json()) as SessionMeta;
  } catch {
    return null;
  }

  // Persist BEFORE the caller dispatches the focus broadcast: LeftSidebar
  // drops a broadcast whose project does not match the one it is showing and
  // re-reads the stored focus after the switch, so a writer that dispatched
  // first would lose the focus across a project navigation.
  //
  // Guarded rather than left to propagate: a lost focus makes the next mount
  // select a different tab — a worse session, not a failed one, and not
  // something to report a created terminal as missing over.
  try {
    writeTerminalFocus(project, created.id);
  } catch (err) {
    console.warn("[terminal] session created, but its focus could not be remembered:", err);
  }

  return created;
}
