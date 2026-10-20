import { randomBytes } from "crypto";
import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
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
type LockHooks = { beforeTakeover?: () => void; afterWrite?: () => void; beforeRemove?: () => void };

/** Lines `<projectDir>/wiki/.gitignore` must carry (workspaces older than the root entry lack them). */
const WIKI_GITIGNORE_LINES = [".ingest.lock*", "raw/repos/"]; // `*`: takeover temp and aside files too

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
 * - no lock → create it atomically (temp file + no-clobber link), held
 * - own lock → refresh `ts` (temp file + rename, only while still ours), held
 * - foreign lock younger than STALE_LOCK_MS → not held, left untouched
 * - foreign lock that is stale or corrupt → taken over, held + takenOver
 *
 * A takeover first renames the stale lock aside under a unique name: only one rival's rename
 * can succeed, and the loser sees ENOENT and falls back to the atomic create. The winner then
 * creates the new lock with the same atomic create. If what was renamed aside turns out to be a fresh lock (a rival
 * finished its takeover in between), it is put back and the lock is reported as not held.
 * The result is read back once more. Also ensures `wiki/.gitignore` ignores the lock.
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
  const unique = () => `${session.replace(/[^\w.-]+/g, "_")}-${randomBytes(4).toString("hex")}`;
  /**
   * Atomic no-clobber create with the content already in place: write a private temp file and
   * hard-link it as the lock (fails with EEXIST like `wx`), so no rival ever reads a half-written
   * lock and mistakes it for a corrupt one.
   */
  const create = (): boolean => {
    const temp = `${path}.tmp-${unique()}`;
    writeFileSync(temp, content, { flag: "wx" });
    try {
      linkSync(temp, path);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return false;
    } finally {
      rmSync(temp, { force: true });
    }
  };
  const readBack = (takenOver: boolean): TakeResult => {
    hooks.afterWrite?.();
    return isOwnedBy(path, session) ? { held: true, takenOver } : { held: false, takenOver: false };
  };
  /** May this session replace `lock`? Own, corrupt and stale locks yes; a fresh foreign one no. */
  const replaceable = (lock: LockFile | "corrupt") =>
    lock === "corrupt" || lock.session === session || now - lock.ts >= STALE_LOCK_MS;

  if (create()) return { held: true, takenOver: false };

  const existing = readLock(path);
  // Released between our create attempt and the read: retry the atomic create once.
  if (existing === null) return create() ? { held: true, takenOver: false } : { held: false, takenOver: false };
  if (!replaceable(existing)) return { held: false, takenOver: false };
  hooks.beforeTakeover?.();

  if (existing !== "corrupt" && existing.session === session) {
    const temp = `${path}.tmp-${unique()}`;
    writeFileSync(temp, content);
    if (!isOwnedBy(path, session)) {
      rmSync(temp, { force: true });
      return { held: false, takenOver: false };
    }
    renameSync(temp, path);
    return readBack(false);
  }

  const aside = `${path}.stale-${unique()}`;
  try {
    renameSync(path, aside);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // A rival renamed it first: the lock is free or theirs now.
    return create() ? { held: true, takenOver: false } : { held: false, takenOver: false };
  }
  const moved = readLock(aside);
  if (moved !== null && !replaceable(moved)) {
    // We moved a rival's fresh lock, not the stale one: put it back without clobbering.
    try {
      linkSync(aside, path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    rmSync(aside, { force: true });
    return { held: false, takenOver: false };
  }
  rmSync(aside, { force: true });
  if (!create()) return { held: false, takenOver: false };
  return readBack(true);
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
