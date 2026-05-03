import { useEffect, useState } from "react";
import type { GrepResult } from "../search/grep";

export type RepoSearchScope = "changed" | "branch-diff" | "commits";

const SCOPE_KEY = "panel-repo-search-scope";

export interface RepoFile {
  status: string;
  path: string;
  repo: string;
  repoName: string;
  source: RepoSearchScope;
}

export interface UseRepoSearchOptions {
  active: boolean;
  repos: { name: string; path: string }[] | undefined;
  query: string;
}

export function useRepoSearch({ active, repos, query }: UseRepoSearchOptions) {
  const [scope, setScopeState] = useState<RepoSearchScope>(
    () => (localStorage.getItem(SCOPE_KEY) as RepoSearchScope) || "changed",
  );
  const setScope = (next: RepoSearchScope) => {
    setScopeState(next);
    try {
      localStorage.setItem(SCOPE_KEY, next);
    } catch {
      // ignore
    }
  };

  const [files, setFiles] = useState<RepoFile[]>([]);
  const [grepResults, setGrepResults] = useState<GrepResult[]>([]);
  const [grepLoading, setGrepLoading] = useState(false);

  const repoPathsKey = repos?.map((r) => r.path).join(",") ?? "";

  useEffect(() => {
    if (!active || !repos?.length) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    const list = repos;
    (async () => {
      const all: RepoFile[] = [];
      await Promise.all(
        list.map(async (repo) => {
          const qs = `repo=${encodeURIComponent(repo.path)}`;
          if (scope === "changed") {
            try {
              const res = await fetch(`/api/git/status?${qs}`);
              if (res.ok) {
                const data: { status: string; path: string }[] = await res.json();
                all.push(
                  ...data.map((f) => ({
                    ...f,
                    repo: repo.path,
                    repoName: repo.name,
                    source: "changed" as const,
                  })),
                );
              }
            } catch {
              // ignore
            }
          }
          if (scope === "branch-diff") {
            const base = localStorage.getItem(
              `panel-branch-diff-base-${repo.path}`,
            );
            if (base) {
              try {
                const res = await fetch(
                  `/api/git/branch-diff-files?base=${encodeURIComponent(base)}&${qs}`,
                );
                if (res.ok) {
                  const data = await res.json();
                  all.push(
                    ...(data.files || []).map(
                      (f: { status: string; path: string }) => ({
                        ...f,
                        repo: repo.path,
                        repoName: repo.name,
                        source: "branch-diff" as const,
                      }),
                    ),
                  );
                }
              } catch {
                // ignore
              }
            }
          }
          if (scope === "commits") {
            try {
              const logRes = await fetch(`/api/git/log?limit=10&${qs}`);
              if (logRes.ok) {
                const commits: { sha: string; message: string }[] =
                  await logRes.json();
                const seen = new Set<string>();
                await Promise.all(
                  commits.map(async (c) => {
                    try {
                      const cfRes = await fetch(
                        `/api/git/commit-files?sha=${c.sha}&${qs}`,
                      );
                      if (cfRes.ok) {
                        const cf: { status: string; path: string }[] =
                          await cfRes.json();
                        for (const f of cf) {
                          if (!seen.has(f.path)) {
                            seen.add(f.path);
                            all.push({
                              ...f,
                              repo: repo.path,
                              repoName: repo.name,
                              source: "commits" as const,
                            });
                          }
                        }
                      }
                    } catch {
                      // ignore
                    }
                  }),
                );
              }
            } catch {
              // ignore
            }
          }
        }),
      );
      if (!cancelled) setFiles(all);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, repoPathsKey, scope]);

  useEffect(() => {
    if (!active || query.length < 2 || files.length === 0) {
      setGrepResults([]);
      return;
    }
    setGrepLoading(true);
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const allResults: GrepResult[] = [];
        const byRepo = new Map<string, string[]>();
        for (const f of files) {
          if (!byRepo.has(f.repo)) byRepo.set(f.repo, []);
          byRepo.get(f.repo)!.push(f.path);
        }
        await Promise.all(
          [...byRepo.entries()].map(async ([repo, paths]) => {
            const url = `/api/git/grep?q=${encodeURIComponent(query)}&repo=${encodeURIComponent(repo)}&files=${encodeURIComponent(paths.join(","))}`;
            const res = await fetch(url, { signal: abort.signal });
            if (res.ok) {
              const results: GrepResult[] = await res.json();
              allResults.push(
                ...results.map((r) => ({ ...r, project: repo })),
              );
            }
          }),
        );
        if (!abort.signal.aborted) setGrepResults(allResults);
      } catch (e: any) {
        if (e.name !== "AbortError") setGrepResults([]);
      } finally {
        if (!abort.signal.aborted) setGrepLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [active, query, files]);

  return { scope, setScope, files, grepResults, grepLoading };
}
