import { createTerminalSession } from "../terminal/createTerminalSession";
import { getSessions, refreshSessions } from "../terminal/sessionStore";
import { nextProjectName } from "../terminal/useTerminalSessions";

/**
 * Creates a terminal session in `project` whose cwd is the Code view's checkout
 * root (the main checkout or the selected worktree), named `<repoName>-N`.
 * Resolves with the new session id, or null when the create failed. Focus and
 * navigation are the caller's: it knows whether the drawer is showing.
 */
export async function openCodeTerminal(opts: {
  project: string;
  root: string;
  repoName: string;
}): Promise<string | null> {
  const { project, root, repoName } = opts;
  // Fresh list, not the store's cached one: the store starts lazily, so with no
  // terminal surface mounted yet it would still be empty. `refreshSessions`
  // swallows its own failures — a stale list only costs a name collision.
  await refreshSessions();
  const sessions = getSessions().filter((s) => s.project === project);
  // `nextProjectName` counts only sessions whose `project` equals its first
  // argument; re-labelling the project's own sessions with the repo name makes
  // it count `<repoName>-N` among them even when the repo and project differ.
  const asRepo = sessions.map((s) => ({ ...s, project: repoName }));
  const created = await createTerminalSession(project, sessions, {
    cwd: root,
    name: nextProjectName(repoName, asRepo),
  });
  return created?.id ?? null;
}
