import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Mirrors a live terminal session's mutable *name* to a file on disk, keyed
 * by the session's immutable id. The id travels into the PTY once, at spawn,
 * via the environment (`PAVILIO_TERMINAL_ID`) — but the name can change after
 * that (rename), and env vars can't be rewritten from outside a process. This
 * file is how something running inside the PTY (an agent, a hook) reads back
 * what the session is currently *called*.
 *
 * Best-effort throughout: a full disk or a read-only home must not stop a
 * user opening or renaming a terminal, so every write/remove here swallows
 * its own I/O errors — the identity file is a convenience channel, never a
 * correctness dependency.
 */

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isValidId(id: string): boolean {
  return UUID_RE.test(id);
}

/**
 * Same convention as `logDir()` in `reconnect-log.ts`: read the env var at
 * call time (never cache it at module load) so tests can redirect it.
 */
export function namesDir(): string {
  return join(
    process.env.PANEL_AUTH_STATE_DIR ?? join(homedir(), ".panel"),
    "terminals",
  );
}

export function writeName(id: string, name: string): void {
  // Ids are server-generated UUIDs, but validate anyway so a malformed id
  // can never escape namesDir() via a path-traversal-shaped string.
  if (!isValidId(id)) return;
  try {
    const dir = namesDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, id), `${name}\n`);
  } catch {
    // best-effort — see file header.
  }
}

export function removeName(id: string): void {
  if (!isValidId(id)) return;
  try {
    rmSync(join(namesDir(), id), { force: true });
  } catch {
    // best-effort — see file header.
  }
}

/**
 * Delete every identity file whose id is not in `liveIds` — the cleanup for
 * sessions that vanished without going through `removeName` (a crashed
 * server). A filename that is not a UUID is left alone rather than deleted:
 * it was never a session file to begin with, so the live set says nothing
 * about it.
 */
export function sweepNames(liveIds: string[]): void {
  try {
    const dir = namesDir();
    if (!existsSync(dir)) return;
    const live = new Set(liveIds);
    for (const entry of readdirSync(dir)) {
      if (!isValidId(entry)) continue;
      if (live.has(entry)) continue;
      rmSync(join(dir, entry), { force: true });
    }
  } catch {
    // best-effort — see file header.
  }
}
