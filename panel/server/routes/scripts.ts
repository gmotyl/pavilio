import { Router } from "express";
import { existsSync, readFileSync, statSync } from "fs";
import { join, resolve, sep } from "path";
import { getConfig } from "../config.js";

export interface ScriptEntry {
  id: string;
  label: string;
  description: string;
  script: string;
  outputMatch?: string;
  icon?: string;
  timeoutSec?: number;
}

export interface ScriptsConfig {
  scripts: ScriptEntry[];
}

interface CacheState {
  path: string;
  mtimeMs: number;
  value: ScriptsConfig;
}
let cache: CacheState | null = null;

export function loadScriptsConfig(workspaceRoot: string): ScriptsConfig {
  const path = join(workspaceRoot, "scripts", "scripts.json");
  if (!existsSync(path)) {
    cache = null;
    return { scripts: [] };
  }
  const mtimeMs = statSync(path).mtimeMs;
  if (cache && cache.path === path && cache.mtimeMs === mtimeMs) {
    return cache.value;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    console.warn(`[scripts] invalid JSON in ${path}:`, (err as Error).message);
    return { scripts: [] };
  }
  const value: ScriptsConfig = {
    scripts: Array.isArray((parsed as ScriptsConfig)?.scripts)
      ? ((parsed as ScriptsConfig).scripts as ScriptEntry[])
      : [],
  };
  cache = { path, mtimeMs, value };
  return value;
}

const router = Router();

router.get("/scripts", (_req, res) => {
  const { projectsDir } = getConfig();
  const workspaceRoot = resolve(projectsDir, "..");
  res.json(loadScriptsConfig(workspaceRoot));
});

export default router;
