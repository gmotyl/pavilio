import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { broadcast } from "../watcher.js";

export type SyncState =
  | "idle" | "syncing" | "synced" | "offline" | "conflict" | "push-failed" | "busy";

export interface SyncStatus {
  state: SyncState;
  lastSync: string | null; // ISO of last successful sync
  detail: string;
  summary: string; // e.g. "↑2 ↓1"
}

export interface SyncOpts {
  dataPaths: string[]; // e.g. ["projects/"]
  hostname: string;
}

let running = false;
let status: SyncStatus = { state: "idle", lastSync: null, detail: "", summary: "" };

export function getSyncStatus(): SyncStatus {
  return status;
}

function setStatus(next: Partial<SyncStatus>) {
  status = { ...status, ...next };
  broadcast({ type: "sync-status", ...status });
}

interface Run { ok: boolean; status: number | null; stdout: string; stderr: string; }
function git(cwd: string, args: string[]): Run {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8" });
  return { ok: r.status === 0, status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function midRebase(repo: string): boolean {
  return existsSync(join(repo, ".git/rebase-merge")) || existsSync(join(repo, ".git/rebase-apply"));
}

export async function syncRepo(repo: string, opts: SyncOpts): Promise<SyncStatus> {
  if (running) return { ...status, state: "busy" };
  running = true;
  setStatus({ state: "syncing", detail: "" });
  try {
    if (midRebase(repo)) {
      setStatus({ state: "conflict", detail: "Repo is mid-rebase — resolve manually." });
      return status;
    }

    const attempt = (): SyncStatus | null => {
      // fetch (connectivity probe)
      if (!git(repo, ["fetch", "--quiet"]).ok) {
        setStatus({ state: "offline", detail: "Remote unreachable." });
        return status;
      }
      // scoped auto-commit of data paths
      git(repo, ["add", "--", ...opts.dataPaths]);
      const staged = git(repo, ["diff", "--cached", "--quiet"]);
      if (staged.status === 1) {
        const ts = new Date().toISOString();
        git(repo, ["commit", "-m", `auto-sync ${opts.hostname} ${ts}`]);
      }
      // count local commits we are about to push (for summary)
      const ahead = git(repo, ["rev-list", "--count", "@{u}..HEAD"]).stdout.trim() || "0";
      // rebase onto upstream
      const pull = git(repo, ["pull", "--rebase", "--autostash"]);
      if (!pull.ok) {
        if (midRebase(repo)) git(repo, ["rebase", "--abort"]);
        setStatus({ state: "conflict", detail: "Rebase conflict — manual sync needed." });
        return status;
      }
      const behind = git(repo, ["rev-list", "--count", "HEAD@{1}..HEAD"]).stdout.trim() || "0";
      // push
      const push = git(repo, ["push"]);
      if (!push.ok) return null; // signal retry
      setStatus({
        state: "synced",
        lastSync: new Date().toISOString(),
        detail: "",
        summary: `↑${ahead} ↓${behind}`,
      });
      return status;
    };

    const first = attempt();
    if (first) return first;
    // push rejected (remote moved) → one retry
    const second = attempt();
    if (second) return second;
    setStatus({ state: "push-failed", detail: "Push rejected after retry." });
    return status;
  } finally {
    running = false;
  }
}
