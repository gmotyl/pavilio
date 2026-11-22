import { useEffect, useMemo, useState } from "react";
import { preferences } from "../../preferences/declarations";
import { readPreference } from "../../preferences/store";
import { usePreference } from "../../preferences/usePreference";
import { isPreferenceScope } from "../../preferences/types";
import type { GrepResult } from "../search/grep";

export type RepoSearchScope = "changed" | "branch-diff" | "commits";

export interface RepoFile {
  status: string;
  path: string;
  repo: string;
  repoName: string;
  source: RepoSearchScope;
}

export interface UseRepoSearchOptions {
  active: boolean;
  /** `present: false` marks a linked repo that is not on this machine. */
  repos: { name: string; path: string; present: boolean }[] | undefined;
  query: string;
}

export function useRepoSearch({ active, repos, query }: UseRepoSearchOptions) {
  const [scope, setScope] = usePreference(preferences.repoSearchScope);

  const [files, setFiles] = useState<RepoFile[]>([]);
  const [grepResults, setGrepResults] = useState<GrepResult[]>([]);
  const [grepLoading, setGrepLoading] = useState(false);

  // Presence is part of the key: a missing repo that appears (or vanishes)
  // must re-run the search even though no path changed.
  const repoPathsKey =
    repos?.map((r) => `${r.path}:${r.present ? 1 : 0}`).join(",") ?? "";
  // The paths a search may name right now. Joined with a NUL so it can serve as
  // a dependency key and be split back without colliding with path characters.
  const presentPathsKey =
    repos?.filter((r) => r.present).map((r) => r.path).join("\0") ?? "";

  useEffect(() => {
    // A repo missing on this machine has nothing to search; every git call
    // against its path would only fail on the server.
    const list = repos?.filter((r) => r.present) ?? [];
    if (!active || !list.length) {
      setFiles([]);
      setGrepResults([]);
      return;
    }
    // Drop what a now-missing repo contributed right away, instead of leaving
    // it on screen until the surviving repos' refetch lands. Unchanged state is
    // returned as-is so a plain refetch does not re-trigger the grep.
    const presentPaths = new Set(list.map((r) => r.path));
    setFiles((prev) =>
      prev.every((f) => presentPaths.has(f.repo))
        ? prev
        : prev.filter((f) => presentPaths.has(f.repo)),
    );
    setGrepResults((prev) =>
      prev.every((r) => presentPaths.has(r.project))
        ? prev
        : prev.filter((r) => presentPaths.has(r.project)),
    );
    let cancelled = false;
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
            // The base GitBranchDiff writes, read through the same
            // declaration — so both sides normalize the repo path the same
            // way. A repo with no path is not a scope; the store refuses one.
            //
            // The guard first, and the read inside a `try`. Discovery skips
            // `repos.json` entries without a string `path`, so this is
            // defensive against synthetic or unvalidated input: were a pathless
            // entry to reach here, a bare `repo.path.trim()` would sit in the
            // same un-wrapped position the old `localStorage.getItem` did — a
            // TypeError rejects the whole `Promise.all`, `setFiles(all)` never
            // runs, and ONE malformed entry blanks the search for every healthy
            // repository beside it.
            let base = "";
            try {
              if (isPreferenceScope(repo.path)) {
                base = readPreference(preferences.branchDiffBase, repo.path);
              }
            } catch {
              // No usable scope: search this repo without a base rather than
              // taking the whole batch down.
            }
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
                // The repo set changed (e.g. this repo went missing) while the
                // log was in flight: fan out no further requests for it.
                if (cancelled) return;
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

  // The files a grep may target right now: `files` can still hold a repo that
  // just went missing, and must never be grepped. The grep restarts only when
  // this set changes, so a repo that becomes present before it contributes any
  // files leaves an unchanged search (and its matches) alone, while a repo that
  // goes missing changes the set at once.
  const eligibleFiles = useMemo(() => {
    const presentPaths = new Set(presentPathsKey.split("\0"));
    return files.filter((f) => presentPaths.has(f.repo));
  }, [files, presentPathsKey]);
  const eligibleFilesKey = eligibleFiles
    .map((f) => `${f.repo}\0${f.path}`)
    .join("\n");

  useEffect(() => {
    if (!active || query.length < 2 || eligibleFiles.length === 0) {
      setGrepResults([]);
      // An earlier grep may have been cancelled mid-flight (e.g. the last repo
      // went missing); its own cleanup never resets the indicator.
      setGrepLoading(false);
      return;
    }
    setGrepLoading(true);
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const allResults: GrepResult[] = [];
        const byRepo = new Map<string, string[]>();
        for (const f of eligibleFiles) {
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
    // Keyed on the eligible file set, not the `files` array or the presence
    // key: either can change without changing what a grep would search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, query, eligibleFilesKey]);

  return { scope, setScope, files, grepResults, grepLoading };
}
