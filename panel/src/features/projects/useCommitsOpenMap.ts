import { useCallback, useEffect, useReducer, useRef } from "react";
import { preferences } from "../../preferences/declarations";
import {
  readPreference,
  subscribePreference,
  writePreference,
} from "../../preferences/store";

/**
 * Whether each repository's commits pane is open.
 *
 * This used to be one JSON blob keyed by repo path. It is now one repo-scoped
 * preference per repository, so a tilde-spelled path and its absolute form
 * normalize onto a single key — which a blob's inner keys never could.
 *
 * `isOpen` is asked about arbitrary, dynamically many repositories while the
 * repo list renders, so there can be no `usePreference` per repository: the
 * number of hooks would change between renders. Reads go straight to the store
 * instead, and a render token stands in for the state this hook used to hold.
 * The paths asked about are collected as they are read and subscribed once the
 * render is over, so another tab's change still reaches the pane.
 *
 * The default is `true`: the old `isOpen` was `map[repoPath] !== false`, so a
 * repository with no entry has always read as OPEN. `{}` was the map's initial
 * value, not a closed default.
 */
/**
 * Whether a repo path can be a preference SCOPE at all.
 *
 * The `typeof` half is the whole point. Every blank-scope guard added to
 * satisfy `storageKey`'s throw became a NEW throw site for `undefined`:
 * `server/lib/discovery.ts` does no runtime validation, so a `repos.json` entry
 * with no `path` reaches the client as `undefined`, and `repoPath.trim()` then
 * throws a TypeError — here, during render, taking the repo list with it.
 * `typeof x === "string" && x.trim() !== ""` is the shape that actually holds.
 */
function isRepoScope(repoPath: string): boolean {
  return typeof repoPath === "string" && repoPath.trim() !== "";
}

export function useCommitsOpenMap() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  /** Every repo path read this session, subscribed or not yet. */
  const watched = useRef(new Set<string>());
  const subscriptions = useRef(new Map<string, () => void>());

  const isOpen = useCallback((repoPath: string) => {
    // An unresolved path is not a scope: the store rejects one rather than
    // letting every repository share a key, and this is the render path.
    if (!isRepoScope(repoPath)) return preferences.commitsOpen.default;
    // A ref mutated during render, and deliberately so: which repositories are
    // on screen is knowable only from the render that asks. It is benign under
    // StrictMode's double invoke — `Set.add` is idempotent, and the effect
    // below subscribes each path once — but it is impure, so nothing may be
    // derived from `watched.current` during a render.
    watched.current.add(repoPath);
    return readPreference(preferences.commitsOpen, repoPath);
  }, []);

  const setOpen = useCallback((repoPath: string, open: boolean) => {
    if (!isRepoScope(repoPath)) return;
    writePreference(preferences.commitsOpen, open, repoPath);
    rerender();
  }, []);

  // No dependency list: which repositories are on screen is known only after
  // the render that read them, and it changes with the project.
  useEffect(() => {
    for (const repoPath of watched.current) {
      if (subscriptions.current.has(repoPath)) continue;
      subscriptions.current.set(
        repoPath,
        subscribePreference(preferences.commitsOpen, repoPath, rerender),
      );
    }
  });

  // Subscriptions are released only on unmount, never when a repository leaves
  // the list: a repo scrolled out of the project keeps a live handle for the
  // life of the hook. Bounded by the number of repositories a session ever
  // looks at and each handle is a Set entry, so this is a few dozen closures at
  // worst — pruning would mean diffing `watched` against the last render, which
  // costs more than it saves.
  const live = subscriptions.current;
  useEffect(
    () => () => {
      for (const unsubscribe of live.values()) unsubscribe();
      live.clear();
    },
    [live],
  );

  return { isOpen, setOpen };
}
