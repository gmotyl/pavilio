import { useEffect, useRef, useState } from "react";
import { useWebSocket } from "../realtime/useWebSocket";

export interface GitFile {
  status: string;
  path: string;
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** POST that throws the server's `error` on a non-2xx answer. */
async function mutate(url: string, body: unknown, fallback: string): Promise<void> {
  const res = await post(url, body);
  if (res.ok) return;
  const data = await res.json().catch(() => ({}));
  throw new Error(data?.error || fallback);
}

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
  const [actionError, setActionError] = useState("");
  // Stage, commit, push and checkout run one at a time: a checkout landing
  // mid commit-and-push would push whatever branch it switched to.
  const busy = useRef(false);
  const exclusive = async <T,>(label: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    if (busy.current) return fallback;
    busy.current = true;
    setLoading(label);
    try {
      return await run();
    } finally {
      busy.current = false;
      setLoading("");
    }
  };

  const qs = repo ? `?repo=${encodeURIComponent(repo)}` : "";

  const refresh = async () => {
    const [statusRes, branchRes, suggestRes] = await Promise.all([
      fetch(`/api/git/status${qs}`),
      fetch(`/api/git/branch${qs}`),
      fetch(`/api/git/suggest-message${qs}`),
    ]);
    // Shape-checked: the Code view mounts this with every checkout, so an odd answer must not throw.
    const [status, head, suggest] = await Promise.all([statusRes, branchRes, suggestRes].map((r) => (r.ok ? r.json().catch(() => null) : null)));
    if (Array.isArray(status)) setFiles(status);
    if (typeof head?.branch === "string") setBranch(head.branch);
    if (typeof suggest?.suggestion === "string") setSuggestion(suggest.suggestion);
  };

  const fetchBranches = async () => {
    try {
      const res = await fetch(`/api/git/branches${qs}`);
      if (res.ok) setBranches((await res.json()).branches);
    } catch {}
  };

  /** `track` checks a remote branch out as a local tracking branch. */
  const checkout = (target: string, opts?: { track?: boolean }) =>
    target === branch
      ? Promise.resolve()
      : exclusive(
          "switching",
          async () => {
            setCheckoutError("");
            try {
              const res = await post("/api/git/checkout", {
                branch: target,
                repo,
                ...(opts?.track ? { track: true } : {}),
              });
              const data = await res.json();
              if (res.ok) {
                setBranch(data.branch);
                // A stage/commit/push error belongs to the branch just left.
                setActionError("");
                await refresh();
                await fetchBranches();
              } else {
                setCheckoutError(data.error);
              }
            } catch (e: any) {
              setCheckoutError(e.message || "Checkout failed");
            }
          },
          undefined,
        );

  const { lastMessage } = useWebSocket();

  useEffect(() => {
    refresh().catch(() => {});
    fetchBranches();
  }, [repo]);

  // A commit/push from anywhere leaves the list stale. Only git-change is
  // honoured: sync-status fires on every tick and would refetch for nothing.
  useEffect(() => {
    if (lastMessage?.type !== "git-change") return;
    refresh().catch(() => {});
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

  const stageFiles = (paths: string[]) =>
    exclusive(
      "staging",
      async () => {
        setActionError("");
        try {
          await mutate("/api/git/stage", { files: paths, repo }, "Stage failed");
          setSelected(new Set());
        } catch (e: any) {
          setActionError(e.message || "Stage failed");
        }
        await refresh().catch(() => {});
      },
      undefined,
    );

  /**
   * Resolves true once the commit landed. A failed commit (hook rejection,
   * nothing staged) never pushes and keeps the message for another try.
   */
  const commit = (push = false): Promise<boolean> => {
    if (!commitMsg.trim()) return Promise.resolve(false);
    return exclusive(
      "committing",
      async () => {
        setActionError("");
        try {
          await mutate("/api/git/commit", { message: commitMsg, repo }, "Commit failed");
        } catch (e: any) {
          setActionError(e.message || "Commit failed");
          return false;
        }
        setCommitMsg("");
        if (push) {
          setLoading("pushing");
          try {
            await mutate("/api/git/push", { repo }, "Push failed");
          } catch (e: any) {
            setActionError(e.message || "Push failed");
          }
        }
        await refresh().catch(() => {});
        return true;
      },
      false,
    );
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
    actionError,
    setActionError,
    refresh,
    stageFiles,
    commit,
    checkout,
  };
}
