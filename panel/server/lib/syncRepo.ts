import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { broadcast } from "../watcher.js";
import { buildConflictPrompt } from "./buildConflictPrompt.js";

export type SyncState =
  | "idle" | "syncing" | "synced" | "offline" | "conflict" | "push-failed" | "busy";

export interface SyncStatus {
  state: SyncState;
  lastSync: string | null; // ISO of last successful sync
  detail: string;
  summary: string; // e.g. "↑2 ↓1"
  /** Paths left unmerged by a failed rebase, read before the abort. Empty in every other state. */
  conflictFiles: string[];
  /** Ready-to-paste resolution instructions. Empty unless state is "conflict". */
  conflictPrompt: string;
}

export interface SyncOpts {
  dataPaths: string[]; // e.g. ["projects/"]
  /** Paths rsynced in by update.sh. Used only to classify conflicts in the prompt. */
  generatedPaths?: string[];
  hostname: string;
  /** Hard per-git-command timeout. On expiry the whole process group (git + ssh) is SIGKILLed. */
  gitTimeoutMs?: number;
  /** If a previous run is still flagged running after this long, assume it is stuck and proceed. */
  watchdogMs?: number;
}

let running = false;
let runningSince = 0;
let generation = 0;
let status: SyncStatus = { state: "idle", lastSync: null, detail: "", summary: "", conflictFiles: [], conflictPrompt: "" };

export function getSyncStatus(): SyncStatus {
  return status;
}

/** True when the last successful sync is older than 3x the scheduler interval. */
export function isStale(intervalMinutes: number, now = Date.now()): boolean {
  if (!status.lastSync) return false;
  return now - Date.parse(status.lastSync) > 3 * intervalMinutes * 60_000;
}

function setStatus(next: Partial<SyncStatus>) {
  status = { ...status, ...next };
  broadcast({ type: "sync-status", ...status });
}

// Guards against a stale run (force-reset by the watchdog) clobbering the
// status/broadcast of the newer run that superseded it.
function setStatusFor(gen: number, next: Partial<SyncStatus>) {
  if (gen !== generation) return;
  setStatus(next);
}

const DEFAULT_GIT_TIMEOUT_MS = 120_000;
const DEFAULT_WATCHDOG_MS = 15 * 60_000;

interface Run { ok: boolean; status: number | null; stdout: string; stderr: string; timedOut: boolean; }

// spawn with detached:true puts git in its own process group so a timeout kill
// also reaps grandchildren (ssh) — a hung ssh once kept the runner alive for 19h.
function git(cwd: string, args: string[], timeoutMs = DEFAULT_GIT_TIMEOUT_MS): Promise<Run> {
  return new Promise((done) => {
    const child = spawn("git", args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the process group (negative pid) and the child process as a fallback
      if (child.pid != null && child.pid > 0) {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);
    child.on("error", () => { clearTimeout(timer); done({ ok: false, status: null, stdout, stderr, timedOut }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ ok: code === 0 && !timedOut, status: code, stdout, stderr, timedOut });
    });
  });
}

function midRebase(repo: string): boolean {
  return existsSync(join(repo, ".git/rebase-merge")) || existsSync(join(repo, ".git/rebase-apply"));
}

