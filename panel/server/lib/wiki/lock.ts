import { randomBytes } from "crypto";
import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
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
type LockHooks = {
  beforeTakeover?: () => void;
  underGuard?: () => void;
  afterWrite?: () => void;
  beforeRemove?: () => void;
  guardWaitMs?: number;
  link?: (existing: string, target: string) => void;
  rename?: (from: string, to: string) => void;
};

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

/** A takeover guard older than this belongs to a crashed session and may be removed. */
const STALE_GUARD_MS = 30 * 1000;
/** How long a replace or release waits for a busy guard before giving up. */
const GUARD_WAIT_MS = 2000;
/** `linkSync` failures meaning "no hard links here", not "the lock exists". */
const NO_LINK_CODES = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"]);

const unique = (session: string) => `${session.replace(/[^\w.-]+/g, "_")}-${randomBytes(4).toString("hex")}`;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` holding `<lock>.takeover`, created with `wx`, so every replace or removal of the lock
 * is serialized. Waits up to `waitMs` for a busy guard; a guard older than STALE_GUARD_MS is left
 * by a crashed session and removed. Returns null when the guard could not be had.
 */
function withGuard<T>(path: string, session: string, waitMs: number, fn: () => T): T | null {
  const guard = `${path}.takeover`;
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      writeFileSync(guard, `${session}\n`, { flag: "wx" });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const mtime = statSync(guard, { throwIfNoEntry: false })?.mtimeMs;
    if (mtime !== undefined && Date.now() - mtime >= STALE_GUARD_MS) {
      rmSync(guard, { force: true });
      continue;
    }
    if (Date.now() >= deadline) return null;
    sleep(10);
  }
  try {
    return fn();
  } finally {
    rmSync(guard, { force: true });
  }
}

/**
 * Take the ingest lock for `session`.
 * - no lock → create it atomically (temp file + no-clobber hard link, else `wx`), held
 * - own lock → refresh `ts`, held
 * - foreign lock younger than STALE_LOCK_MS → not held, left untouched
 * - foreign lock that is stale or corrupt → taken over, held + takenOver
 *
 * Every replace (refresh or takeover) runs under the takeover guard: it re-reads the lock and
 * re-checks ownership or staleness there, then writes a temp file and renames it over the lock, so
 * the lock path never disappears and no free-lock create can slip into a gap. Release takes the
 * same guard, so a lock is never removed between a replace's re-check and its rename. The result
 * is read back once more. Also ensures `wiki/.gitignore` ignores the lock.
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
  const link = hooks.link ?? linkSync;
  const rename = hooks.rename ?? renameSync;
  const notHeld: TakeResult = { held: false, takenOver: false };

  /**
   * Atomic no-clobber create with the content already in place: a private temp file hard-linked
   * as the lock (EEXIST like `wx`), so no rival reads a half-written lock as corrupt. Where hard
   * links are unsupported, an exclusive `wx` write.
   */
  const create = (): boolean => {
    const temp = `${path}.tmp-${unique(session)}`;
    writeFileSync(temp, content, { flag: "wx" });
    try {
      link(temp, path);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (code === "EEXIST") return false;
      if (!NO_LINK_CODES.has(code)) throw err;
    } finally {
      rmSync(temp, { force: true });
    }
    try {
      writeFileSync(path, content, { flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return false;
    }
  };
  /** May this session replace `lock`? Own, corrupt and stale locks yes; a fresh foreign one no. */
  const replaceable = (lock: LockFile | "corrupt") =>
    lock === "corrupt" || lock.session === session || now - lock.ts >= STALE_LOCK_MS;

  if (create()) return { held: true, takenOver: false };

  const existing = readLock(path);
  // Released between our create attempt and the read: retry the atomic create once.
  if (existing === null) return create() ? { held: true, takenOver: false } : notHeld;
  if (!replaceable(existing)) return notHeld;
  hooks.beforeTakeover?.();

  const result = withGuard(path, session, hooks.guardWaitMs ?? GUARD_WAIT_MS, (): TakeResult => {
    hooks.underGuard?.();
    const current = readLock(path);
    if (current === null) return create() ? { held: true, takenOver: false } : notHeld;
    if (!replaceable(current)) return notHeld;
    const own = current !== "corrupt" && current.session === session;
    const temp = `${path}.tmp-${unique(session)}`;
    try {
      writeFileSync(temp, content, { flag: "wx" });
      rename(temp, path);
    } finally {
      rmSync(temp, { force: true });
    }
    return { held: true, takenOver: !own };
  });
  if (result === null || !result.held) return notHeld;
  hooks.afterWrite?.();
  return isOwnedBy(path, session) ? result : notHeld;
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
  // Under the takeover guard, so no replace sits between its re-check and its rename meanwhile;
  // the re-check keeps a lock taken over just before.
  const released = withGuard(path, session, hooks.guardWaitMs ?? GUARD_WAIT_MS, () => {
    if (!isOwnedBy(path, session)) return false;
    rmSync(path, { force: true });
    return true;
  });
  return { released: released === true };
}
