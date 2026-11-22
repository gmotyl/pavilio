import { useEffect, useState } from "react";
import { useWebSocket } from "../realtime/useWebSocket";

export interface GitFile {
  status: string;
  path: string;
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/**
 * Working-tree changes of one repo plus the stage / commit / push / checkout
 * actions on it. `repo` undefined targets the workspace repo.
 */
export function useGitChanges(repo?: string) {
  const [files, setFiles] = useState<GitFile[]>([]);
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [suggestion, setSuggestion] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [commitMsg, setCommitMsg] = useState("");
  const [loading, setLoading] = useState("");
  const [checkoutError, setCheckoutError] = useState("");

  const qs = repo ? `?repo=${encodeURIComponent(repo)}` : "";

  const refresh = async () => {
    const [statusRes, branchRes, suggestRes] = await Promise.all([
      fetch(`/api/git/status${qs}`),
      fetch(`/api/git/branch${qs}`),
      fetch(`/api/git/suggest-message${qs}`),
    ]);
    if (statusRes.ok) setFiles(await statusRes.json());
    if (branchRes.ok) setBranch((await branchRes.json()).branch);
    if (suggestRes.ok) setSuggestion((await suggestRes.json()).suggestion);
  };

  const fetchBranches = async () => {
    try {
      const res = await fetch(`/api/git/branches${qs}`);
      if (res.ok) setBranches((await res.json()).branches);
    } catch {}
  };

  const checkout = async (target: string) => {
    if (target === branch) return;
    setCheckoutError("");
    setLoading("switching");
    try {
      const res = await post("/api/git/checkout", { branch: target, repo });
      const data = await res.json();
      if (res.ok) {
        setBranch(data.branch);
        await refresh();
        await fetchBranches();
      } else {
        setCheckoutError(data.error);
      }
    } catch (e: any) {
      setCheckoutError(e.message || "Checkout failed");
    }
    setLoading("");
  };

  const { lastMessage } = useWebSocket();

  useEffect(() => {
    refresh();
    fetchBranches();
  }, [repo]);

  // A commit/push from anywhere leaves the list stale. Only git-change is
  // honoured: sync-status fires on every tick and would refetch for nothing.
  useEffect(() => {
    if (lastMessage?.type !== "git-change") return;
    refresh();
    fetchBranches();
  }, [lastMessage]);
  useEffect(() => {
    setCommitMsg(suggestion);
  }, [suggestion]);

  const toggleFile = (path: string) => {
    const next = new Set(selected);
    next.has(path) ? next.delete(path) : next.add(path);
    setSelected(next);
  };

  const stageFiles = async (paths: string[]) => {
    setLoading("staging");
    await post("/api/git/stage", { files: paths, repo });
    setSelected(new Set());
    await refresh();
    setLoading("");
  };

  /** Resolves true once a commit (and optional push) ran. */
  const commit = async (push = false): Promise<boolean> => {
    if (!commitMsg.trim()) return false;
    setLoading("committing");
    await post("/api/git/commit", { message: commitMsg, repo });
    if (push) {
      setLoading("pushing");
      await post("/api/git/push", { repo });
    }
    setCommitMsg("");
    await refresh();
    setLoading("");
    return true;
  };

  return {
    files,
    branch,
    branches,
    suggestion,
    selected,
    toggleFile,
    commitMsg,
    setCommitMsg,
    loading,
    checkoutError,
    setCheckoutError,
    refresh,
    stageFiles,
    commit,
    checkout,
  };
}
