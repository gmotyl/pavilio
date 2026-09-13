import { useEffect, useRef, useState } from "react";
import type { SessionMeta } from "./useTerminalSessions";
import { useTerminalOrdering } from "./useTerminalOrdering";
import { getSessions, refreshSessions, subscribeSessions } from "./sessionStore";

/**
 * Scope key for the cross-project terminals page. Shared verbatim with
 * `useTerminalMaximized("__all__")` and the shipped `panel-terminal-order-__all__`
 * key, so it cannot be renamed without orphaning stored state. Invariant: no
 * project may be named `__all__` — it would share order/layout storage with
 * this page.
 */
const ALL_SCOPE = "__all__";

/**
 * The tab's cross-project session list, plus this consumer's own ordering of it.
 *
 * The list comes from `sessionStore` — one fetch, one poll and one realtime
 * refetch for the whole tab, however many surfaces read it. The ordering stays
 * here rather than in the store: it is reducer-plus-localStorage state, and each
 * mounted consumer keeps its own (see `design.md` §4).
 */
export function useAllTerminalSessions() {
  const [sessions, setSessions] = useState<SessionMeta[]>(getSessions);

  // The store republishes the same array reference while nothing moved, so a
  // quiet poll tick or realtime frame costs this consumer no render at all.
  useEffect(() => subscribeSessions(setSessions), []);

  // Same ordering model as a per-project surface, under the `__all__` scope —
  // so Ctrl+drag merge/join/split and the preset picker commit here too.
  const ordering = useTerminalOrdering(ALL_SCOPE, sessions);
  const { syncIds } = ordering;

  // The sync used to hang off the hook's own fetch; with the fetch gone it hangs
  // off the list itself, which is the thing it actually cares about. Reference
  // stability is what makes that safe: an unchanged republish is the same array,
  // so this fires once per real change rather than on every tick.
  const listSeen = useRef(false);
  useEffect(() => {
    // An empty list before the store's first load means "not known yet", not "no
    // terminals open" — and syncing it would merge the stored order and tiling
    // down to nothing, discarding the saved grid a moment before the real list
    // arrives. Once a list has been seen, an empty one is a genuine close-all and
    // must sync.
    if (sessions.length === 0 && !listSeen.current) return;
    listSeen.current = true;
    syncIds(sessions.map((s) => s.id));
  }, [sessions, syncIds]);

  return {
    sessions: ordering.orderedSessions,
    // Tab-wide: one refetch serves every consumer, and it resolves once the new
    // list has been published to all of them.
    refresh: refreshSessions,
    reorder: ordering.reorder,
    // A plain drag swaps identity in the order *and* in the layout, matching
    // the per-project surface's swapSessions.
    tiles: ordering.tiles,
    placeTiles: ordering.placeTiles,
    applyPreset: ordering.applyPreset,
  };
}
