import { useSyncExternalStore } from "react";

const DEFAULT_USERS_URL = "/api/projects/default-terminal-users";

const EMPTY: Record<string, string> = Object.freeze({});

/**
 * Module-level store, not per-component state.
 *
 * The toolbar dropdown (and any future reader) all want the same
 * project → default-user map, so a `useEffect` fetch inside the hook would
 * put one request per mounted consumer on the wire. The store fetches once
 * on the first subscription and fans the result out through
 * `useSyncExternalStore`, the same idiom `useProjectColors.ts` uses.
 */
let defaultUsers: Record<string, string> = EMPTY;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/**
 * `getSnapshot` hands back this object by identity, so it must only ever be
 * *replaced*, never mutated — React compares snapshots with `Object.is` and
 * warns ("The result of getSnapshot should be cached") if a fresh object
 * comes back from an unchanged store.
 */
function publish(next: Record<string, string>): void {
  defaultUsers = next;
  for (const l of listeners) l();
}

function getSnapshot(): Record<string, string> {
  return defaultUsers;
}

async function load(): Promise<void> {
  try {
    const res = await fetch(DEFAULT_USERS_URL);
    if (!res.ok) return;
    const body = (await res.json()) as { users?: Record<string, string> };
    publish(body.users ?? EMPTY);
  } catch {
    // Offline or a dead server: an empty map is a fine resting state, and
    // the next reload retries. No polling, no retry loop.
  }
}

/**
 * Fetch exactly once per page load. The guard is the promise itself rather
 * than a "did it finish" flag, so the second of `<StrictMode>`'s double-invoked
 * effects joins the in-flight request instead of starting another one.
 */
function ensureLoaded(): void {
  if (loading) return;
  loading = load();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  ensureLoaded();
  return () => {
    listeners.delete(onStoreChange);
  };
}

/**
 * Write one project's default terminal user: applied optimistically so the
 * UI moves at once, rolled back if the server refuses. The response is
 * `{ ok: true }` and carries no map, so a success needs no refetch — the
 * value just sent is the truth.
 *
 * Rejects on failure (after rolling back) so the caller can report it;
 * callers that do not care must still `.catch()`.
 *
 * The rollback restores *this project's key only*, onto whatever the map
 * holds at the moment it fails. Snapshotting the whole map and republishing
 * it would undo any other project's write that landed while this one was in
 * flight — two pickers moving at once, and the loser's default silently
 * reappears.
 */
async function setDefaultUser(
  project: string,
  username: string,
): Promise<void> {
  // The map only ever holds usernames, so `undefined` unambiguously means
  // "this project had no entry" — and rolling that back has to *remove* the
  // key.
  const previous: string | undefined = Object.prototype.hasOwnProperty.call(
    defaultUsers,
    project,
  )
    ? defaultUsers[project]
    : undefined;

  const rollback = (): void => {
    const next = { ...defaultUsers };
    if (previous === undefined) delete next[project];
    else next[project] = previous;
    publish(next);
  };

  publish({ ...defaultUsers, [project]: username });
  let res: Response;
  try {
    res = await fetch(
      `/api/projects/${encodeURIComponent(project)}/default-terminal-user`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      },
    );
  } catch (err) {
    rollback();
    throw err;
  }
  if (!res.ok) {
    rollback();
    throw new Error(
      `Failed to set default terminal user for ${project} (${res.status})`,
    );
  }
}

/** Drop all shared state. Tests only — the store is a page-lifetime singleton. */
export function __resetDefaultTerminalUsersForTests(): void {
  defaultUsers = EMPTY;
  loading = null;
  listeners.clear();
}

/**
 * The workspace's project → default terminal user map, shared across every
 * consumer. `defaultUsers` is the read path; `setDefaultUser` is the write
 * path.
 */
export function useDefaultTerminalUsers(): {
  defaultUsers: Record<string, string>;
  setDefaultUser: (project: string, username: string) => Promise<void>;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { defaultUsers: snapshot, setDefaultUser };
}
