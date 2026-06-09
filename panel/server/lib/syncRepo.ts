import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { broadcast } from "../watcher.js";

const execFileAsync = promisify(execFile);

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

// Async git runner — execFile keeps network-bound git ops (fetch/pull/push) off
// the single Node event loop so the panel's terminals/websockets don't freeze.
async function git(cwd: string, args: string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd });
    return { ok: true, status: 0, stdout: stdout ?? "", stderr: stderr ?? "" };
  } catch (e: any) {
    return {
      ok: false,
      status: typeof e?.code === "number" ? e.code : null,
      stdout: e?.stdout ?? "",
      stderr: e?.stderr ?? "",
    };
  }
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

    const paths = opts.dataPaths.filter((p) => p && p.trim().length > 0);
    if (paths.length === 0) {
      setStatus({ state: "push-failed", detail: "No data paths configured." });
      return status;
    }

    const attempt = async (): Promise<SyncStatus | null> => {
      // fetch (connectivity probe)
      if (!(await git(repo, ["fetch", "--quiet"])).ok) {
        setStatus({ state: "offline", detail: "Remote unreachable." });
        return status;
      }
      // commits about to be pulled from remote (for summary)
      const behind = (await git(repo, ["rev-list", "--count", "HEAD..@{u}"])).stdout.trim() || "0";
      // scoped auto-commit: stage AND commit only data paths, so a user's
      // manually-staged files (e.g. half-edited panel code) are never swept in.
      await git(repo, ["add", "--", ...paths]);
      const staged = await git(repo, ["diff", "--cached", "--quiet", "--", ...paths]);
      if (staged.status === 1) {
        const ts = new Date().toISOString();
        const commit = await git(repo, ["commit", "-m", `auto-sync ${opts.hostname} ${ts}`, "--", ...paths]);
        if (!commit.ok) {
          setStatus({ state: "push-failed", detail: `Commit failed: ${commit.stderr.trim() || "unknown error"}` });
          return status;
        }
      }
      // local commits to push (for summary)
      const ahead = (await git(repo, ["rev-list", "--count", "@{u}..HEAD"])).stdout.trim() || "0";
      // rebase onto upstream
      const pull = await git(repo, ["pull", "--rebase", "--autostash"]);
      if (!pull.ok) {
        if (midRebase(repo)) await git(repo, ["rebase", "--abort"]);
        setStatus({ state: "conflict", detail: "Rebase conflict — manual sync needed." });
        return status;
      }
      // push
      const push = await git(repo, ["push"]);
      if (!push.ok) return null; // signal retry
      setStatus({
        state: "synced",
        lastSync: new Date().toISOString(),
        detail: "",
        summary: `↑${ahead} ↓${behind}`,
      });
      return status;
    };

    const first = await attempt();
    if (first) return first;
    // push rejected (remote moved) → one retry
    const second = await attempt();
    if (second) return second;
    setStatus({ state: "push-failed", detail: "Push rejected after retry." });
    return status;
  } catch (e: any) {
    // never leave the UI stuck in "syncing" on an unexpected throw
    setStatus({ state: "push-failed", detail: `Sync error: ${e?.message ?? e}` });
    return status;
  } finally {
    running = false;
  }
}
