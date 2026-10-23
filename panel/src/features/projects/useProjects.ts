import { useState, useEffect } from "react";
import { useWebSocket } from "../realtime/useWebSocket";
import type { ProjectKind } from "../../../server/lib/projects/kind";

export interface RepoEntry {
  name: string;
  path: string;
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
}

/** Window event every mounted `useProjects` refetches on. */
const PROJECTS_REFRESH_EVENT = "pavilio:projects-refresh";

/**
 * Refetch the project list in every mounted `useProjects` now, instead of
 * waiting for the file watcher — e.g. right after the panel created or
 * restored a project and is about to navigate to it.
 */
export function refreshProjects(): void {
  window.dispatchEvent(new Event(PROJECTS_REFRESH_EVENT));
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const { lastMessage } = useWebSocket();

  const fetchProjects = async () => {
    const res = await fetch("/api/projects");
    if (res.ok) setProjects(await res.json());
  };

  useEffect(() => {
    fetchProjects();
    const onRefresh = () => void fetchProjects();
    window.addEventListener(PROJECTS_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(PROJECTS_REFRESH_EVENT, onRefresh);
  }, []);

  useEffect(() => {
    if (lastMessage?.type === "file-change") fetchProjects();
  }, [lastMessage]);

  return projects;
}
