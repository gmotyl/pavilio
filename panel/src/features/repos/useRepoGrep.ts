import { useEffect, useState } from "react";
import type { GrepResult } from "../search/grep";

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

/** `/api/git/grep` in one repo or worktree; `files` narrows it to those paths, else the whole tree. */
export async function grepRepo(repo: string, query: string, opts: { files?: string[]; signal?: AbortSignal } = {}): Promise<GrepResult[]> {
  const files = opts.files ? `&files=${encodeURIComponent(opts.files.join(","))}` : "";
  const res = await fetch(`/api/git/grep?q=${encodeURIComponent(query)}&repo=${encodeURIComponent(repo)}${files}`, {
    signal: opts.signal,
  });
  if (!res.ok) return [];
  const results = (await res.json()) as GrepResult[] | null;
  return Array.isArray(results) ? results.map((r) => ({ ...r, project: repo })) : [];
}

/**
 * Debounced whole-tree grep of `repo`; idle (empty) while inactive or under two characters.
 * Results are tagged with the repo and query they answer, so a newer query never exposes older hits.
 */
export function useRepoGrep(repo: string | null, query: string, active: boolean) {
  const [answer, setAnswer] = useState<{ key: string; results: GrepResult[] } | null>(null);
  const idle = !active || !repo || query.length < MIN_QUERY;
  const key = `${repo}\0${query}`;

  useEffect(() => {
    if (idle || !repo) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      grepRepo(repo, query, { signal: abort.signal })
        .then((r) => !abort.signal.aborted && setAnswer({ key, results: r }))
        .catch((e: unknown) => {
          if ((e as Error)?.name !== "AbortError") setAnswer({ key, results: [] });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [repo, query, idle, key]);

  const current = !idle && answer?.key === key;
  return { results: current ? answer.results : [], loading: !idle && !current };
}
