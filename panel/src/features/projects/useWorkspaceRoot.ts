import { useEffect, useState } from "react";

/**
 * The workspace root — the parent of the configured projects directory — as the
 * server reports it on `/api/system`, the endpoint the client already asks for
 * the WSL distro. Copy-path makes every viewer's path relative to it.
 *
 * Fetched once per session and shared by every viewer: the root cannot change
 * under a running server. Only a resolved answer is cached; a failed probe (the
 * usual cause is the server still coming up) lets the next mount ask again.
 */
let cached: string | null = null;
let inflight: Promise<string | null> | null = null;

function fetchWorkspaceRoot(): Promise<string | null> {
  if (!inflight) {
    inflight = fetch("/api/system")
      .then((res) => {
        if (!res.ok) throw new Error(`/api/system responded ${res.status}`);
        return res.json();
      })
      .then((data: unknown) => {
        const root = (data as { workspaceRoot?: unknown } | null)?.workspaceRoot;
        if (typeof root !== "string" || root === "") {
          throw new Error("/api/system carries no workspaceRoot");
        }
        cached = root;
        return root;
      })
      .catch(() => {
        inflight = null;
        return null;
      });
  }
  return inflight;
}

/** The workspace root, or null until the server has answered (or if it cannot). */
export function useWorkspaceRoot(): string | null {
  const [root, setRoot] = useState<string | null>(cached);
  useEffect(() => {
    if (root !== null) return;
    let cancelled = false;
    fetchWorkspaceRoot().then((r) => {
      if (!cancelled && r !== null) setRoot(r);
    });
    return () => {
      cancelled = true;
    };
  }, [root]);
  return root;
}

/** Drops the cached root so each test starts from a fresh session. */
export function __resetWorkspaceRootForTests(): void {
  cached = null;
  inflight = null;
}
