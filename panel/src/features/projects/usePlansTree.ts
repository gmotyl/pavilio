import { useCallback, useEffect, useState } from "react";
import { useWebSocket } from "../realtime/useWebSocket";

export interface PlanFile {
  source: string;
  filename: string;
  absolutePath: string;
  modified: number;
  /** Set when the file lives under projectsDir; null for external (.kilo / ~/.claude) files. */
  relativeToProjectsDir: string | null;
}
export interface PlanSource {
  id: string;
  label: string;
  absoluteRoot: string;
  files: PlanFile[];
}
export interface PlansTreeResponse {
  project: string;
  sources: PlanSource[];
}

export function usePlansTree(projectName: string | undefined) {
  const { lastMessage } = useWebSocket();
  const [data, setData] = useState<PlansTreeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectName) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/plans-tree`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectName]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A plan an agent writes while this tab is open must appear without a reload.
  useEffect(() => {
    if (lastMessage?.type === "file-change") refresh();
  }, [lastMessage, refresh]);

  return { data, loading, error, refresh };
}

export async function fetchPlanFile(
  projectName: string,
  absolutePath: string,
): Promise<{ content: string }> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectName)}/plans/read?path=${encodeURIComponent(absolutePath)}`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}