export async function syncRepo(repo: string, opts: SyncOpts): Promise<SyncStatus> {
  const watchdog = opts.watchdogMs ?? DEFAULT_WATCHDOG_MS;
  if (running) {
    if (Date.now() - runningSince <= watchdog) return { ...status, state: "busy" };
    console.error("[auto-sync] watchdog: previous run stuck — force-resetting running flag");
  }
  running = true;
  runningSince = Date.now();
  const myGen = ++generation;
  setStatusFor(myGen, { state: "syncing", detail: "", conflictFiles: [], conflictPrompt: "" });
  try {
    if (midRebase(repo)) {
      setStatusFor(myGen, { state: "conflict", detail: "Repo is mid-rebase — resolve manually.", conflictFiles: [], conflictPrompt: "" });
      return status;
    }

    const paths = opts.dataPaths.filter((p) => p && p.trim().length > 0);
    if (paths.length === 0) {
      setStatusFor(myGen, { state: "push-failed", detail: "No data paths configured.", conflictFiles: [], conflictPrompt: "" });
      return status;
    }

    const t = opts.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;

    const attempt = async (): Promise<SyncStatus | null> => {
      // fetch (connectivity probe)
      if (!(await git(repo, ["fetch", "--quiet"], t)).ok) {
        setStatusFor(myGen, { state: "offline", detail: "Remote unreachable.", conflictFiles: [], conflictPrompt: "" });
        return status;
      }
      // commits about to be pulled from remote (for summary)
      const behind = (await git(repo, ["rev-list", "--count", "HEAD..@{u}"], t)).stdout.trim() || "0";
      // scoped auto-commit: stage AND commit only data paths, so a user's
      // manually-staged files (e.g. half-edited panel code) are never swept in.
      await git(repo, ["add", "--", ...paths], t);
      const staged = await git(repo, ["diff", "--cached", "--quiet", "--", ...paths], t);
      if (staged.status === 1) {
        const ts = new Date().toISOString();
        const commit = await git(repo, ["commit", "-m", `auto-sync ${opts.hostname} ${ts}`, "--", ...paths], t);
        if (!commit.ok) {
          setStatusFor(myGen, { state: "push-failed", detail: `Commit failed: ${commit.stderr.trim() || "unknown error"}`, conflictFiles: [], conflictPrompt: "" });
          return status;
        }
      }
      // local commits to push (for summary)
      const ahead = (await git(repo, ["rev-list", "--count", "@{u}..HEAD"], t)).stdout.trim() || "0";
      // rebase onto upstream
      const pull = await git(repo, ["pull", "--rebase", "--autostash"], t);
      if (!pull.ok) {
        if (midRebase(repo)) {
          // Unmerged paths exist only while the rebase is in progress — read them
          // before the abort wipes them, so the UI can name what broke.
          const unmerged = (await git(repo, ["diff", "--name-only", "--diff-filter=U"], t)).stdout
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
          // Read the branch while the rebase is still active: mid-rebase HEAD is detached,
          // so ask for the branch being rebased and fall back to the plain symbolic name.
          const rebasing = (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"], t)).stdout.trim();
          await git(repo, ["rebase", "--abort"], t);
          const branch =
            rebasing && rebasing !== "HEAD"
              ? rebasing
              : (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"], t)).stdout.trim();
          setStatusFor(myGen, {
            state: "conflict",
            detail: "Rebase conflict — manual sync needed.",
            conflictFiles: unmerged,
            conflictPrompt: buildConflictPrompt({
              repoRoot: repo,
              branch,
              conflictFiles: unmerged,
              dataPaths: paths,
              generatedPaths: opts.generatedPaths ?? [],
            }),
          });
        } else if (pull.timedOut) {
          setStatusFor(myGen, { state: "offline", detail: "Pull timed out — will retry next tick.", conflictFiles: [], conflictPrompt: "" });
        } else {
          const reason = pull.stderr.trim().split("\n")[0]?.slice(0, 160) || "network error";
          setStatusFor(myGen, { state: "offline", detail: `Pull failed: ${reason}`, conflictFiles: [], conflictPrompt: "" });
        }
        return status;
      }
      // push
      const push = await git(repo, ["push"], t);
      if (!push.ok) return null; // signal retry
      setStatusFor(myGen, {
        state: "synced",
        lastSync: new Date().toISOString(),
        detail: "",
        summary: `↑${ahead} ↓${behind}`,
        conflictFiles: [],
        conflictPrompt: "",
      });
      return status;
    };

    const first = await attempt();
    if (first) return first;
    // push rejected (remote moved) → one retry
    const second = await attempt();
    if (second) return second;
    setStatusFor(myGen, { state: "push-failed", detail: "Push rejected after retry.", conflictFiles: [], conflictPrompt: "" });
    return status;
  } catch (e: any) {
    // never leave the UI stuck in "syncing" on an unexpected throw
    setStatusFor(myGen, { state: "push-failed", detail: `Sync error: ${e?.message ?? e}`, conflictFiles: [], conflictPrompt: "" });
    return status;
  } finally {
    if (myGen === generation) running = false;
  }
}
