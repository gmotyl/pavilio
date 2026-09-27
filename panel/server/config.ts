import defaults, { type PanelConfig } from "../panel.config.js";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const localPath = resolve(__dirname, "../panel.config.local.ts");

let config: PanelConfig = { ...defaults };

/**
 * Was the port named in the environment, rather than merely configured?
 *
 * The difference decides whether the panel may move: a configured port is a
 * preference and `findFreePort` is free to step past it, but a port the
 * operator asked for by name is an address other things are already pointed at.
 * `scripts/panel` waits on it, `scripts/panel stop` looks for a listener on it,
 * and the Windows launcher prints links to it — so a panel that quietly bound
 * the next port up is a process none of them can find. See panel-server.ts.
 */
let portExplicit = false;

/**
 * `PANEL_PORT`, if it holds a port number. Anything else is ignored with a
 * warning rather than trusted: `Number("")` is 0, which asks the OS for an
 * ephemeral port nobody could guess, and a negative or out-of-range value makes
 * `listen()` throw far away from the typo that caused it.
 */
function portFromEnv(): number | undefined {
  const raw = process.env.PANEL_PORT;
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    console.warn(`Ignoring PANEL_PORT=${JSON.stringify(raw)}: not a port number (1-65535).`);
    return undefined;
  }
  return parsed;
}

export async function loadConfig(): Promise<PanelConfig> {
  if (existsSync(localPath)) {
    try {
      const local = await import(localPath);
      config = { ...defaults, ...local.default };
    } catch (e) {
      console.warn("Failed to load panel.config.local.ts, using defaults:", e);
    }
  }
  // Env vars override config file for TLS paths
  if (process.env.PANEL_TLS_CERT) config.tlsCert = process.env.PANEL_TLS_CERT;
  if (process.env.PANEL_TLS_KEY) config.tlsKey = process.env.PANEL_TLS_KEY;
  // …and for the port. Until this line PANEL_PORT was honoured by everything
  // around the server — scripts/panel, the Windows launcher — and by the server
  // itself not at all, so the two could disagree without anything saying so.
  const envPort = portFromEnv();
  portExplicit = envPort !== undefined;
  if (envPort !== undefined) config.port = envPort;
  return config;
}

export function getConfig(): PanelConfig {
  return config;
}

/** See `portExplicit`. False until `loadConfig()` has run. */
export function isPortExplicit(): boolean {
  return portExplicit;
}
