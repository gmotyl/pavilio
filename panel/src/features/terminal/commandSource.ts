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

const SEGMENT_BONUS = 3;
const RUN_BONUS = 2;

/**
 * Best score for `q` as an in-order subsequence of `name` (both lowercased),
 * or null when it is not one. Each matched char scores 1, plus SEGMENT_BONUS
 * on a segment start (index 0 or right after `-`) and RUN_BONUS when it
 * directly follows the previous matched char.
 *
 * Every alignment is considered, not just the greedy leftmost one, so `st`
 * lands on the `st` run that opens `start` in `pavilio-session-start` rather
 * than on session's `s` and a stray `t` after it.
 * best[i] is the top score with the current query char matched at name[i].
 */
function nameScore(name: string, q: string): number | null {
  const n = name.length;
  let prev: number[] = [];
  for (let j = 0; j < q.length; j++) {
    const cur = new Array<number>(n).fill(-Infinity);
    // Running max of prev[k] over k < i - 1, the non-adjacent predecessors.
    let farBest = -Infinity;
    for (let i = 0; i < n; i++) {
      if (j > 0 && i >= 2) farBest = Math.max(farBest, prev[i - 2]);
      if (name[i] !== q[j]) continue;
      const base = 1 + (i === 0 || name[i - 1] === "-" ? SEGMENT_BONUS : 0);
      if (j === 0) {
        cur[i] = base;
      } else {
        const adjacent = i >= 1 ? prev[i - 1] + RUN_BONUS : -Infinity;
        const from = Math.max(farBest, adjacent);
        if (from > -Infinity) cur[i] = base + from;
      }
    }
    prev = cur;
  }
  const best = Math.max(-Infinity, ...prev);
  return best > -Infinity ? best : null;
}

/**
 * Skills matching `query`, best first. An empty (or whitespace-only) query
 * returns every skill alphabetically.
 *
 * Otherwise name matches — the query's chars in order in the lowercased
 * name — come first, ranked by `nameScore`, shorter name winning ties. Then
 * description-only matches (case-insensitive substring). Remaining ties are
 * alphabetical; non-matches are dropped. This replaces D17's unscored
 * alphabetical filter. The input array is never mutated.
 */
export function filterSkills(all: SkillEntry[], query: string): SkillEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...all].sort(byName);
  const named: { skill: SkillEntry; score: number }[] = [];
  const described: SkillEntry[] = [];
  for (const skill of all) {
    const score = nameScore(skill.name.toLowerCase(), q);
    if (score !== null) named.push({ skill, score });
    else if (skill.description.toLowerCase().includes(q)) described.push(skill);
  }
  named.sort(
    (a, b) =>
      b.score - a.score ||
      a.skill.name.length - b.skill.name.length ||
      byName(a.skill, b.skill),
  );
  return [...named.map((m) => m.skill), ...described.sort(byName)];
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
