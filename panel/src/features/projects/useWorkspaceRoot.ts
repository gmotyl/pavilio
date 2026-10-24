import { useEffect, useState } from "react";

/**
 * The two directories the viewers derive paths from, as the server reports them
 * on `/api/system`, the endpoint the client already asks for the WSL distro:
 *
 * - `workspaceRoot` — the parent of the configured projects directory. Copy-path
 *   makes every viewer's path relative to it.
 * - `projectsDir` — the projects directory itself. A page's speech key is
 *   relative to it (see `docSpeech.ts`). Null when the server does not report
 *   it; the viewers then offer no Play rather than guess its name.
 *
 * Fetched once per session and shared by every viewer: neither can change under
 * a running server. Only a resolved answer is cached; a failed probe (the usual
 * cause is the server still coming up) lets the next mount ask again.
 */
interface SystemDirs {
  workspaceRoot: string;
  projectsDir: string | null;
}

let cached: SystemDirs | null = null;
let inflight: Promise<SystemDirs | null> | null = null;

function fetchSystemDirs(): Promise<SystemDirs | null> {
  if (!inflight) {
    inflight = fetch("/api/system")
      .then((res) => {
        if (!res.ok) throw new Error(`/api/system responded ${res.status}`);
        return res.json();
      })
      .then((data: unknown) => {
        const body = data as { workspaceRoot?: unknown; projectsDir?: unknown } | null;
        const root = body?.workspaceRoot;
        if (typeof root !== "string" || root === "") {
          throw new Error("/api/system carries no workspaceRoot");
        }
        const projectsDir = body?.projectsDir;
        cached = {
          workspaceRoot: root,
          projectsDir:
            typeof projectsDir === "string" && projectsDir !== "" ? projectsDir : null,
        };
        return cached;
      })
      .catch(() => {
        inflight = null;
        return null;
      });
  }
  return inflight;
}

function useSystemDirs(): SystemDirs | null {
  const [dirs, setDirs] = useState<SystemDirs | null>(cached);
  useEffect(() => {
    if (dirs !== null) return;
    let cancelled = false;
    fetchSystemDirs().then((d) => {
      if (!cancelled && d !== null) setDirs(d);
    });
    return () => {
      cancelled = true;
    };
  }, [dirs]);
  return dirs;
}

/** The workspace root, or null until the server has answered (or if it cannot). */
export function useWorkspaceRoot(): string | null {
  return useSystemDirs()?.workspaceRoot ?? null;
}

/** The projects directory, or null until the server has answered (or if it does not say). */
export function useProjectsDir(): string | null {
  return useSystemDirs()?.projectsDir ?? null;
}

/** Drops the cached answer so each test starts from a fresh session. */
export function __resetWorkspaceRootForTests(): void {
  cached = null;
  inflight = null;
}
