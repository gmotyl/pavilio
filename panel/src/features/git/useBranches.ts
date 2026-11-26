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
  // Only the latest listing request may land: a slow answer for a left root
  // (or an older one for this root) is dropped.
  const seq = useRef(0);

  const list = useCallback(async (r: string) => {
    const mine = ++seq.current;
    try {
      const res = await fetch(`/api/git/branches?repo=${encodeURIComponent(r)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (mine !== seq.current || rootRef.current !== r) return;
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
        await list(r);
        setFetchState({ root: r, fetching: false, error: "" });
      } catch (e: any) {
        setFetchState({ root: r, fetching: false, error: e?.message || "Fetch failed" });
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
