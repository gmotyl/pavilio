import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

/** A lock older than this is considered abandoned and may be taken over. */
export const STALE_LOCK_MS = 15 * 60 * 1000;

export type LockFile = { session: string; ts: number };
export type TakeResult = { held: boolean; takenOver: boolean };
/** `released` is true only when this call removed a lock owned by the session. */
export type ReleaseResult = { released: boolean };

/** The ingest lock lives at `<projectDir>/wiki/.ingest.lock` (gitignored). */
export function lockPath(projectDir: string): string {
  return join(projectDir, "wiki", ".ingest.lock");
}

/** Test seams for the read-back windows; production callers never pass them. */
type LockHooks = { afterWrite?: () => void; beforeRemove?: () => void };

/** Lines `<projectDir>/wiki/.gitignore` must carry (workspaces older than the root entry lack them). */
const WIKI_GITIGNORE_LINES = [".ingest.lock", "raw/repos/"];

/** Append the missing wiki gitignore lines, creating the file when absent. */
function ensureWikiGitignore(projectDir: string): void {
  const path = join(projectDir, "wiki", ".gitignore");
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const present = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  const missing = WIKI_GITIGNORE_LINES.filter((line) => !present.has(line));
  if (missing.length === 0) return;
  const prefix = text.length > 0 && !text.endsWith("\n") ? "\n" : "";
  appendFileSync(path, prefix + missing.map((line) => `${line}\n`).join(""));
}

/** Read the lock; `null` when missing, `"corrupt"` when unparseable or malformed. */
function readLock(path: string): LockFile | null | "corrupt" {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    const data = JSON.parse(text) as Partial<LockFile>;
    if (typeof data?.session === "string" && typeof data.ts === "number") {
      return { session: data.session, ts: data.ts };
    }
  } catch {
    // fall through
  }
  return "corrupt";
}

/**
 * Take the ingest lock for `session`.
 * - no lock → create it atomically (`wx`), held
 * - own lock → refresh `ts`, held
 * - foreign lock younger than STALE_LOCK_MS → not held, left untouched
 * - foreign lock that is stale or corrupt → overwritten, held + takenOver
 *
 * A non-atomic overwrite (refresh or takeover) is read back: when a rival overwrote it in the
 * meantime the lock is reported as not held. Also ensures `wiki/.gitignore` ignores the lock.
 */
export function takeLock(
  projectDir: string,
  session: string,
  now: number = Date.now(),
  hooks: LockHooks = {},
): TakeResult {
  const path = lockPath(projectDir);
  mkdirSync(join(projectDir, "wiki"), { recursive: true });
  ensureWikiGitignore(projectDir);
  const content = JSON.stringify({ session, ts: now } satisfies LockFile) + "\n";

  try {
    writeFileSync(path, content, { flag: "wx" });
    return { held: true, takenOver: false };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  const existing = readLock(path);
  if (existing === null) {
    // Released between our create attempt and the read: retry the atomic create once.
    try {
      writeFileSync(path, content, { flag: "wx" });
      return { held: true, takenOver: false };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return { held: false, takenOver: false };
    }
  }
  const own = existing !== "corrupt" && existing.session === session;
  if (!own && existing !== "corrupt" && now - existing.ts < STALE_LOCK_MS) {
    return { held: false, takenOver: false };
  }
  writeFileSync(path, content);
  hooks.afterWrite?.();
  if (!isOwnedBy(path, session)) return { held: false, takenOver: false };
  return { held: true, takenOver: !own };
}

function isOwnedBy(path: string, session: string): boolean {
  const lock = readLock(path);
  return lock !== null && lock !== "corrupt" && lock.session === session;
}

/** Release the lock only when `session` owns it; a foreign or missing lock is left as is. */
export function releaseLock(projectDir: string, session: string, hooks: LockHooks = {}): ReleaseResult {
  const path = lockPath(projectDir);
  if (!isOwnedBy(path, session)) return { released: false };
  hooks.beforeRemove?.();
  // Re-check right before removal so a takeover in between keeps its lock (narrow window).
  if (!isOwnedBy(path, session)) return { released: false };
  rmSync(path, { force: true });
  return { released: true };
}
