import { useCallback, useEffect, useState } from "react";
import type { Project } from "./useProjects";

/** `GET /api/projects/:name`: a live project, or an archived one with its date. */
export type ProjectDetail = Project & { archived: boolean; archivedAt?: string };

/** How long a failed lookup waits before asking again. */
export const DETAIL_RETRY_MS = 3000;

/**
 * The last answer for one project name. `detail` is null for a confirmed 404 (or a body that
 * is not this project); `failed` marks a network error or a non-404 error status, which says
 * nothing about the project and so never settles it.
 */
interface Resolved {
  name: string;
  detail: ProjectDetail | null;
  failed: boolean;
}

/**
 * The detail of a project the live list does not carry. The live list never
 * carries an archived project, so a project missing from it is looked up on its
 * own; a listed project needs no lookup.
 *
 * - `detail` — this very project's answer, never the previous project's.
 * - `loading` — an unlisted project with no settled answer yet: still in
 *   flight, or the last lookup failed (it is retried every {@link DETAIL_RETRY_MS}).
 * - `failed` — the last lookup failed; nothing is known until a retry answers.
 * - `refetch` — ask again (after Restore); the last answer stays until then,
 *   or until the project shows up in the live list, which drops it.
 */
export function useProjectDetail(name: string | undefined, isListed: boolean) {
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [version, setVersion] = useState(0);

  // A listed project's last answer is stale: forget it, so a later unlisted
  // episode (a transient drop after a restore) starts unsettled instead of
  // replaying an old "archived". Adjusted during render, like a prop change.
  if (isListed && resolved !== null) setResolved(null);

  useEffect(() => {
    if (!name || isListed) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const fail = () => {
      if (cancelled) return;
      // Unknown, not "not archived": keep holding and ask again.
      setResolved({ name, detail: null, failed: true });
      retry = setTimeout(() => setVersion((v) => v + 1), DETAIL_RETRY_MS);
    };
    fetch(`/api/projects/${encodeURIComponent(name)}`)
      .then(async (res) => {
        if (res.status === 404) return { found: false as const };
        if (!res.ok) return null;
        return { found: true as const, data: (await res.json()) as ProjectDetail | null };
      })
      .then((answer) => {
        if (cancelled) return;
        if (answer === null) return fail();
        // Only an answer for this very project counts (a list or a 404 does not).
        const data = answer.found ? answer.data : null;
        setResolved({ name, detail: data?.name === name ? data : null, failed: false });
      })
      .catch(fail);
    return () => {
      // A switch (or a newer refetch) while in flight drops this answer and any pending retry.
      cancelled = true;
      if (retry !== undefined) clearTimeout(retry);
    };
  }, [name, isListed, version]);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);
  const current = resolved !== null && resolved.name === name ? resolved : null;
  const settled = current !== null && !current.failed;

  return {
    detail: settled ? current.detail : null,
    loading: Boolean(name) && !isListed && !settled,
    failed: !isListed && current?.failed === true,
    refetch,
  };
}
