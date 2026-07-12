import { execFile } from "node:child_process";
import { syncRepo, isStale, type SyncOpts, type SyncStatus } from "./syncRepo.js";

let handle: NodeJS.Timeout | null = null;
let lastNotified: string | null = null;

interface SchedulerOpts extends SyncOpts {
  repo: string;
  intervalMinutes: number;
  /** Shell command run on transition into an attention state (conflict|push-failed|stale).
   *  Receives SYNC_STATE and SYNC_DETAIL env vars. Unset → no notification. */
  notifyCmd?: string;
}

const ATTENTION = new Set(["conflict", "push-failed"]);

function runNotifyCmd(cmd: string, state: string, detail: string): void {
  execFile("/bin/sh", ["-c", cmd], {
    env: { ...process.env, SYNC_STATE: state, SYNC_DETAIL: detail },
    timeout: 10_000,
  }, (e) => {
    if (e) console.error("[auto-sync] notifyCmd failed:", e.message);
  });
}

/** Decide + fire notification for a completed tick. Exported for tests. */
export async function _notifyForTest(
  s: Pick<SyncStatus, "state" | "detail">,
  opts: Pick<SchedulerOpts, "notifyCmd" | "intervalMinutes">,
): Promise<void> {
  const attention = isStale(opts.intervalMinutes) ? "stale" : ATTENTION.has(s.state) ? s.state : null;
  if (attention && attention !== lastNotified) {
    if (opts.notifyCmd) runNotifyCmd(opts.notifyCmd, attention, s.detail);
    lastNotified = attention;
  }
  if (!attention && (s.state === "synced" || s.state === "idle")) lastNotified = null; // re-arm on recovery
}

export function startScheduler(opts: SchedulerOpts): void {
  stopScheduler();
  const tick = async () => {
    try {
      const s = await syncRepo(opts.repo, {
        dataPaths: opts.dataPaths,
        hostname: opts.hostname,
        gitTimeoutMs: opts.gitTimeoutMs,
        watchdogMs: opts.watchdogMs,
      });
      await _notifyForTest(s, opts);
    } catch (e) {
      console.error("[auto-sync] tick failed:", e);
    }
  };
  void tick(); // run immediately on start
  handle = setInterval(() => void tick(), opts.intervalMinutes * 60_000);
}

export function stopScheduler(): void {
  if (handle) { clearInterval(handle); handle = null; }
  lastNotified = null;
}

export function isRunning(): boolean {
  return handle !== null;
}
