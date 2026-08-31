import { useState, useEffect, useCallback, useMemo } from "react";
import { destroyTerminal } from "./terminalInstances";
import { reorderIds, swapIds, mergeOrder } from "./sessionOrder";
import {
  reconcileLayout,
  mergeInColumn,
  joinOtherColumn,
  splitToNewColumn,
  expandPreset,
  swapInLayout,
  type ColumnLayout,
} from "./columnLayout";

export const TERMINAL_FOCUS_EVENT = "panel-terminal-focus";

export interface TerminalFocusEventDetail {
  project: string;
  sessionId: string;
}

export function dispatchTerminalFocus(
  project: string,
  sessionId: string,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<TerminalFocusEventDetail>(TERMINAL_FOCUS_EVENT, {
      detail: { project, sessionId },
    }),
  );
}

export interface SessionMeta {
  id: string;
  name: string;
  color: string | null;
  project: string;
  cwd: string;
  pid: number;
  createdAt: string;
}

export interface SessionGroup {
  color: string;
  name: string;
  sessions: SessionMeta[];
}

export interface CreateSessionOpts {
  project?: string;
  cwd?: string;
  name?: string;
}

export function nextProjectName(
  project: string,
  existing: SessionMeta[],
): string {
  // Collect numeric suffixes already in use for "{project}-N"
  const used = new Set<number>();
  const rx = new RegExp(`^${project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);
  for (const s of existing) {
    if (s.project !== project) continue;
    const m = rx.exec(s.name);
    if (m) used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n++;
  return `${project}-${n}`;
}

export function useTerminalSessions(project: string) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [focusedId, setFocusedIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(`panel-terminal-focus-${project}`);
    } catch (err) {
      console.warn(`[terminal] read focus from localStorage failed:`, err);
      return null;
    }
  });

  const setFocusedId = useCallback(
    (id: string | null) => {
      setFocusedIdState(id);
      try {
        if (id) {
          localStorage.setItem(`panel-terminal-focus-${project}`, id);
        } else {
          localStorage.removeItem(`panel-terminal-focus-${project}`);
        }
      } catch (err) {
        console.warn(`[terminal] write focus to localStorage failed:`, err);
      }
      // Broadcast so other surfaces (sidebar, mobile rail) stay in sync
      // when focus changes from the iTerm grid/spine.
      if (id) dispatchTerminalFocus(project, id);
    },
    [project],
  );

  const ORDER_KEY = `panel-terminal-order-${project}`;
  const LAYOUT_KEY = `panel-terminal-layout-${project}`;
  const OLD_COLUMNS_KEY = `panel-terminal-columns-${project}`;

  const [sessionOrder, setSessionOrder] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(`panel-terminal-order-${project}`);
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
      return [];
    }
  });

  const [columnLayout, setColumnLayout] = useState<ColumnLayout>(() => {
    // The old count-only `panel-terminal-columns-<project>` key is a
    // different shape (number[]) and isn't migrated — just discarded.
    try {
      localStorage.removeItem(OLD_COLUMNS_KEY);
    } catch {
      // ignore
    }
    try {
      const stored = localStorage.getItem(LAYOUT_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? (parsed as ColumnLayout) : [];
    } catch (err) {
      console.warn(`[terminal] read layout from localStorage failed:`, err);
      return [];
    }
  });


  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/terminal/sessions");
      if (!res.ok) {
        console.warn(
          `[terminal] GET /api/terminal/sessions returned ${res.status}`,
        );
        return;
      }
      const data: SessionMeta[] = await res.json();
      const filtered = data.filter((s) => s.project === project);
      setSessions(filtered);
      // Reconcile columnLayout against the PRE-merge sessionOrder (the `prev`
      // that mergeOrder itself consumes below), in the same update cycle as
      // the sessionOrder merge — see columnLayout.reconcileLayout contract.
      setSessionOrder((prev) => {
        const next = mergeOrder(prev, filtered.map((s) => s.id));
        setColumnLayout((prevLayout) =>
          reconcileLayout(prev, prevLayout, next),
        );
        return next;
      });
    } catch (err) {
      console.warn(`[terminal] fetch sessions failed:`, err);
    }
  }, [project]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // When the project changes (no remount — same component instance reused
  // across route navigations), reset state to the new project's stored values.
  useEffect(() => {
    setSessions([]);
    try {
      const storedFocus = localStorage.getItem(`panel-terminal-focus-${project}`);
      setFocusedIdState(storedFocus);
      const storedOrder = localStorage.getItem(`panel-terminal-order-${project}`);
      setSessionOrder(storedOrder ? JSON.parse(storedOrder) : []);
      // The old count-only key is a different shape and isn't migrated.
      localStorage.removeItem(OLD_COLUMNS_KEY);
      const storedLayout = localStorage.getItem(LAYOUT_KEY);
      const parsedLayout = storedLayout ? JSON.parse(storedLayout) : [];
      setColumnLayout(Array.isArray(parsedLayout) ? parsedLayout : []);
    } catch {
      setFocusedIdState(null);
      setSessionOrder([]);
      setColumnLayout([]);
    }
  }, [project]);

  // Listen for "focus this session" broadcasts (e.g. left sidebar click
  // while user is already on this project's iTerm tab, so no remount
  // happens to re-read localStorage). Also refetch sessions: when the
  // sidebar's "+" button creates a session via direct fetch, our local
  // `sessions` state is stale until we refetch — without this, the new
  // session id is set as focusedId but no terminal renders for it.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<TerminalFocusEventDetail>).detail;
      if (!detail || detail.project !== project) return;
      // Use the bare state setter and write localStorage directly — calling
      // setFocusedId here would re-dispatch the event and recurse infinitely.
      setFocusedIdState((current) =>
        current === detail.sessionId ? current : detail.sessionId,
      );
      try {
        localStorage.setItem(
          `panel-terminal-focus-${project}`,
          detail.sessionId,
        );
      } catch {
        // ignore
      }
      // Only refetch if the session isn't already in our list — covers
      // sidebar "+" creates that haven't propagated to our local sessions yet.
      setSessions((prev) => {
        if (!prev.some((s) => s.id === detail.sessionId)) {
          fetchSessions();
        }
        return prev;
      });
    };
    window.addEventListener(TERMINAL_FOCUS_EVENT, handler);
    return () => window.removeEventListener(TERMINAL_FOCUS_EVENT, handler);
  }, [project, fetchSessions]);

  const createSession = useCallback(
    async (opts: CreateSessionOpts = {}) => {
      const targetProject = opts.project ?? project;
      const derivedName =
        opts.name || nextProjectName(targetProject, sessions);
      try {
        const res = await fetch("/api/terminal/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd: opts.cwd,
            name: derivedName,
            project: targetProject,
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.warn(
            `[terminal] POST /api/terminal/sessions failed: ${res.status} ${text}`,
          );
          return;
        }
        const created: SessionMeta = await res.json();
        if (created.project === project) {
          setSessions((prev) => [...prev, created]);
          // Reconcile columnLayout the same way fetchSessions does (see its
          // comment above) — otherwise a custom layout falls out of sync
          // with sessionOrder and the new session is silently missing from
          // the grid until the next poll.
          setSessionOrder((prev) => {
            const next = prev.includes(created.id)
              ? prev
              : [...prev, created.id];
            setColumnLayout((prevLayout) =>
              reconcileLayout(prev, prevLayout, next),
            );
            return next;
          });
          setFocusedId(created.id);
        }
        return created;
      } catch (err) {
        console.warn(`[terminal] create session failed:`, err);
      }
    },
    [project, sessions, setFocusedId],
  );

  const deleteSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/terminal/sessions/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        console.warn(
          `[terminal] DELETE session ${id} returned ${res.status}`,
        );
        return;
      }
      destroyTerminal(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setFocusedIdState((prev) => {
        const next = prev === id ? null : prev;
        try {
          if (next) {
            localStorage.setItem(`panel-terminal-focus-${project}`, next);
          } else {
            localStorage.removeItem(`panel-terminal-focus-${project}`);
          }
        } catch (err) {
          console.warn(
            `[terminal] persist focus after delete failed:`,
            err,
          );
        }
        return next;
      });
    } catch (err) {
      console.warn(`[terminal] delete session ${id} failed:`, err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSession = useCallback(
    async (id: string, patch: { name?: string; color?: string | null }) => {
      try {
        const res = await fetch(`/api/terminal/sessions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          console.warn(
            `[terminal] PATCH session ${id} returned ${res.status}`,
          );
          return;
        }
        setSessions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        );
      } catch (err) {
        console.warn(`[terminal] update session ${id} failed:`, err);
      }
    },
    [],
  );

  // Persist order to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(sessionOrder));
    } catch {
      // ignore
    }
  }, [ORDER_KEY, sessionOrder]);

  // Persist columnLayout to localStorage whenever it changes — remove the key
  // entirely when empty, mirroring useTerminalMaximized's remove-when-falsy
  // convention (an empty array means "no custom layout stored").
  useEffect(() => {
    try {
      if (columnLayout.length === 0) {
        localStorage.removeItem(LAYOUT_KEY);
      } else {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(columnLayout));
      }
    } catch (err) {
      console.warn(`[terminal] write layout to localStorage failed:`, err);
    }
  }, [LAYOUT_KEY, columnLayout]);

  // O(N) index map for sort
  const orderIndex = useMemo(
    () => new Map(sessionOrder.map((id, i) => [id, i])),
    [sessionOrder],
  );

  // Sort sessions by persisted order
  const orderedSessions = useMemo(() => {
    if (sessionOrder.length === 0) return sessions;
    return [...sessions].sort((a, b) => {
      const ai = orderIndex.get(a.id) ?? sessions.length;
      const bi = orderIndex.get(b.id) ?? sessions.length;
      return ai - bi;
    });
  }, [sessions, sessionOrder, orderIndex]);

  // Group sessions by color
  const colorMap = new Map<string, SessionMeta[]>();
  const ungrouped: SessionMeta[] = [];

  for (const s of orderedSessions) {
    if (s.color) {
      const group = colorMap.get(s.color) ?? [];
      group.push(s);
      colorMap.set(s.color, group);
    } else {
      ungrouped.push(s);
    }
  }

  const grouped: SessionGroup[] = Array.from(colorMap.entries()).map(
    ([color, groupSessions]) => ({
      color,
      name: groupSessions[0].name.split("-")[0],
      sessions: groupSessions,
    }),
  );

  const reorder = useCallback(
    (fromId: string, toId: string) => {
      setSessionOrder((prev) => reorderIds(prev, fromId, toId));
    },
    [],
  );

  const swapOrder = useCallback(
    (idA: string, idB: string) => {
      setSessionOrder((prev) => swapIds(prev, idA, idB));
    },
    [],
  );

  // `ColumnLayout` v2 is self-contained (each entry names its own
  // sessionId), so unlike the shipped v1 — where joinColumn/splitColumn's
  // new *order* and new *sizes* were two correlated outputs of a single
  // pure-function call, and a functional setSessionOrder updater could only
  // return one of them — these callbacks now each touch at most one piece
  // of state computed by a single pure function. swapSessions is the
  // exception: it drives two genuinely independent structures
  // (sessionOrder via swapIds, columnLayout via swapInLayout) from one user
  // action. We still read sessionOrder/columnLayout directly from the
  // closure and issue precomputed setState calls for all four callbacks
  // below (the same established pattern as createSession's direct read of
  // `sessions` above), rather than mixing that style with functional
  // updaters elsewhere in this hook — one calling convention for every
  // "commit a layout op" callback.
  const mergeColumn = useCallback(
    (sessionId: string, targetId: string) => {
      setColumnLayout(mergeInColumn(columnLayout, sessionId, targetId));
    },
    [columnLayout],
  );

  const joinColumn = useCallback(
    (sessionId: string, targetId: string) => {
      setColumnLayout(joinOtherColumn(columnLayout, sessionId, targetId));
    },
    [columnLayout],
  );

  const splitColumn = useCallback(
    (sessionId: string, gutterIndex: number) => {
      setColumnLayout(splitToNewColumn(columnLayout, sessionId, gutterIndex));
    },
    [columnLayout],
  );

  const applyPreset = useCallback(
    (sizes: number[]) => {
      setColumnLayout(expandPreset(sessionOrder, sizes));
    },
    [sessionOrder],
  );

  const swapSessions = useCallback(
    (idA: string, idB: string) => {
      setSessionOrder(swapIds(sessionOrder, idA, idB));
      setColumnLayout(swapInLayout(columnLayout, idA, idB));
    },
    [sessionOrder, columnLayout],
  );

  return {
    sessions: orderedSessions,
    grouped,
    ungrouped,
    focusedId,
    setFocusedId,
    createSession,
    deleteSession,
    updateSession,
    fetchSessions,
    reorder,
    swapOrder,
    columnLayout,
    mergeColumn,
    joinColumn,
    splitColumn,
    applyPreset,
    swapSessions,
  };
}

/**
 * Compute a short display name (≤ 5 chars) for mobile UI. If the resulting
 * prefix collides with another session in the same list, extend it until
 * unique — never exceeding the full name.
 */
export function mobileShortName(
  session: SessionMeta,
  all: SessionMeta[],
): string {
  const full = session.name;
  if (full.length <= 5) return full;
  // Prefer the suffix after the last dash when all peers share a prefix.
  const dash = full.lastIndexOf("-");
  if (dash > 0) {
    const suffix = full.slice(dash + 1);
    const collides = all.some(
      (s) =>
        s.id !== session.id &&
        s.name.slice(s.name.lastIndexOf("-") + 1) === suffix,
    );
    if (!collides && suffix.length <= 5) return suffix;
  }
  // Fallback: expand a prefix until unique
  for (let len = 5; len <= full.length; len++) {
    const prefix = full.slice(0, len);
    const collides = all.some(
      (s) => s.id !== session.id && s.name.startsWith(prefix),
    );
    if (!collides) return prefix;
  }
  return full;
}
