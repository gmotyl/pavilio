import { useState, useEffect, useCallback } from "react";
import { preferences } from "../../preferences/declarations";
import { clearPreference, readPreference, writePreference } from "../../preferences/store";
import { destroyTerminal } from "./terminalInstances";
import { useTerminalOrdering } from "./useTerminalOrdering";

export const TERMINAL_FOCUS_EVENT = "panel-terminal-focus";

/**
 * The project's remembered focused session, and the one way to change it.
 *
 * `terminal.focus` is `portable: false` on purpose: the value is a LIVE SESSION
 * ID, which means nothing on another machine and must never reach a file that
 * gets committed and carried to one. It stays in `localStorage`, exactly where
 * it was — only the key and the codec moved.
 *
 * Both helpers live here, and every writer of the focused session imports
 * them: this hook, `createTerminalSession`, `QuickTerminalModal`,
 * `TerminalsSurface`, and `LeftSidebar`. That is not tidiness — `LeftSidebar`
 * READS this key and drops a focus broadcast whose project does not match, so a
 * reader on a different key from its writers highlights nothing. One pair of
 * functions is what keeps them from drifting apart again.
 *
 * A blank project is not a scope: `storageKey` throws on one rather than
 * letting every project share a single key, so an unresolved project reads the
 * declared default and writes nothing.
 */
export function readTerminalFocus(project: string | null | undefined): string | null {
  if (!project || project.trim() === "") return preferences.terminalFocus.default;
  return readPreference(preferences.terminalFocus, project);
}

export function writeTerminalFocus(project: string, sessionId: string | null): void {
  // `typeof x === "string" && x.trim() !== ""`, not a bare `.trim()`: the
  // parameter is typed `string`, but a route param reaches these call sites
  // through a `name ?? ""` idiom that TypeScript cannot see past, and the bare
  // form has already thrown twice in this change — once during render. This is
  // the shape `features/git`, `features/projects` and `features/time` settled
  // on, and `readTerminalFocus` above already tolerates an absent project.
  if (typeof project !== "string" || project.trim() === "") return;
  // Unfocusing CLEARS rather than storing `null`, mirroring the `removeItem`
  // this replaces: "nothing focused" is the absence of a value, not a value.
  if (sessionId) writePreference(preferences.terminalFocus, sessionId, project);
  else clearPreference(preferences.terminalFocus, project);
}

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
  project: string;
  cwd: string;
  pid: number;
  createdAt: string;
}

export interface CreateSessionOpts {
  project?: string;
  cwd?: string;
  name?: string;
  runAsUser?: string;
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
  const [focusedId, setFocusedIdState] = useState<string | null>(() =>
    readTerminalFocus(project),
  );

  const setFocusedId = useCallback(
    (id: string | null) => {
      setFocusedIdState(id);
      writeTerminalFocus(project, id);
      // Broadcast so other surfaces (sidebar, mobile rail) stay in sync
      // when focus changes from the iTerm grid/spine. Persist first, then
      // dispatch — see LeftSidebar's note on why that order is load-bearing.
      if (id) dispatchTerminalFocus(project, id);
    },
    [project],
  );

  // Order + column layout for this project's scope, shared with the
  // cross-project terminals page (see useTerminalOrdering).
  const ordering = useTerminalOrdering(project, sessions);
  const { syncIds, appendId, removeId } = ordering;

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
      syncIds(filtered.map((s) => s.id));
    } catch (err) {
      console.warn(`[terminal] fetch sessions failed:`, err);
    }
  }, [project, syncIds]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Adopt the session the surface actually shows when the stored focus cannot
  // name it. The focus key is only written by an explicit act — a sidebar row
  // click, a create, a click in the grid — so arriving any other way (the
  // project row, a Last-open-view bookmark, a pasted URL, a browser profile
  // that has never focused this project) leaves it absent. It also goes stale
  // whenever the session it names is closed, or the panel restarts and hands
  // out new ids. A terminal still renders in every one of those cases, so
  // leaving focus unset is what left the sidebar highlighting nothing while a
  // terminal was plainly open.
  useEffect(() => {
    const open = ordering.orderedSessions;
    if (open.length === 0) return;
    if (focusedId && open.some((s) => s.id === focusedId)) return;
    // setFocusedId persists and broadcasts, which is how the sidebar and the
    // mobile rail find out — they never read this hook's state directly.
    setFocusedId(open[0].id);
  }, [ordering.orderedSessions, focusedId, setFocusedId]);

  // When the project changes (no remount — same component instance reused
  // across route navigations), reset state to the new project's stored values.
  // Order and layout reset themselves inside useTerminalOrdering, keyed on the
  // same project string.
  useEffect(() => {
    setSessions([]);
    setFocusedIdState(readTerminalFocus(project));
  }, [project]);

  // Listen for "focus this session" broadcasts (e.g. left sidebar click
  // while user is already on this project's iTerm tab, so no remount
  // happens to re-read the stored focus). Also refetch sessions: when the
  // sidebar's "+" button creates a session via direct fetch, our local
  // `sessions` state is stale until we refetch — without this, the new
  // session id is set as focusedId but no terminal renders for it.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<TerminalFocusEventDetail>).detail;
      if (!detail || detail.project !== project) return;
      // Use the bare state setter and persist directly — calling setFocusedId
      // here would re-dispatch the event and recurse infinitely.
      setFocusedIdState((current) =>
        current === detail.sessionId ? current : detail.sessionId,
      );
      writeTerminalFocus(project, detail.sessionId);
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
            runAsUser: opts.runAsUser,
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
          // Reconcile the tiling the same way fetchSessions does — otherwise a
          // custom layout falls out of sync with the session order and the new
          // session is silently missing from the grid until the next poll.
          appendId(created.id);
          setFocusedId(created.id);
        }
        return created;
      } catch (err) {
        console.warn(`[terminal] create session failed:`, err);
      }
    },
    [project, sessions, setFocusedId, appendId],
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
      // Symmetric with createSession's appendId: drop the tile too, so the
      // survivors absorb the freed space. This surface has no poll to heal a
      // stale layout, and a closed session left in the tiling turns the next
      // terminal into a sliver of its ghost rectangle.
      removeId(id);
      setFocusedIdState((prev) => {
        const next = prev === id ? null : prev;
        writeTerminalFocus(project, next);
        return next;
      });
    } catch (err) {
      console.warn(`[terminal] delete session ${id} failed:`, err);
    }
    // `project` is read only inside the focus updater, which cannot go stale in a
    // way that matters here; `removeId` is a stable dispatch wrapper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [removeId]);

  const updateSession = useCallback(
    async (id: string, patch: { name?: string }) => {
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

  const orderedSessions = ordering.orderedSessions;

  return {
    sessions: orderedSessions,
    focusedId,
    setFocusedId,
    createSession,
    deleteSession,
    updateSession,
    fetchSessions,
    reorder: ordering.reorder,
    tiles: ordering.tiles,
    placeTiles: ordering.placeTiles,
    applyPreset: ordering.applyPreset,
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
