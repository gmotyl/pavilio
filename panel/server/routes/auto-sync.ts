import { Router } from "express";
import { resolve } from "path";
import { getConfig } from "../config.js";
import { machineHostname } from "../lib/hostname.js";
import { syncRepo, getSyncStatus } from "../lib/syncRepo.js";
import { isEnabled, setEnabled } from "../lib/autoSyncState.js";
import { startScheduler, stopScheduler } from "../lib/autoSyncScheduler.js";

const router = Router();

function cfg() {
  const c = getConfig();
  const repo = resolve(c.projectsDir, "..");
  const autoSync = c.autoSync ?? { intervalMinutes: 30, dataPaths: ["projects/"] };
  return { repo, autoSync, hostname: machineHostname() };
}

router.get("/status", (_req, res) => {
  const { autoSync } = cfg();
  res.json({ enabled: isEnabled(), ...getSyncStatus(), intervalMinutes: autoSync.intervalMinutes });
});

router.post("/enable", async (_req, res) => {
  const { repo, autoSync, hostname } = cfg();
  setEnabled(true);
  startScheduler({ repo, hostname, dataPaths: autoSync.dataPaths, intervalMinutes: autoSync.intervalMinutes });
  res.json({ enabled: true, ...getSyncStatus(), intervalMinutes: autoSync.intervalMinutes });
});

router.post("/disable", (_req, res) => {
  const { autoSync } = cfg();
  setEnabled(false);
  stopScheduler();
  res.json({ enabled: false, ...getSyncStatus(), intervalMinutes: autoSync.intervalMinutes });
});

router.post("/now", async (_req, res) => {
  const { repo, autoSync, hostname } = cfg();
  const status = await syncRepo(repo, { dataPaths: autoSync.dataPaths, hostname });
  res.json({ enabled: isEnabled(), ...status, intervalMinutes: autoSync.intervalMinutes });
});

export default router;
