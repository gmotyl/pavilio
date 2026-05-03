import { useCallback } from "react";
import type { URLSearchParamsInit } from "react-router-dom";
import type { RepoOpenFile } from "./RepoBlock";

interface Options {
  searchParams: URLSearchParams;
  setSearchParams: (
    init:
      | URLSearchParamsInit
      | ((prev: URLSearchParams) => URLSearchParamsInit),
    navigateOptions?: { replace?: boolean; state?: unknown },
  ) => void;
}

/**
 * URL-backed pointer to a specific file diff opened from a repo search.
 * Stored as `?repo=…&file=…&scope=…&highlight=…` so the deep link is
 * sharable.
 */
export function useRepoOpenFile({ searchParams, setSearchParams }: Options) {
  const repoOpenFile: RepoOpenFile | null = (() => {
    const repo = searchParams.get("repo");
    const file = searchParams.get("file");
    if (!repo || !file) return null;
    return {
      repo,
      file,
      scope: searchParams.get("scope") ?? "",
      highlight: searchParams.get("highlight") ?? "",
    };
  })();

  const setRepoOpenFile = useCallback(
    (next: RepoOpenFile | null) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next) {
            params.set("repo", next.repo);
            params.set("file", next.file);
            if (next.highlight) params.set("highlight", next.highlight);
            else params.delete("highlight");
            if (next.scope) params.set("scope", next.scope);
            else params.delete("scope");
          } else {
            params.delete("repo");
            params.delete("file");
            params.delete("highlight");
            params.delete("scope");
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { repoOpenFile, setRepoOpenFile };
}
