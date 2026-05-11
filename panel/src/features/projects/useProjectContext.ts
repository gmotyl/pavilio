import { useCallback, useEffect, useState } from "react";

export interface ContextSource {
  id: string;
  label: string;
  absoluteRoot: string;
}
export interface ContextFile {
  source: string;
  filename: string;
  absolutePath: string;
  modified: number;
  /** Set when the file lives under projectsDir; null for linked-repo files. */
  relativeToProjectsDir: string | null;
}
export interface AdrFile {
  source: string;
  filename: string;
  absolutePath: string;
  modified: number;
  adrNumber: number | null;
  slug: string;
  /** Set when the file lives under projectsDir; null for linked-repo files. */
  relativeToProjectsDir: string | null;
}
export interface ContextResponse {
  project: string;
  sources: ContextSource[];
  contexts: ContextFile[];
  adrs: AdrFile[];
}

export function useProjectContext(projectName: string | undefined) {
  const [data, setData] = useState<ContextResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectName) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/context`);
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

  return { data, loading, error, refresh };
}

export async function fetchContextFile(
  projectName: string,
  absolutePath: string,
): Promise<{ content: string }> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectName)}/context/read?path=${encodeURIComponent(absolutePath)}`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}
