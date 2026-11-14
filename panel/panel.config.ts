import { isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { realpathSync } from "fs";
import { machineHostname } from "./server/lib/machineName.js";
import { preferencesPathFor } from "./server/lib/preferencesPath.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** One level above panel/ — the repo root in a source clone, the workspace
 *  root in the rsync mirror where panel/ is itself a synced copy. */
const MODULE_ROOT = resolve(__dirname, "..");
const DEFAULT_WORKSPACE_ROOT = "/srv/git/prv/projects";

function selectWorkspaceRoot(): string {
  const override = process.env.PAVILIO_CANONICAL_ROOT;
  const moduleRootIdentity = realpathSync(MODULE_ROOT);

  if (override !== undefined) {
    if (!isAbsolute(override)) {
      throw new Error("Invalid PAVILIO_CANONICAL_ROOT: must be an absolute path to the same repository.");
    }
    let overrideIdentity: string;
    try {
      overrideIdentity = realpathSync(override);
    } catch {
      throw new Error("Invalid PAVILIO_CANONICAL_ROOT: path is inaccessible or does not exist.");
    }
    if (overrideIdentity !== moduleRootIdentity) {
      throw new Error("Invalid PAVILIO_CANONICAL_ROOT: must identify the same repository.");
    }
    return override;
  }

  try {
    if (realpathSync(DEFAULT_WORKSPACE_ROOT) === moduleRootIdentity) return DEFAULT_WORKSPACE_ROOT;
  } catch {
    // The canonical Mac path is optional; fall back to the module's root.
  }
  return MODULE_ROOT;
}

/** Selected logical spelling is retained even when it resolves through a symlink. */
export const WORKSPACE_ROOT = selectWorkspaceRoot();

export interface PanelConfig {
  /** Absolute path to the projects directory (contains project subfolders with PROJECT.md) */
  projectsDir: string;
  /** Port for the dev server */
  port: number;
  /** This machine's id in per-host files and the sync role (sanitized like a hostname).
   *  Set only in the machine's own panel.config.local.ts; defaults to the hostname. */
  machineId?: string;
  /** Path to agent registry file */
  agentRegistryPath: string;
  /** Path to this machine's workspace preferences document (read once at boot).
   *  Defaults to `.pavilio/preferences/<machineId>.json` under WORKSPACE_ROOT,
   *  recomputed by loadConfig() once a local `machineId` override is known. */
  preferencesPath: string;
  /** File watching debounce in ms */
  watchDebounceMs: number;
  /** How long a busy transition must persist before it may take the answer pane's body.
   *  Override with PAVILIO_ANSWER_WAVE_DEBOUNCE_MS; panel restart, no rebuild. */
  answerWaveDebounceMs: number;
  /** Glob patterns to ignore in file tree */
  ignorePatterns: string[];
  /** Absolute path to TLS certificate (.pem) — enables HTTPS when set together with tlsKey */
  tlsCert?: string;
  /** Absolute path to TLS private key (.pem) — enables HTTPS when set together with tlsCert */
  tlsKey?: string;
  /** Auto-sync settings for the data repo. Enabled flag lives in .autosync-state.json (default on). */
  autoSync?: {
    /** Minutes between automatic syncs. Default 60 (DEFAULT_AUTO_SYNC_INTERVAL_MINUTES). */
    intervalMinutes?: number;
    /** Paths (relative to repo root) auto-committed each tick */
    dataPaths: string[];
    /** Paths (relative to repo root) rsynced in by scripts/update.sh. Never committed by
     *  auto-sync — used only to classify conflicts in the resolution prompt. */
    generatedPaths?: string[];
    /** Optional shell command fired when sync needs attention (conflict/push-failed/blocked/stale).
     *  Gets SYNC_STATE + SYNC_DETAIL env vars. Pass them as argv, never splice them into a
     *  script string — the detail can name files containing quotes. Example (macOS):
     *  `osascript -e 'on run argv' -e 'display notification (item 2 of argv) with title ("Pavilio sync: " & item 1 of argv)' -e 'end run' "$SYNC_STATE" "$SYNC_DETAIL"` */
    notifyCmd?: string;
  };
}

/**
 * The debounce every malformed override lands on, and the value the client
 * assumes when the boot document says nothing.
 *
 * It is spelt a second time in `src/features/terminal/answerWaveDebounce.ts`
 * rather than imported: that module is browser code and this one is not —
 * `tsconfig.json` covers `src` alone, `tsconfig.node.json` covers the server —
 * and the client default exists for a case the server cannot reach anyway (a
 * page whose boot document predates the key, or never loaded).
 */
const DEFAULT_ANSWER_WAVE_DEBOUNCE_MS = 3000;

/**
 * The debounce this process was started with.
 *
 * Read once, at import, which is the whole point of the knob: it changes with a
 * panel restart and no rebuild, unlike a `VITE_*` variable that would be baked
 * into the bundle. `Number` alone is not enough of a guard — `Number("")` is 0
 * and `Number("-1")` is truthy — and both of those are worse than the default:
 * a zero or negative delay is no debounce at all, which is exactly the
 * reattach false positive the debounce exists to stop.
 */
function answerWaveDebounceMsFromEnv(): number {
  const raw = process.env.PAVILIO_ANSWER_WAVE_DEBOUNCE_MS;
  if (raw === undefined) return DEFAULT_ANSWER_WAVE_DEBOUNCE_MS;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ANSWER_WAVE_DEBOUNCE_MS;
  return parsed;
}

const defaults: PanelConfig = {
  projectsDir: join(WORKSPACE_ROOT, "projects"),
  port: 3010,
  agentRegistryPath: resolve(process.env.HOME || "~", ".agent-registry.json"),
  // The hostname stands in for machineId until panel.config.local.ts is merged.
  preferencesPath: preferencesPathFor(WORKSPACE_ROOT, machineHostname()),
  watchDebounceMs: 300,
  answerWaveDebounceMs: answerWaveDebounceMsFromEnv(),
  ignorePatterns: [
    "**/node_modules/**",
    "**/.DS_Store",
    "**/.git/**",
    "**/log/*.txt",
  ],
  autoSync: {
    intervalMinutes: 60,
    dataPaths: ["projects/"],
    generatedPaths: [
      "panel/",
      "skills/",
      "scripts/",
      "commands/",
      ".opencode/",
      ".claude/commands/",
      "opencode.json",
    ],
  },
};

export default defaults;
