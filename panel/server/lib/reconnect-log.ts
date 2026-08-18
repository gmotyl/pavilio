import { appendFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
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
  /** ms since the last ws message (incl. keep-alive pings). */
  pingMs?: number;
  /** ms since the last NON-ping frame (output/exit) — "TUI actually alive". */
  frameMs?: number;
  cols?: number;
  rows?: number;
  /** True when pingMs crossed the auto-reconnect staleness threshold. */
  stale?: boolean;
  /** How the reconnect was triggered — "manual" for the button. */
  trigger?: string;
}

/**
 * Append one metric line, stamping the server clock. Best-effort.
 *
 * Perms: `mkdirSync`/`appendFileSync` `mode` options are honored only when
 * they create the dir/file (and only as `mode & ~umask`), so we `chmodSync`
 * the file after every append to reliably hold it at 0o600 even on the
 * append-to-existing path — matching how mobile-auth persists its state.
 */
export function appendReconnectMetric(metric: ReconnectMetric): void {
  const dir = logDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = logFile();
  const line =
    JSON.stringify({ ts: new Date().toISOString(), ...metric }) + "\n";
  appendFileSync(file, line, { mode: 0o600 });
  chmodSync(file, 0o600);
}
