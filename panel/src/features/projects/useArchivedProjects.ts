import { useCallback, useEffect, useMemo, useState } from "react";

export interface ArchivedProject {
  name: string;
  archivedAt: string;
  kind: "project" | "research" | "knowledge";
  /** One-line summary from PROJECT.md or wiki/overview.md; null when neither has one. */
  description: string | null;
}

export function useArchivedProjects() {
  const [archived, setArchived] = useState<ArchivedProject[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/archive");
      if (!res.ok) throw new Error(`Failed to load archive (${res.status})`);
      setArchived(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load archive");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** POSTs `url`, then refreshes. Resolves to the error message, or null on success. */
  const mutate = useCallback(
    async (url: string): Promise<string | null> => {
      setError(null);
      try {
        const res = await fetch(url, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const message: string = body?.error ?? `Request failed (${res.status})`;
          setError(message);
          return message;
        }
        await refresh();
        return null;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Request failed";
        setError(message);
        return message;
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
