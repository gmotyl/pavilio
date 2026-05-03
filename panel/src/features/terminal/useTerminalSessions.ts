import { useState, useEffect, useCallback, useMemo } from "react";
import { destroyTerminal } from "./terminalInstances";
import { reorderIds, swapIds, mergeOrder } from "./sessionOrder";

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

  const [sessionOrder, setSessionOrder] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(`panel-terminal-order-${project}`);
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
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
      setSessionOrder((prev) => mergeOrder(prev, filtered.map((s) => s.id)));
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
    } catch {
      setFocusedIdState(null);
      setSessionOrder([]);
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
      setFocusedId(detail.sessionId);
      // Only refetch if the session isn't already in our list — covers
      // sidebar "+" creates without re-fetching on every echo from our
      // own setFocusedId dispatch.
      setSessions((prev) => {
        if (!prev.some((s) => s.id === detail.sessionId)) {
          fetchSessions();
        }
        return prev;
      });
    };
    window.addEventListener(TERMINAL_FOCUS_EVENT, handler);
    return () => window.removeEventListener(TERMINAL_FOCUS_EVENT, handler);
  }, [project, setFocusedId, fetchSessions]);

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
          setSessionOrder((prev) =>
            prev.includes(created.id) ? prev : [...prev, created.id],
          );
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
