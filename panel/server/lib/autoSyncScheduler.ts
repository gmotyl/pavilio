import { syncRepo, type SyncOpts } from "./syncRepo.js";

let handle: NodeJS.Timeout | null = null;

interface SchedulerOpts extends SyncOpts {
  repo: string;
  intervalMinutes: number;
}

export function startScheduler(opts: SchedulerOpts): void {
  stopScheduler();
  const tick = () => {
    void syncRepo(opts.repo, { dataPaths: opts.dataPaths, hostname: opts.hostname })
      .catch((e) => console.error("[auto-sync] tick failed:", e));
  };
  tick(); // run immediately on start
  handle = setInterval(tick, opts.intervalMinutes * 60_000);
}

export function stopScheduler(): void {
  if (handle) { clearInterval(handle); handle = null; }
}

export function isRunning(): boolean {
  return handle !== null;
}
