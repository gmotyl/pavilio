import { useState, useEffect } from "react";
import { useWebSocket } from "../realtime/useWebSocket";

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
  latestProgressDate: string | null;
  repos: RepoEntry[];
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
  }, []);

  useEffect(() => {
    if (lastMessage?.type === "file-change") fetchProjects();
  }, [lastMessage]);

  return projects;
}
