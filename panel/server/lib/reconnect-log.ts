import { appendFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Append-only log of terminal-reconnect events, one JSON object per line.
 * Lives outside the repo (same `~/.panel` dir as mobile-auth state) so it is
 * never committed and survives upstream/consumer syncs. The point is to
 * collect state-at-event metrics we can mine later to tune the auto-reconnect
 * gate — e.g. "how often was the socket actually stale when the user clicked?"
 * and, since the log widened past clicks, "was there content on screen when
 * the socket died, and did it ever come back on its own?"
 */

/**
 * What produced the record. A closed enum, not free text: the whole value of
 * this file is being able to group by it.
 *
 * - `manual` — the user clicked Reconnect (or the disconnected badge).
 * - `disconnect` — an attached session's socket died on its own.
 * - `auto-blank` — a blank-gated path reopened the session without being asked.
 */
export type ReconnectTrigger = "manual" | "disconnect" | "auto-blank";

const TRIGGERS: readonly string[] = ["manual", "disconnect", "auto-blank"];

/**
 * Coerce a *present* client-supplied trigger to the enum. Anything
 * unrecognised — a typo, an older client, a hand-rolled POST — is recorded as
 * `"manual"` rather than stored verbatim, so a future query never has to guess
 * what a stray value meant. An absent trigger never reaches here: the caller
 * omits the field instead (see {@link appendReconnectMetric}).
 */
export function normalizeTrigger(value: unknown): ReconnectTrigger {
  return typeof value === "string" && TRIGGERS.includes(value)
    ? (value as ReconnectTrigger)
    : "manual";
}

function logDir(): string {
  return process.env.PANEL_AUTH_STATE_DIR ?? join(homedir(), ".panel");
}

function logFile(): string {
  return join(logDir(), "terminal-reconnect.jsonl");
}

export interface ReconnectMetric {
  sessionId?: string;
  /**
   * viewportLooksBlank() at the moment the event fired. Named for the click it
   * was introduced for and deliberately NOT renamed now that non-manual
   * triggers write it too — old and new lines have to stay comparable.
   */
  blankAtClick?: boolean;
  /**
   * WebSocket.readyState (0..3) of the terminal socket at that moment, or -1
   * when there was no socket — the client sends a sentinel rather than
   * omitting the field, so every line carries the same key set.
   */
  wsReadyState?: number;
  /** ms since the last ws message (incl. keep-alive pings). */
  pingMs?: number;
  /** ms since the last NON-ping frame (output/exit) — "TUI actually alive". */
  frameMs?: number;
  cols?: number;
  rows?: number;
  /** True when pingMs crossed the auto-reconnect staleness threshold. */
  stale?: boolean;
  /** What produced this record — see {@link ReconnectTrigger}. */
  trigger?: ReconnectTrigger;
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
  // An absent trigger stays absent — the pre-#58 lines have no such field, and
  // inventing "manual" for an unattributed record would misreport it as a
  // click. A *present* one is coerced to the enum. This is the only place that
  // decides either way: the endpoint hands `trigger` through untouched.
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      ...metric,
      ...(metric.trigger === undefined
        ? {}
        : { trigger: normalizeTrigger(metric.trigger) }),
    }) + "\n";
  appendFileSync(file, line, { mode: 0o600 });
  chmodSync(file, 0o600);
}
