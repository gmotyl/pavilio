import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
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
 */
export function takeLock(projectDir: string, session: string, now: number = Date.now()): TakeResult {
  const path = lockPath(projectDir);
  mkdirSync(join(projectDir, "wiki"), { recursive: true });
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
  if (existing !== "corrupt" && existing.session === session) {
    writeFileSync(path, content);
    return { held: true, takenOver: false };
  }
  if (existing !== "corrupt" && now - existing.ts < STALE_LOCK_MS) {
    return { held: false, takenOver: false };
  }
  writeFileSync(path, content);
  return { held: true, takenOver: true };
}

/** Release the lock only when `session` owns it; a foreign or missing lock is left as is. */
export function releaseLock(projectDir: string, session: string): ReleaseResult {
  const path = lockPath(projectDir);
  const existing = readLock(path);
  if (existing === null || existing === "corrupt" || existing.session !== session) {
    return { released: false };
  }
  rmSync(path, { force: true });
  return { released: true };
}
