import { useCallback, useEffect, useMemo, useState } from "react";

export interface ArchivedProject {
  name: string;
  archivedAt: string;
}

export function useArchivedProjects() {
  const [archived, setArchived] = useState<ArchivedProject[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/archive");
      if (!res.ok) throw new Error(`Failed to load archive (${res.status})`);
      setArchived(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load archive");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (url: string) => {
      setError(null);
      try {
        const res = await fetch(url, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.error ?? `Request failed (${res.status})`);
          return;
        }
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed");
      }
    },
    [refresh],
  );

  const archive = useCallback(
    (name: string) => mutate(`/api/archive/${encodeURIComponent(name)}`),
    [mutate],
  );
  const restore = useCallback(
    (name: string) => mutate(`/api/archive/${encodeURIComponent(name)}/restore`),
    [mutate],
  );

  const archivedNames = useMemo(
    () => new Set(archived.map((p) => p.name)),
    [archived],
  );
  const isArchived = useCallback(
    (name: string) => archivedNames.has(name),
    [archivedNames],
  );

  return { archived, archivedNames, archive, restore, isArchived, error, refresh };
}
