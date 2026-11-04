import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { broadcast } from "../watcher.js";
import { gitSafeEnv } from "./gitEnv.js";
import { buildConflictPrompt } from "./buildConflictPrompt.js";

export type SyncState =
  | "idle" | "syncing" | "synced" | "offline" | "conflict" | "push-failed" | "busy" | "blocked";

export interface SyncStatus {
  state: SyncState;
  lastSync: string | null; // ISO of last successful sync
  detail: string;
  summary: string; // e.g. "↑2 ↓1"
  /** Paths left unmerged by a failed merge, read before the abort. Empty in every other state. */
  conflictFiles: string[];
  /** Ready-to-paste resolution instructions. Empty unless state is "conflict". */
  conflictPrompt: string;
  /** Uncommitted non-data files the incoming merge would overwrite. Empty unless state is "blocked". */
  blockedFiles: string[];
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
let status: SyncStatus = {
  state: "idle", lastSync: null, detail: "", summary: "", conflictFiles: [], conflictPrompt: "", blockedFiles: [],
};

export function getSyncStatus(): SyncStatus {
  return status;
}

/** True when the last successful sync is older than 3x the scheduler interval. */
export function isStale(intervalMinutes: number, now = Date.now()): boolean {
  if (!status.lastSync) return false;
  return now - Date.parse(status.lastSync) > 3 * intervalMinutes * 60_000;
}

function setStatus(next: Partial<SyncStatus>) {
  // blockedFiles belongs to the "blocked" state alone; every other outcome clears it.
  status = { ...status, blockedFiles: [], ...next };
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
    // env: GIT_DIR and friends outrank cwd, so an inherited one would point every
    // sync at whichever repository launched us. See gitEnv.ts.
    // LC_ALL=C: the overwrite refusal is recognised by its message, which git localises.
    const child = spawn("git", args, {
      cwd,
      env: { ...gitSafeEnv(), LC_ALL: "C" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
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

function midOperation(repo: string): "merge" | "rebase" | null {
  if (existsSync(join(repo, ".git/rebase-merge")) || existsSync(join(repo, ".git/rebase-apply"))) return "rebase";
  if (existsSync(join(repo, ".git/MERGE_HEAD"))) return "merge";
  return null;
}

/**
 * Files named by git's refusal to merge over local changes, e.g.
 *   error: Your local changes to the following files would be overwritten by merge:
 *   \ttool.txt
 *   Please commit your changes or stash them before you merge.
 * (and the "untracked working tree files would be overwritten" variant). Needs LC_ALL=C.
 */
function parseOverwrittenFiles(stderr: string): string[] {
  const files: string[] = [];
  let inList = false;
  for (const line of stderr.split("\n")) {
    if (/would be overwritten by (merge|checkout)/.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    if (/^\s/.test(line) && line.trim()) files.push(line.trim());
    else inList = false;
  }
  return [...new Set(files)];
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
    const paths = opts.dataPaths.filter((p) => p && p.trim().length > 0);
    const t = opts.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;

    const inProgress = midOperation(repo);
    if (inProgress) {
      // Name the files and hand over a prompt here too — otherwise this path is the
      // "no files, no route out" dead-end. Do NOT abort: this rebase is not ours (a
      // crashed earlier tick, or a human mid-resolve), and aborting would discard
      // their work. buildConflictPrompt's aborted:false branch says so.
      const unmerged = (await git(repo, ["diff", "--name-only", "--diff-filter=U"], t)).stdout
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      // Mid-rebase HEAD is detached, so ask for the branch being rebased.
      const rebasing = (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"], t)).stdout.trim();
      setStatusFor(myGen, {
        state: "conflict",
        detail: `Repo is mid-${inProgress} — resolve manually.`,
        conflictFiles: unmerged,
        conflictPrompt: buildConflictPrompt({
          repoRoot: repo,
          branch: rebasing || "HEAD",
          conflictFiles: unmerged,
          dataPaths: paths,
          generatedPaths: opts.generatedPaths ?? [],
          aborted: false,
          operation: inProgress,
        }),
      });
      return status;
    }
    if (paths.length === 0) {
      setStatusFor(myGen, { state: "push-failed", detail: "No data paths configured.", conflictFiles: [], conflictPrompt: "" });
      return status;
    }

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
      const didCommit = staged.status === 1;
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
      // Merge upstream in. Never rebase: a human's merge resolution must survive the
      // tick instead of being linearised (and re-conflicted) away. No --autostash: a
      // dirty non-data file the merge would overwrite makes git refuse untouched, and
      // that refusal surfaces as "blocked" rather than as a hidden stash.
      const pull = await git(repo, ["pull", "--no-rebase", "--no-edit"], t);
      if (!pull.ok) {
        const overwritten = parseOverwrittenFiles(pull.stderr);
        if (midOperation(repo) === "merge") {
          // Unmerged paths exist only while the merge is in progress — read them
          // before the abort wipes them, so the UI can name what broke.
          const unmerged = (await git(repo, ["diff", "--name-only", "--diff-filter=U"], t)).stdout
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
          await git(repo, ["merge", "--abort"], t);
          const branch = (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"], t)).stdout.trim();
          setStatusFor(myGen, {
            state: "conflict",
            detail: "Merge conflict — manual sync needed.",
            conflictFiles: unmerged,
            conflictPrompt: buildConflictPrompt({
              repoRoot: repo,
              branch,
              conflictFiles: unmerged,
              dataPaths: paths,
              generatedPaths: opts.generatedPaths ?? [],
              operation: "merge",
            }),
          });
        } else if (overwritten.length > 0) {
          setStatusFor(myGen, {
            state: "blocked",
            detail: `Local changes to ${overwritten.join(", ")} block the sync — commit or discard them.`,
            conflictFiles: [],
            conflictPrompt: "",
            blockedFiles: overwritten,
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
      // The working tree moved (we committed, or the merge brought commits in), so any
      // open file list is now stale. sync-status alone does not tell views that; without
      // this the /git page keeps showing files that are already committed until a reload.
      // Skipped on a no-op sync so an idle tick does not make every client refetch.
      if (didCommit || ahead !== "0" || behind !== "0") {
        broadcast({ type: "git-change" });
      }
      return status;
    };

    const first = await attempt();
    if (first) return first;
    // push rejected (remote moved) → one retry: fetch, merge again, push again
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
