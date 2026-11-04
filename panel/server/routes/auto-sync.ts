import { Router } from "express";
import { autoSyncSettings } from "../lib/autoSyncConfig.js";
import { syncRepo, getSyncStatus, isStale } from "../lib/syncRepo.js";
import { isEnabled, setEnabled } from "../lib/autoSyncState.js";
import { startScheduler, stopScheduler } from "../lib/autoSyncScheduler.js";

const router = Router();

router.get("/status", (_req, res) => {
  const { intervalMinutes } = autoSyncSettings();
  res.json({ enabled: isEnabled(), ...getSyncStatus(), stale: isStale(intervalMinutes), intervalMinutes });
});

router.post("/enable", async (_req, res) => {
  const s = autoSyncSettings();
  setEnabled(true);
  startScheduler({
    repo: s.repo,
    hostname: s.hostname,
    dataPaths: s.dataPaths,
    generatedPaths: s.generatedPaths,
    machinePaths: s.machinePaths,
    intervalMinutes: s.intervalMinutes,
    notifyCmd: s.notifyCmd,
  });
  res.json({ enabled: true, ...getSyncStatus(), stale: isStale(s.intervalMinutes), intervalMinutes: s.intervalMinutes });
});

router.post("/disable", (_req, res) => {
  const { intervalMinutes } = autoSyncSettings();
  setEnabled(false);
  stopScheduler();
  res.json({ enabled: false, ...getSyncStatus(), stale: isStale(intervalMinutes), intervalMinutes });
});

router.post("/now", async (_req, res) => {
  const s = autoSyncSettings();
  const status = await syncRepo(s.repo, {
    dataPaths: s.dataPaths,
    generatedPaths: s.generatedPaths,
    machinePaths: s.machinePaths,
    hostname: s.hostname,
  });
  res.json({ enabled: isEnabled(), ...status, stale: isStale(s.intervalMinutes), intervalMinutes: s.intervalMinutes });
});

export default router;
