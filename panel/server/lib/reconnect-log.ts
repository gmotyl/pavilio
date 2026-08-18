import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Append-only log of manual terminal-reconnect clicks, one JSON object per
 * line. Lives outside the repo (same `~/.panel` dir as mobile-auth state) so
 * it is never committed and survives upstream/consumer syncs. The point is to
 * collect state-at-click metrics we can mine later to tune the auto-reconnect
 * gate — e.g. "how often was the socket actually stale when the user clicked?"
 */

function logDir(): string {
  return process.env.PANEL_AUTH_STATE_DIR ?? join(homedir(), ".panel");
}

function logFile(): string {
  return join(logDir(), "terminal-reconnect.jsonl");
}

export interface ReconnectMetric {
  sessionId?: string;
  /** viewportLooksBlank() at the moment the button was clicked. */
  blankAtClick?: boolean;
  /** WebSocket.readyState (0..3) of the terminal socket at click. */
  wsReadyState?: number;
  /** ms since the last message arrived on the terminal socket. */
  msSinceLastWsMsg?: number;
  cols?: number;
  rows?: number;
  /** True when msSinceLastWsMsg crossed the auto-reconnect staleness threshold. */
  stale?: boolean;
  /** How the reconnect was triggered — "manual" for the button. */
  trigger?: string;
}

/** Append one metric line, stamping the server clock. Best-effort. */
export function appendReconnectMetric(metric: ReconnectMetric): void {
  const dir = logDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const line =
    JSON.stringify({ ts: new Date().toISOString(), ...metric }) + "\n";
  appendFileSync(logFile(), line, { mode: 0o600 });
}
