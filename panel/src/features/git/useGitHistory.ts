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

/** Files one commit touched; empty (and loading) until the answer for this sha arrives. */
export function useCommitFiles(repo: string | undefined, sha: string | null) {
  const [got, setGot] = useState<{ key: string; files: CommitFile[] } | null>(null);
  const key = sha ? `${repo ?? ""}\0${sha}` : null;
  useEffect(() => {
    if (!sha || !key) return;
    let cancelled = false;
    fetch(`/api/git/commit-files?sha=${sha}${repoQs(repo)}`)
      .then(async (res) => (res.ok ? ((await res.json()) as CommitFile[]) : []))
      .catch(() => [])
      .then((files) => !cancelled && setGot({ key, files }));
    return () => {
      cancelled = true;
    };
  }, [key]);
  const ready = !!key && got?.key === key;
  return { files: ready ? got.files : NONE, loading: !!key && !ready };
}
