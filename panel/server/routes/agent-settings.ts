import { Router } from "express";
// `node:` prefixed so a suite's `vi.mock("node:child_process")` intercepts it.
import { exec } from "node:child_process";
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

/**
 * One Workspace Action, described once — here.
 *
 * The panel used to carry this list in the React component as a set of
 * `pnpm run <id>` strings, and half of them named scripts that only ever
 * existed in the maintainer's private workspace: on a fresh upstream clone
 * every button in Settings → Workspace Actions failed. So the catalogue moved
 * server-side, where it can be intersected with what the workspace's own
 * package.json actually defines, and the component renders whatever it is given.
 *
 * `id` is the stable handle the client posts back; `script` is the package
 * script it maps to. They differ where the button's name and the script's name
 * have drifted apart (`init:claude` → `setup:claude-code`), and they stay
 * differing on purpose: the ids are the wire contract with the UI, so renaming a
 * package script changes `script` alone and leaves every posted id untouched.
 */
export interface WorkspaceAction {
  id: string;
  script: string;
  label: string;
  description: string;
}

/** The order here is the order the Settings page shows them in. */
export const WORKSPACE_ACTIONS: WorkspaceAction[] = [
  {
    // id stays "setup" — it is the wire contract with the UI (and the key
    // LONG_RUNNING_IDS looks up). Only the package script was renamed, because
    // `pnpm setup` is one of pnpm's own subcommands.
    id: "setup",
    script: "bootstrap",
    label: "Setup workspace",
    description:
      "Runs the one-shot workspace setup: installs the panel's dependencies, resolves a node/pnpm toolchain, and writes the per-host launcher config. Idempotent — safe to re-run on an already-working clone.",
  },
  {
    // Same as above: the id is unchanged, the package script is now `upgrade`
    // because `pnpm update` is pnpm's own dependency updater.
    id: "update",
    script: "upgrade",
    label: "Update",
    description:
      "Pulls the latest pavilio, reinstalls dependencies and rebuilds the panel. The panel still has to be restarted afterwards for the new build to be served.",
  },
  {
    id: "init:claude",
    script: "setup:claude-code",
    label: "Init Claude",
    description:
      "Installs this workspace's skills (skills/*/SKILL.md) as Claude Code slash commands under .claude/commands/, so they are invocable from any session started here.",
  },
  {
    id: "init:opencode",
    script: "setup:opencode",
    label: "Init OpenCode",
    description:
      "Installs this workspace's skills and commands for OpenCode — symlinks under ~/.claude/skills/ plus .opencode/commands/ — so the same slash commands work there as in Claude Code.",
  },
  {
    id: "init:codex",
    script: "setup:codex",
    label: "Init Codex",
    description:
      "Installs this workspace's skills as Codex prompts and wires up its hooks, so Codex sessions started here share the same commands as the other agents.",
  },
  {
    id: "install:speech",
    script: "install:speech",
    label: "Install speech",
    description:
      "Installs the speech hook into your agent configs, so a finished turn is spoken aloud and its answer is forwarded to the panel.",
  },
  {
    id: "setup:backup",
    script: "setup:backup",
    label: "Backup Configs",
    description:
      "Copies your Claude Code, OpenCode and Kilo Code configuration into backup-git/dotfiles/, then commits and pushes it. Read-only with respect to your live configs — safe to run at any time.",
  },
  {
    id: "setup:restore",
    script: "setup:restore",
    label: "Restore & Bootstrap",
    description:
      "Full machine bootstrap: clones the registered repositories and restores .env files, dotfiles and every agent config from backup-git/dotfiles/. Existing files are skipped unless --force is passed.",
  },
];

/** Long-running actions, in milliseconds. Everything else gets two minutes. */
const LONG_RUNNING_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 120_000;
// Keyed by action id, not by script name — the ids above are deliberately
// stable across script renames.
const LONG_RUNNING_IDS = new Set(["setup", "update", "setup:restore"]);

/** The workspace above `projects/` — never the panel directory. */
function workspaceRoot(): string {
  const { projectsDir } = getConfig();
  return resolve(projectsDir, "..");
}

/** The script names the workspace's own package.json defines, if any. */
function definedScripts(root: string): Set<string> {
  const pkgPath = resolve(root, "package.json");
  if (!existsSync(pkgPath)) return new Set();
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { scripts?: Record<string, string> };
    return new Set(Object.keys(pkg.scripts ?? {}));
  } catch {
    // A workspace whose package.json will not parse offers no actions rather
    // than taking the whole Settings page down with it.
    return new Set();
  }
}

router.get("/actions", (_req, res) => {
  const defined = definedScripts(workspaceRoot());
  res.json(WORKSPACE_ACTIONS.filter((action) => defined.has(action.script)));
});

router.post("/run-action", (req, res) => {
  const { action } = req.body as { action?: string };
  // The request only ever selects a catalogue entry; nothing it sends reaches
  // the shell. The command below is built from `entry.script`, which is a
  // literal in this file, so the injection surface is structural, not a matter
  // of how well the id was validated.
  const entry = WORKSPACE_ACTIONS.find((candidate) => candidate.id === action);
  if (!entry) {
    return res.status(400).json({ error: "Unknown action" });
  }

  const root = workspaceRoot();
  if (!existsSync(resolve(root, "package.json"))) {
    return res.status(404).json({ error: "No package.json found in workspace root" });
  }
  if (!definedScripts(root).has(entry.script)) {
    return res.status(404).json({ error: `Script ${entry.script} not defined in package.json` });
  }

  const timeout = LONG_RUNNING_IDS.has(entry.id) ? LONG_RUNNING_MS : DEFAULT_TIMEOUT_MS;

  // `scripts/pm` is the workspace's own toolchain resolver: it finds a node and
  // decides between pnpm and npm. Hard-coding `pnpm` here is exactly what broke
  // these buttons on machines that only have npm, or whose pnpm is behind a
  // version manager the panel's own environment never loaded.
  const command = `. scripts/pm && pm_resolve && pm_in . ${entry.script}`;

  exec(command, { cwd: root, timeout, shell: "/bin/bash" }, (err, stdout, stderr) => {
    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    if (err?.killed) {
      return res.status(504).json({ ok: false, output: "Action timed out" });
    }
    res.json({ ok: !err, output: output || (err ? err.message : "Done") });
  });
});

export default router;
