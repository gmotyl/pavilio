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

export type GitLog =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; commits: Commit[] };

/** The latest commits of a repo (workspace repo when undefined); a new `attempt` refetches. */
export function useGitLog(repo?: string, limit = 30, attempt = 0): GitLog {
  const [log, setLog] = useState<GitLog>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    setLog({ status: "loading" });
    fetch(`/api/git/log?limit=${limit}${repoQs(repo)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as Commit[];
      })
      .then(
        (commits) => !cancelled && setLog({ status: "ready", commits }),
        (e: unknown) => !cancelled && setLog({ status: "error", error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      cancelled = true;
    };
  }, [repo, limit, attempt]);
  return log;
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
