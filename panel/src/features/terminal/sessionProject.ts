import { isPreferenceScope } from "../../preferences/types";
import { getSessions } from "./sessionStore";

/**
 * The project a cell belongs to, for use as a preference scope argument, or
 * `null` when the tab's session list cannot name one.
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
 * ## When it answers `null`
 *
 * Three ways, and none of them is hypothetical.
 *
 * A session the store has never carried. `QuickTerminalModal` is mounted
 * app-wide in `App.tsx` and opens on Cmd/Ctrl+O from any project route; it
 * fetches `/api/terminal/sessions` itself, into its own `useState`, and never
 * touches `sessionStore`. So the cell it mounts — a full `TerminalView`, answer
 * pane and all — is drawn off a list that is a SEPARATE request from the
 * store's, and a session present in one is not thereby present in the other.
 *
 * A store that has not loaded yet, or whose load failed. `load()` keeps the
 * list it already has when the fetch throws, answers non-2xx, or returns a
 * non-array 200 — and before the first success that list is `[]`. The poll
 * retries on an 8s interval, so every cell on screen is unresolvable for the
 * length of that window, however many cells that is.
 *
 * A session carrying no project. `POST /api/terminal/sessions` destructures
 * `project = ""` out of the request body and stores whatever it got, so a blank
 * is a shape the server hands out rather than one only a test can build. A
 * blank project is a MISSING project, not a project — see `isPreferenceScope`,
 * which is the predicate this shares with every other scope site in the panel.
 *
 * `null` rather than a placeholder name is the whole point: a placeholder is a
 * key, and a key can be WRITTEN to. Every unnameable cell would then share one
 * number, under a key nothing reads back once the project does resolve — so the
 * user's drag would be silently discarded. `useScopedPreference` takes the
 * `null` instead and does what an unresolved scope is supposed to do: read the
 * declared default, and persist nothing.
 *
 * ## Why it does not subscribe
 *
 * Not to save a fetch or a timer — it would save neither. `start()` is
 * `if (started) return`-guarded, so the store runs one `load()` and one 8s
 * interval per tab however many subscribers it has, and `TimeTrackingProvider`
 * sits above the routes in `App.tsx` and subscribes at boot, so the store is
 * already running before any pane can mount.
 *
 * What subscribing would cost is a re-render of every open answer pane every
 * time the tab-wide list really changes — a session opened, killed or renamed
 * anywhere in the panel, in any project — to learn a value that, for this pane,
 * cannot change: a session never moves to another project.
 *
 * What that leaves is a pane that resolved to `null` staying there until
 * something else re-renders it. This is a plain read during render, so a pane
 * picks the project up on its next render for any reason at all — a speech
 * frame, a queue change, a cell resize — and what it lives with until then is a
 * default height that is not written down. That is the same cost the `null`
 * already accepts, so it does not buy a subscription.
 */
export function projectOfSession(sessionId: string): string | null {
  const project = getSessions().find((session) => session.id === sessionId)?.project;
  return isPreferenceScope(project) ? project.trim() : null;
}
