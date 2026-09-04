import { useSyncExternalStore } from "react";

const OS_USERS_URL = "/api/terminal/os-users";

// Not `Object.freeze`d (unlike `useProjectColors.ts`'s `EMPTY`): a frozen
// array literal narrows to `readonly never[]`, which cannot be widened back
// to a mutable `{ username: string }[]` without an `unknown` cast. The
// module never mutates this constant in place — only `publish` ever
// *replaces* the store's array — so the immutability freeze would buy stays
// a convention here, not a runtime guarantee.
const EMPTY: { username: string }[] = [];

/**
 * Module-level store, not per-component state.
 *
 * The toolbar dropdown and any other reader all want the same discovered
 * account list, which the server caches for the whole process lifetime
 * anyway — a `useEffect` fetch inside the hook would put one request per
 * mounted consumer on the wire. The store fetches once on the first
 * subscription and fans the result out through `useSyncExternalStore`, the
 * same idiom `useProjectColors.ts` uses.
 */
let users: { username: string }[] = EMPTY;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/**
 * `getSnapshot` hands back this array by identity, so it must only ever be
 * *replaced*, never mutated — React compares snapshots with `Object.is` and
 * warns ("The result of getSnapshot should be cached") if a fresh array
 * comes back from an unchanged store.
 */
function publish(next: { username: string }[]): void {
  users = next;
  for (const l of listeners) l();
}

function getSnapshot(): { username: string }[] {
  return users;
}

async function load(): Promise<void> {
  try {
    const res = await fetch(OS_USERS_URL);
    if (!res.ok) return;
    const body = (await res.json()) as { username: string }[];
    publish(Array.isArray(body) ? body : EMPTY);
  } catch {
    // Offline or a dead server: an empty list is a fine resting state, and
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

/** Drop all shared state. Tests only — the store is a page-lifetime singleton. */
export function __resetOsUsersForTests(): void {
  users = EMPTY;
  loading = null;
  listeners.clear();
}

/**
 * The panel host's discovered OS login accounts, shared across every
 * consumer. Read-only: the list is server-cached for the process lifetime,
 * so there is no client-side setter — a new account requires a panel
 * restart to appear.
 */
export function useOsUsers(): { users: { username: string }[] } {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { users: snapshot };
}
