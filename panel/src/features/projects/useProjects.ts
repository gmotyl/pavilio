import { useState, useEffect, useRef } from "react";
import { useWebSocket } from "../realtime/useWebSocket";
import type { ProjectKind } from "../../../server/lib/projects/kind";

export interface RepoEntry {
  name: string;
  path: string;
  /** Whether the `~`-expanded path is a directory on this machine (server-derived). */
  present: boolean;
  /** repos.json names a remote, so the panel can clone it; the URL stays on the server. */
  cloneable?: boolean;
}

export interface Project {
  name: string;
  path: string;
  hasIndex: boolean;
  hasNotes: boolean;
  hasProgress: boolean;
  hasPlans: boolean;
  hasWiki: boolean;
  latestProgressDate: string | null;
  kind: ProjectKind;
  lastActivity: string | null; // YYYY-MM-DD
  repos: RepoEntry[];
  /** Project group from PROJECT.md frontmatter; absent until discovery reports it. */
  group?: string | null;
}

/** Window event every mounted `useProjects` refetches on. */
const PROJECTS_REFRESH_EVENT = "pavilio:projects-refresh";

/**
 * Refetch the project list in every mounted `useProjects` now, instead of
 * waiting for the file watcher — e.g. right after the panel created or
 * restored a project and is about to navigate to it.
 */
export function refreshProjects(): Promise<void> {
  const waits: Promise<unknown>[] = [];
  window.dispatchEvent(
    new CustomEvent(PROJECTS_REFRESH_EVENT, {
      detail: { waitUntil: (p: Promise<unknown>) => waits.push(p) },
    }),
  );
  return Promise.allSettled(waits).then(() => undefined);
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const { lastMessage } = useWebSocket();

  // A success applies only over older ones; a failure keeps whatever was last applied.
  const issued = useRef(0);
  const applied = useRef(0);
  const fetchProjects = async () => {
    const id = ++issued.current;
    const res = await fetch("/api/projects");
    if (!res.ok) return;
    const body = await res.json();
    if (id < applied.current) return;
    applied.current = id;
    setProjects(body);
  };

  useEffect(() => {
    fetchProjects();
    const onRefresh = (e: Event) => {
      const p = fetchProjects();
      (e as CustomEvent<{ waitUntil?: (p: Promise<unknown>) => void }>).detail?.waitUntil?.(p);
    };
    window.addEventListener(PROJECTS_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(PROJECTS_REFRESH_EVENT, onRefresh);
  }, []);

  useEffect(() => {
    if (lastMessage?.type === "file-change" || lastMessage?.type === "projects-change") fetchProjects();
  }, [lastMessage]);

  return projects;
}
