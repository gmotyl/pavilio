import { useCallback, useSyncExternalStore } from "react";

/**
 * Shown for a project the map does not (yet) cover — during the first load,
 * and for a name the server has never discovered. A fixed neutral token, so a
 * project never flashes another project's colour on the way to its own.
 */
export const PROJECT_COLOR_PLACEHOLDER = "var(--border-subtle)";

const COLORS_URL = "/api/projects/colors";

const EMPTY: Record<string, string> = Object.freeze({});

/**
 * Module-level store, not per-component state.
 *
 * Every chip, cell header, mobile dot and drawer row asks for a colour, so a
 * `useEffect` fetch inside the hook would put one request per terminal on the
 * wire. The store fetches once on the first subscription and fans the result
 * out through `useSyncExternalStore`, the same idiom as `lib/toast.ts` and
 * `terminalInstances`.
 */
let colors: Record<string, string> = EMPTY;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/**
 * `getSnapshot` hands back this object by identity, so it must only ever be
 * *replaced*, never mutated — React compares snapshots with `Object.is` and
 * warns ("The result of getSnapshot should be cached") if a fresh object comes
 * back from an unchanged store.
 */
function publish(next: Record<string, string>): void {
  colors = next;
  for (const l of listeners) l();
}

function getSnapshot(): Record<string, string> {
  return colors;
}

async function load(): Promise<void> {
  try {
    const res = await fetch(COLORS_URL);
    if (!res.ok) return;
    const body = (await res.json()) as { colors?: Record<string, string> };
    publish(body.colors ?? EMPTY);
  } catch {
    // Offline or a dead server: the placeholder is a fine resting state, and
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
 * Write one project's colour: applied optimistically so the UI moves at once,
 * rolled back if the server refuses. The response is `{ ok: true }` and carries
 * no map, so a success needs no refetch — the value just sent is the truth.
 *
 * Rejects on failure (after rolling back) so the caller can report it; callers
 * that do not care must still `.catch()`.
 *
 * The rollback restores *this project's key only*, onto whatever the map holds
 * at the moment it fails. Snapshotting the whole map and republishing it would
 * undo any other project's write that landed while this one was in flight —
 * two pickers moving at once, and the loser's colour silently reappears.
 */
async function setProjectColor(project: string, hex: string): Promise<void> {
  // The map only ever holds hex strings, so `undefined` unambiguously means
  // "this project had no entry" — and rolling that back has to *remove* the
  // key. An own key set to `undefined` would defeat `colorFor`'s `??`
  // placeholder fallback and survive into any JSON the map is written to.
  const previous: string | undefined = Object.prototype.hasOwnProperty.call(
    colors,
    project,
  )
    ? colors[project]
    : undefined;

  const rollback = (): void => {
    const next = { ...colors };
    if (previous === undefined) delete next[project];
    else next[project] = previous;
    publish(next);
  };

  publish({ ...colors, [project]: hex });
  let res: Response;
  try {
    res = await fetch(`/api/projects/${encodeURIComponent(project)}/color`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hex }),
    });
  } catch (err) {
    rollback();
    throw err;
  }
  if (!res.ok) {
    rollback();
    throw new Error(`Failed to set colour for ${project} (${res.status})`);
  }
}

/** Drop all shared state. Tests only — the store is a page-lifetime singleton. */
export function __resetProjectColorsForTests(): void {
  colors = EMPTY;
  loading = null;
  listeners.clear();
}

/**
 * The workspace's project → colour map, shared across every consumer.
 *
 * `colorFor` is the read path; it never throws and never leaves a project
 * colourless. `setColor` is the write path.
 */
export function useProjectColors(): {
  colorFor: (project: string) => string;
  setColor: (project: string, hex: string) => Promise<void>;
  colors: Record<string, string>;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const colorFor = useCallback(
    (project: string) => snapshot[project] ?? PROJECT_COLOR_PLACEHOLDER,
    [snapshot],
  );

  return { colorFor, setColor: setProjectColor, colors: snapshot };
}
