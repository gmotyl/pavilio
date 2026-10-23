import { useCallback, useEffect, useState } from "react";
import type { Project } from "./useProjects";

/** `GET /api/projects/:name`: a live project, or an archived one with its date. */
export type ProjectDetail = Project & { archived: boolean; archivedAt?: string };

/** The settled answer for one project name; `detail` is null for a 404 or a failure. */
interface Resolved {
  name: string;
  detail: ProjectDetail | null;
}

/**
 * The detail of a project the live list does not carry. The live list never
 * carries an archived project, so a project missing from it is looked up on its
 * own; a listed project needs no lookup.
 *
 * - `detail` — this very project's answer, never the previous project's.
 * - `loading` — an unlisted project whose first answer has not arrived yet.
 * - `refetch` — ask again (after Restore); the last answer stays until then.
 */
export function useProjectDetail(name: string | undefined, isListed: boolean) {
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!name || isListed) return;
    let cancelled = false;
    fetch(`/api/projects/${encodeURIComponent(name)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ProjectDetail | null) => {
        // Only an answer for this very project counts (a list or a 404 does not).
        if (!cancelled) setResolved({ name, detail: data?.name === name ? data : null });
      })
      .catch(() => {
        if (!cancelled) setResolved({ name, detail: null });
      });
    return () => {
      // A switch (or a newer refetch) while in flight drops this answer.
      cancelled = true;
    };
  }, [name, isListed, version]);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);
  const settled = resolved !== null && resolved.name === name;

  return {
    detail: settled ? resolved.detail : null,
    loading: Boolean(name) && !isListed && !settled,
    refetch,
  };
}
