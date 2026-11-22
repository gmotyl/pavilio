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

const NONE: CommitFile[] = [];

/** Files one commit touched; empty (and loading) until the answer for this sha arrives. A new `attempt` refetches. */
export function useCommitFiles(repo: string | undefined, sha: string | null, attempt = 0) {
  const [got, setGot] = useState<{ key: string; files: CommitFile[]; error?: string } | null>(null);
  const key = sha ? `${repo ?? ""}\0${sha}` : null;
  useEffect(() => {
    if (!sha || !key) return;
    let cancelled = false;
    fetch(`/api/git/commit-files?sha=${sha}${repoQs(repo)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as CommitFile[];
      })
      .then(
        (files) => !cancelled && setGot({ key, files }),
        (e: unknown) => !cancelled && setGot({ key, files: NONE, error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      cancelled = true;
    };
  }, [key, attempt]);
  const ready = !!key && got?.key === key;
  return { files: ready ? got.files : NONE, error: ready ? got.error : undefined, loading: !!key && !ready };
}
