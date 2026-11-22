import { useEffect, useState } from "react";

export interface Commit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

export interface CommitFile {
  status: string;
  path: string;
}

const repoQs = (repo?: string) => (repo ? `&repo=${encodeURIComponent(repo)}` : "");

/** The latest commits of a repo (workspace repo when undefined). */
export function useGitLog(repo?: string, limit = 30): Commit[] {
  const [commits, setCommits] = useState<Commit[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/git/log?limit=${limit}${repoQs(repo)}`)
      .then(async (res) => {
        if (res.ok && !cancelled) setCommits(await res.json());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repo, limit]);
  return commits;
}

/** Files one commit touched; empty while `sha` is null. */
export function useCommitFiles(repo: string | undefined, sha: string | null) {
  const [files, setFiles] = useState<CommitFile[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!sha) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/git/commit-files?sha=${sha}${repoQs(repo)}`);
        if (!cancelled && res.ok) setFiles(await res.json());
      } catch {
        if (!cancelled) setFiles([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sha, repo]);
  return { files, loading };
}
