import { useCallback, useEffect, useRef, useState } from "react";

// Keep in sync with panel/server/routes/skills.ts
export interface SkillEntry {
  name: string;
  /** Frontmatter `description`, "" when absent. */
  description: string;
  /** Relative to the workspace root, always `skills/<name>/SKILL.md`. */
  path: string;
}

/**
 * Plain code-unit compare: deterministic and locale-independent, so the
 * picker's order never depends on the browser's locale settings.
 */
function byName(a: SkillEntry, b: SkillEntry): number {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

/**
 * Alphabetical by name; `query` matches case-insensitively against name OR
 * description.
 *
 * Per D17 there is no scoring, no frecency and no curated subset: every match
 * is kept and the order is always alphabetical. The query is trimmed, so a
 * whitespace-only query behaves as an empty one (every skill). The input
 * array is never mutated.
 */
export function filterSkills(all: SkillEntry[], query: string): SkillEntry[] {
  const q = query.trim().toLowerCase();
  const matches = q
    ? all.filter(
        (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
      )
    : [...all];
  return matches.sort(byName);
}

export interface UseSkillsResult {
  /** As served (unsorted); pass through `filterSkills` for display order. */
  skills: SkillEntry[];
  loading: boolean;
  /** True when the last fetch failed; `skills` is then empty. */
  error: boolean;
  /** Re-fetch the list; resolves once the new list (or the error) is in state. */
  refresh: () => Promise<void>;
}

/**
 * The workspace's skills from `GET /api/skills`.
 *
 * Refetch policy: the hook fetches on mount and again on every `refresh()`.
 * It is meant to live inside the picker, which mounts each time it opens, so
 * every open sees a fresh list — the server re-walks the skills dir per
 * request, so a newly added skill appears without a panel restart. There is
 * no polling and no cache shared between mounts.
 *
 * A failed or non-ok fetch yields an empty list with `error: true`; it never
 * throws.
 */
export function useSkills(): UseSkillsResult {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  // Only the newest request may write state, so a slow earlier response can
  // never overwrite a later one.
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++latest.current;
    setLoading(true);
    let next: SkillEntry[] = [];
    let failed = false;
    try {
      const res = await fetch("/api/skills");
      if (!res.ok) throw new Error(`GET /api/skills: ${res.status}`);
      const data: unknown = await res.json();
      if (!Array.isArray(data)) throw new Error("GET /api/skills: not an array");
      next = data as SkillEntry[];
    } catch {
      failed = true;
    }
    if (!mounted.current || id !== latest.current) return;
    setSkills(next);
    setError(failed);
    setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  return { skills, loading, error, refresh };
}
