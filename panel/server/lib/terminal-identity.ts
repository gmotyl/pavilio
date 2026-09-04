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
 *
 * `homeDir` lets a caller resolve the identity file under a *different*
 * account's home — the session's actual running user, when one was chosen
 * via `runAsUser` — rather than the server process's own home. It is only
 * ever consulted when `PANEL_AUTH_STATE_DIR` is unset; that env var, when
 * present, always wins (it's the explicit override used by tests and by
 * anyone who wants every identity file to land in one shared place).
 */
export function namesDir(homeDir?: string): string {
  return join(
    process.env.PANEL_AUTH_STATE_DIR ?? join(homeDir ?? homedir(), ".panel"),
    "terminals",
  );
}

export function writeName(id: string, name: string, homeDir?: string): void {
  // Ids are server-generated UUIDs, but validate anyway so a malformed id
  // can never escape namesDir() via a path-traversal-shaped string.
  if (!isValidId(id)) return;
  try {
    const dir = namesDir(homeDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, id), `${name}\n`);
  } catch {
    // best-effort — see file header.
  }
}

export function removeName(id: string, homeDir?: string): void {
  if (!isValidId(id)) return;
  try {
    rmSync(join(namesDir(homeDir), id), { force: true });
  } catch {
    // best-effort — see file header.
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `<project>-<max existing suffix + 1>`, counting only names that match
 * `^<project>-(\d+)$` exactly. A renamed session (`deploy-watch`) or a
 * lookalike (`alokai-1-old`, `alokai-x`) doesn't count and keeps its name —
 * only the counter's own numbering scheme participates. Taking the max
 * suffix rather than the count means a closed session's number is never
 * reused within a server lifetime — the allocator never hands out the same
 * name twice. That guarantee is about allocation only: a user-supplied
 * rename (via `updateSession`) isn't constrained by it and can collide with
 * a name already in use by another live session.
 */
export function nextSessionName(project: string, existingNames: string[]): string {
  const pattern = new RegExp(`^${escapeRegExp(project)}-(\\d+)$`);
  let max = 0;
  for (const name of existingNames) {
    const match = pattern.exec(name);
    if (!match) continue;
    const n = Number(match[1]);
    if (n > max) max = n;
  }
  return `${project}-${max + 1}`;
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
