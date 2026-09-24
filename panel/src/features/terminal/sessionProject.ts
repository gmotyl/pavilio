import { getSessions } from "./sessionStore";

/**
 * The scope a cell whose project cannot be named falls back to.
 *
 * `storageKey` throws on a blank scope argument rather than letting every
 * project share one key, and a preference read that throws would take the
 * whole pane down — so a cell with no project reads and writes here instead.
 * It is a bucket, not a project: whatever lands in it is shared by every
 * unnameable cell and named after none of them.
 *
 * It should not be reachable in the panel. A cell exists because the tab's
 * session list produced it, and that list is exactly what {@link projectOfSession}
 * reads, so by the time a pane is mounted the session is in it. What this
 * covers is the gap between those two facts in a test harness that renders a
 * pane directly, and a server that has answered `/api/terminal/sessions` with
 * a session carrying no `project` — `server/lib/discovery.ts` validates
 * nothing, so that is a real shape rather than a hypothetical one.
 */
export const UNKNOWN_PROJECT = "__unknown__";

/**
 * The project a cell belongs to, for use as a preference scope argument.
 *
 * ## Why the session store, and not a prop
 *
 * The project is per-cell, but no cell holds it: `TerminalView` is handed a
 * `sessionId` and nothing else, and it is rendered by the grid, the mobile
 * rail, the maximized stack and the quick modal — so threading `project` down
 * to the answer pane would add a prop to four hosts and a view that none of
 * them would read. `sessionStore` is the tab's one list, keyed by exactly the
 * id every one of those surfaces already has, and it is what the grids
 * themselves resolve a session through. `LauncherPills` reached the same
 * conclusion for the same reason, and this is that answer with a name.
 *
 * ## Why it does not subscribe
 *
 * It is a plain read, so a caller gets the list as it stands rather than
 * re-rendering when it moves. That is enough here: a pane is mounted by a cell
 * that the list itself produced, so the session is already in it, and a
 * session never changes the project it belongs to. Subscribing would start the
 * store's poll from inside a pane — a fetch and an 8s interval per open
 * answer — to learn a value that cannot change.
 *
 * A blank project is a MISSING project, not a project (see `isPreferenceScope`),
 * so it resolves to {@link UNKNOWN_PROJECT} along with an unknown id.
 */
export function projectOfSession(sessionId: string): string {
  const project = getSessions().find((session) => session.id === sessionId)?.project?.trim();
  return project ? project : UNKNOWN_PROJECT;
}
