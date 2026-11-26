import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "../realtime/useWebSocket";
import type { RemoteBranch } from "./branchTypes";

export type { RemoteBranch };

interface Listing {
  root: string | null;
  current: string | null;
  local: string[];
  remote: RemoteBranch[];
}

interface FetchState {
  root: string | null;
  fetching: boolean;
  error: string;
}

/**
 * When each root was last fetched, for this page only. Module-level so a
 * remount of the same checkout shares it; keyed by root so it never leaks.
 */
const lastFetch = new Map<string, number>();

const emptyListing = (root: string | null): Listing => ({ root, current: null, local: [], remote: [] });

/**
 * Local and remote branches of one checkout, re-read on `git-change` and on
 * `root` change, plus `fetch()` (`git fetch` all remotes, then re-list).
 * Checkout itself stays in `useGitChanges`, which serialises git mutations.
 */
export function useBranches(root: string | null) {
  const [listing, setListing] = useState<Listing>(() => emptyListing(root));
  const [fetchState, setFetchState] = useState<FetchState>({ root, fetching: false, error: "" });
  const rootRef = useRef(root);
  rootRef.current = root;
  // Newest answer wins: a slow answer for a left root, or one older than an
  // answer already applied for this root, is dropped. A failed request does
  // not advance `applied`, so it never discards an earlier success; a
  // successful fetch raises it past every listing issued before it.
  const seq = useRef(0);
  const applied = useRef(0);

  const list = useCallback(async (r: string) => {
    // A request for a left root must not bump seq, or it drops the current
    // root's in-flight listing.
    if (r !== rootRef.current) return;
    const mine = ++seq.current;
    try {
      const res = await fetch(`/api/git/branches?repo=${encodeURIComponent(r)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (mine <= applied.current || rootRef.current !== r) return;
      applied.current = mine;
      setListing({ root: r, current: data.current ?? null, local: data.local ?? [], remote: data.remote ?? [] });
    } catch {}
  }, []);

  const { lastMessage } = useWebSocket();

  useEffect(() => {
    if (root) list(root);
  }, [root, list]);

  useEffect(() => {
    if (lastMessage?.type !== "git-change" || !rootRef.current) return;
    list(rootRef.current);
  }, [lastMessage, list]);

  const fetchRemotes = useCallback(
    async (opts?: { ifStaleMs?: number }) => {
      const r = rootRef.current;
      if (!r) return;
      const last = lastFetch.get(r);
      if (opts?.ifStaleMs !== undefined && last !== undefined && Date.now() - last < opts.ifStaleMs) return;
      setFetchState({ root: r, fetching: true, error: "" });
      try {
        const res = await fetch("/api/git/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo: r }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Fetch failed");
        lastFetch.set(r, Date.now());
        // Listings issued before the fetch read pre-fetch refs: drop them even if
        // the re-list below fails. Unrelated failures still keep last-good data.
        if (rootRef.current === r) applied.current = Math.max(applied.current, seq.current);
        await list(r);
        // Only end this root's fetch; another root's in-flight one stays.
        setFetchState((s) => (s.root === r ? { root: r, fetching: false, error: "" } : s));
      } catch (e: any) {
        const error = e?.message || "Fetch failed";
        setFetchState((s) => (s.root === r ? { root: r, fetching: false, error } : s));
      }
    },
    [list],
  );

  // State tagged with another root is never shown for this one.
  const shown = listing.root === root ? listing : emptyListing(root);
  const op = fetchState.root === root ? fetchState : { fetching: false, error: "" };

  return {
    current: shown.current,
    local: shown.local,
    remote: shown.remote,
    fetchedAt: root ? (lastFetch.get(root) ?? null) : null,
    fetching: op.fetching,
    fetchError: op.error,
    fetch: fetchRemotes,
  };
}
