import { isAbsolute, relative, resolve, sep } from "node:path";
import { getConfig } from "../config.js";
import { machineId } from "./hostname.js";

/** Minutes between automatic syncs when the config names no interval. */
export const DEFAULT_AUTO_SYNC_INTERVAL_MINUTES = 60;

/** Committed with the data paths: custom OmniVoice voices, one dir per voice (design D11). */
const VOICES_PATH = ".pavilio/voices/";

export interface AutoSyncSettings {
  repo: string;
  hostname: string;
  intervalMinutes: number;
  dataPaths: string[];
  generatedPaths: string[];
  machinePaths: string[];
  notifyCmd?: string;
}

/**
 * Auto-sync settings from the loaded panel config — one source for the routes and
 * the scheduler started at boot. Call after loadConfig(): the machine id and the
 * preferences path both follow panel.config.local.ts.
 */
export function autoSyncSettings(): AutoSyncSettings {
  const c = getConfig();
  const repo = resolve(c.projectsDir, "..");
  const a = c.autoSync;
  return {
    repo,
    hostname: machineId(),
    intervalMinutes: a?.intervalMinutes ?? DEFAULT_AUTO_SYNC_INTERVAL_MINUTES,
    dataPaths: a?.dataPaths ?? ["projects/"],
    generatedPaths: a?.generatedPaths ?? [],
    machinePaths: [...ownPreferencesPath(repo, c.preferencesPath), VOICES_PATH],
    notifyCmd: a?.notifyCmd,
  };
}

/** This machine's preferences file relative to repo, or nothing when it lives outside it. */
function ownPreferencesPath(repo: string, preferencesPath: string | undefined): string[] {
  if (!preferencesPath) return [];
  const rel = relative(repo, resolve(repo, preferencesPath));
  // Segment check, not a prefix one: "..prefs.json" is a file inside the repo.
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) return [];
  return [rel.split(sep).join("/")];
}
