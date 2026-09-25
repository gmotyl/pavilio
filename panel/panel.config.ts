import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface PanelConfig {
  /** Absolute path to the projects directory (contains project subfolders with PROJECT.md) */
  projectsDir: string;
  /** Port for the dev server */
  port: number;
  /** Path to agent registry file */
  agentRegistryPath: string;
  /** Path to the workspace preferences document (read once at boot) */
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
    /** Minutes between automatic syncs */
    intervalMinutes: number;
    /** Paths (relative to repo root) auto-committed each tick */
    dataPaths: string[];
    /** Paths (relative to repo root) rsynced in by scripts/update.sh. Never committed by
     *  auto-sync — used only to classify conflicts in the resolution prompt. */
    generatedPaths?: string[];
    /** Optional shell command fired when sync needs attention (conflict/push-failed/stale).
     *  Gets SYNC_STATE + SYNC_DETAIL env vars. Example (macOS):
     *  `osascript -e "display notification \"$SYNC_DETAIL\" with title \"Pavilio sync: $SYNC_STATE\""` */
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
  projectsDir: resolve(__dirname, "../projects"),
  port: 3010,
  agentRegistryPath: resolve(process.env.HOME || "~", ".agent-registry.json"),
  // One level above panel/ — the repo root in a source clone, the workspace
  // root in the rsync mirror where panel/ is itself a synced copy.
  preferencesPath: resolve(__dirname, "../.pavilio/preferences.json"),
  watchDebounceMs: 300,
  answerWaveDebounceMs: answerWaveDebounceMsFromEnv(),
  ignorePatterns: [
    "**/node_modules/**",
    "**/.DS_Store",
    "**/.git/**",
    "**/log/*.txt",
  ],
  autoSync: {
    intervalMinutes: 15,
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
