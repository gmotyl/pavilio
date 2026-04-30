import { Router } from "express";
import { exec } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import { getConfig } from "../config.js";

const router = Router();

interface SettingsFile {
  name: string;
  path: string;
  exists: boolean;
  size?: number;
  modified?: number;
  editable?: boolean;
}

interface AgentConfig {
  agent: string;
  icon: string;
  files: SettingsFile[];
}

function probe(name: string, absPath: string, editable = false): SettingsFile {
  const exists = existsSync(absPath);
  if (!exists) return { name, path: absPath, exists };
  const stat = statSync(absPath);
  return { name, path: absPath, exists, size: stat.size, modified: stat.mtimeMs, ...(editable && { editable }) };
}

function probeDir(dirPath: string, ext: string, editable = false): SettingsFile[] {
  if (!existsSync(dirPath)) return [];
  try {
    return readdirSync(dirPath)
      .filter((f) => f.endsWith(ext))
      .map((f) => probe(f, resolve(dirPath, f), editable));
  } catch {
    return [];
  }
}

const home = homedir();

function getAgentConfigs(): AgentConfig[] {
  const opencodeAgents = probeDir(resolve(home, ".config/opencode/agents"), ".md", true);

  return [
    {
      agent: "Claude Code",
      icon: "claude",
      files: [
        probe("settings.json", resolve(home, ".claude/settings.json")),
        probe("settings.local.json", resolve(home, ".claude/settings.local.json")),
        probe("hooks.json", resolve(home, ".claude/hooks.json")),
        probe("policy-limits.json", resolve(home, ".claude/policy-limits.json")),
      ].filter((f) => f.exists),
    },
    {
      agent: "OpenCode",
      icon: "opencode",
      files: [
        probe("ocx.jsonc", resolve(home, ".config/opencode/ocx.jsonc")),
        probe("opencode.json", resolve(home, ".config/opencode/opencode.json")),
        ...opencodeAgents,
      ].filter((f) => f.exists),
    },
    {
      agent: "Kilo Code",
      icon: "kilo",
      files: [
        probe("kilo.jsonc", resolve(home, ".config/kilo/kilo.jsonc")),
      ].filter((f) => f.exists),
    },
    {
      agent: "Qwen Code",
      icon: "qwen",
      files: [
        probe("settings.json", resolve(home, ".qwen/settings.json")),
      ].filter((f) => f.exists),
    },
    {
      agent: "Gemini CLI",
      icon: "gemini",
      files: [
        probe("settings.json", resolve(home, ".gemini/settings.json")),
        probe("projects.json", resolve(home, ".gemini/projects.json")),
        probe("trustedFolders.json", resolve(home, ".gemini/trustedFolders.json")),
      ].filter((f) => f.exists),
    },
  ].filter((a) => a.files.length > 0);
}

router.get("/", (_req, res) => {
  res.json(getAgentConfigs());
});

router.get("/read", (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: "Missing path parameter" });

  // Only allow reading known agent config paths under home directory
  const resolved = resolve(filePath);
  if (!resolved.startsWith(home)) {
    return res.status(403).json({ error: "Path outside home directory" });
  }
  if (!existsSync(resolved)) {
    return res.status(404).json({ error: "File not found" });
  }

  const content = readFileSync(resolved, "utf-8");
  res.json({ path: resolved, content });
});

router.post("/write", (req, res) => {
  const { path: filePath, content } = req.body as { path?: string; content?: string };
  if (!filePath || content == null) return res.status(400).json({ error: "Missing path or content" });

  const resolved = resolve(filePath);
  if (!resolved.startsWith(home)) {
    return res.status(403).json({ error: "Path outside home directory" });
  }
  if (!existsSync(resolved)) {
    return res.status(404).json({ error: "File not found" });
  }

  writeFileSync(resolved, content, "utf-8");
  const stat = statSync(resolved);
  res.json({ path: resolved, size: stat.size, modified: stat.mtimeMs });
});

const ALLOWED_ACTIONS = new Set(["init:claude", "init:opencode", "setup:backup", "setup:restore"]);

router.post("/run-action", (req, res) => {
  const { action } = req.body as { action?: string };
  if (!action || !ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ error: "Unknown action" });
  }

  const { projectsDir } = getConfig();
  const workspaceRoot = resolve(projectsDir, "..");
  if (!existsSync(resolve(workspaceRoot, "package.json"))) {
    return res.status(404).json({ error: "No package.json found in workspace root" });
  }

  const timeout = action === "setup:restore" ? 300_000 : 120_000;

  exec(`pnpm run ${action}`, { cwd: workspaceRoot, timeout }, (err, stdout, stderr) => {
    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    if (err?.killed) {
      return res.status(504).json({ ok: false, output: "Action timed out" });
    }
    res.json({ ok: !err, output: output || (err ? err.message : "Done") });
  });
});

export default router;
