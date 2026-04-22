import { useEffect } from "react";
import { writeLastReposQuery } from "./lastPath";

/**
 * Persists the full URL query string whenever the user is on the repos tab,
 * so returning to the tab later can restore exact state (repo, file, scope,
 * highlight, branchfile, sha, gitfile).
 */
export function useReposTabMemory(
  project: string | undefined,
  section: string | undefined,
  searchParams: URLSearchParams,
): void {
  useEffect(() => {
    if (!project || section !== "repos") return;
    writeLastReposQuery(project, searchParams.toString());
  }, [project, section, searchParams]);
}
