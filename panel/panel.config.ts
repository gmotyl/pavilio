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
  /** File watching debounce in ms */
  watchDebounceMs: number;
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
    /** Optional shell command fired when sync needs attention (conflict/push-failed/stale).
     *  Gets SYNC_STATE + SYNC_DETAIL env vars. Example (macOS):
     *  `osascript -e "display notification \"$SYNC_DETAIL\" with title \"Pavilio sync: $SYNC_STATE\""` */
    notifyCmd?: string;
  };
}

const defaults: PanelConfig = {
  projectsDir: resolve(__dirname, "../projects"),
  port: 3010,
  agentRegistryPath: resolve(process.env.HOME || "~", ".agent-registry.json"),
  watchDebounceMs: 300,
  ignorePatterns: [
    "**/node_modules/**",
    "**/.DS_Store",
    "**/.git/**",
    "**/log/*.txt",
  ],
  autoSync: {
    intervalMinutes: 30,
    dataPaths: ["projects/"],
  },
};

export default defaults;
