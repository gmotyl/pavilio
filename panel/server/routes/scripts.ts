import { Router } from "express";
import { execFile } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { join, resolve, sep } from "path";
import { getConfig } from "../config.js";

// Keep in sync with panel/src/features/projects/useWorkspaceScripts.ts
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

function projectExists(projectsDir: string, name: string): boolean {
  if (!name || name.includes("/") || name.includes("..") || name.includes("\0")) {
    return false;
  }
  const candidate = join(projectsDir, name);
  if (!existsSync(candidate)) return false;
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

export class ConfigError extends Error {}

export function resolveScriptPath(scriptField: string, workspaceRoot: string): string {
  const abs = resolve(workspaceRoot, scriptField);
  const scriptsDir = resolve(workspaceRoot, "scripts") + sep;
  if (!(abs + sep).startsWith(scriptsDir)) {
    throw new ConfigError("Script path is outside scripts/");
  }
  if (!abs.endsWith(".sh")) {
    throw new ConfigError("Script path must end in .sh");
  }
  if (!existsSync(abs)) {
    throw new ConfigError("Script file not found");
  }
  return abs;
}

function resolveTimeoutMs(timeoutSec: unknown): number {
  if (typeof timeoutSec === "number" && Number.isInteger(timeoutSec) && timeoutSec > 0) {
    return timeoutSec * 1000;
  }
  if (timeoutSec !== undefined) {
    console.warn(`[scripts] invalid timeoutSec ${String(timeoutSec)}, falling back to 60s`);
  }
  return 60_000;
}

function runScript(
  scriptAbs: string,
  projectName: string,
  projectsDir: string,
  timeoutMs: number,
): Promise<{ ok: boolean; output: string; durationMs: number }> {
  return new Promise((resolve) => {
    const start = Date.now();
    execFile(
      "bash",
      [scriptAbs, projectName],
      { cwd: projectsDir, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const durationMs = Date.now() - start;
        const output = [stdout, stderr].filter(Boolean).join("").trim();
        if (err && (err as NodeJS.ErrnoException).killed) {
          resolve({
            ok: false,
            output: `Timed out after ${Math.round(timeoutMs / 1000)}s\n${output}`.trim(),
            durationMs,
          });
          return;
        }
        resolve({ ok: !err, output, durationMs });
      },
    );
  });
}

const router = Router();

router.get("/scripts", (_req, res) => {
  const { projectsDir } = getConfig();
  const workspaceRoot = resolve(projectsDir, "..");
  res.json(loadScriptsConfig(workspaceRoot));
});

router.post("/projects/:name/scripts/:id/run", async (req, res) => {
  const { projectsDir } = getConfig();
  const workspaceRoot = resolve(projectsDir, "..");
  const { name, id } = req.params;

  if (!projectExists(projectsDir, name)) {
    return res.status(404).json({ error: `Unknown project: ${name}` });
  }

  const config = loadScriptsConfig(workspaceRoot);
  const entry = config.scripts.find((s) => s.id === id);
  if (!entry) {
    return res.status(404).json({ error: `Unknown script: ${id}` });
  }

  let scriptAbs: string;
  try {
    scriptAbs = resolveScriptPath(entry.script, workspaceRoot);
  } catch (err) {
    if (err instanceof ConfigError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

  const timeoutMs = resolveTimeoutMs(entry.timeoutSec);
  const result = await runScript(scriptAbs, name, projectsDir, timeoutMs);

  let matched: string | undefined;
  if (entry.outputMatch) {
    try {
      const re = new RegExp(entry.outputMatch);
      matched = re.exec(result.output)?.[1];
    } catch (err) {
      console.warn(`[scripts] invalid outputMatch for ${id}:`, (err as Error).message);
    }
  }

  res.json({
    ok: result.ok,
    output: result.output,
    durationMs: result.durationMs,
    ...(matched !== undefined ? { matched } : {}),
  });
});

export default router;
