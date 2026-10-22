import { randomBytes } from "crypto";
import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { hostname } from "os";
import { join } from "path";

/** A lock older than this is considered abandoned and may be taken over. */
export const STALE_LOCK_MS = 15 * 60 * 1000;

export type LockFile = { session: string; ts: number };
/** `busy`: the takeover guard stayed busy, so nothing was decided — retry shortly. */
export type TakeResult = { held: boolean; takenOver: boolean; busy?: true };
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
  onGuardWait?: (waitMs: number) => void;
  renameGuard?: (from: string, to: string) => void;
  pidAlive?: (pid: number) => boolean;
  procStart?: (pid: number) => string | null;
  linkGuard?: (existing: string, target: string) => void;
  afterFallbackWrite?: () => void;
  link?: (existing: string, target: string) => void;
  rename?: (from: string, to: string) => void;
};

/** Lines `<projectDir>/wiki/.gitignore` must carry (workspaces older than the root entry lack them). */
export const WIKI_GITIGNORE_LINES = [".ingest.lock*", "raw/repos/"]; // `*`: takeover temp and aside files too

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

/** A takeover guard older than this belongs to a crashed session and may be claimed. */
const STALE_GUARD_MS = 30 * 1000;
/** Without a usable process start time, a guard older than this is claimable even if its pid lives. */
const HARD_GUARD_MS = 10 * 60 * 1000;
/** How long a free or foreign take waits for a busy guard before answering `busy`. */
const TAKE_GUARD_WAIT_MS = 2000;
/** A corrupt lock modified more recently than this may be a write in progress: left alone. */
const CORRUPT_GRACE_MS = 1000;
/** `linkSync` failures meaning "no hard links here", not "the lock exists". */
const NO_LINK_CODES = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"]);

const unique = (session: string) => `${session.replace(/[^\w.-]+/g, "_")}-${randomBytes(4).toString("hex")}`;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const ageMs = (path: string) => {
  const mtime = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
  return mtime === undefined ? undefined : Date.now() - mtime;
};

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Run `fn` holding `<lock>.takeover`, so every replace or removal of the lock is serialized.
 * The guard is created with `wx` and holds a random token; `finally` removes it only while it
 * still holds that token. The guard records `pid` and `host`; an old guard whose owner is gone
 * (see `claimable`) is claimed by renaming it to a unique name (only one claimant's rename wins)
 * before creating ours; a moved guard that turns out claimable no more is put back, never
 * deleted. Waits up to `waitMs` for a busy guard; `{ ok: false }` when it stays busy.
 */
function withGuard<T>(
  path: string,
  session: string,
  waitMs: number,
  hooks: LockHooks,
  fn: () => T,
): { ok: true; value: T } | { ok: false } {
  const guard = `${path}.takeover`;
  const renameGuard = hooks.renameGuard ?? renameSync;
  const linkGuard = hooks.linkGuard ?? linkSync;
  const pidAlive = hooks.pidAlive ?? isPidAlive;
  const procStart = hooks.procStart ?? readProcStart;
  const start = procStart(process.pid) ?? undefined;
  const token = JSON.stringify({ token: unique(session), pid: process.pid, start, host: hostname() }) + "\n";
  /**
   * A guard may be claimed only when it is older than STALE_GUARD_MS and its owner is gone.
   * Another host's (or an unreadable) guard counts as gone once old. On this host the recorded
   * pid must be dead, or alive but a different process (its `/proc` start time differs: PID
   * reuse). Without a recorded or readable start time a live pid's guard is claimable only past
   * HARD_GUARD_MS. A live same-host owner's guard is never claimed.
   */
  const claimable = (file: string): boolean => {
    const age = ageMs(file);
    if (age === undefined || age < STALE_GUARD_MS) return false;
    const owner = guardOwner(readText(file));
    if (!owner || owner.host !== hostname() || !pidAlive(owner.pid)) return true;
    const current = owner.start === undefined ? null : procStart(owner.pid);
    if (current !== null) return current !== owner.start;
    return age >= HARD_GUARD_MS;
  };
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      writeFileSync(guard, token, { flag: "wx" });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    if (claimable(guard)) {
      const aside = `${guard}.stale-${unique(session)}`;
      try {
        renameGuard(guard, aside);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // another claimant won
        continue;
      }
      if (claimable(aside)) {
        rmSync(aside, { force: true }); // really a crashed owner's guard
        continue;
      }
      // Between the check and the rename a claimant created a new guard and we moved it: put it
      // back without clobbering. If another guard already took its place, never delete the
      // displaced one — leave it under a `displaced-` name (gitignored) and answer busy.
      //
      // Residual window: two claimants of one crashed guard, both inside the sub-millisecond gap
      // between a check and a rename, can still displace each other's fresh guard. Node offers
      // no OS-level flock, so this needs a crashed holder plus simultaneous claimants to bite.
      if (!restoreGuard(aside, guard, linkGuard)) {
        renameSync(aside, `${guard}.displaced-${randomBytes(4).toString("hex")}`);
        return { ok: false };
      }
    }
    if (Date.now() >= deadline) return { ok: false };
    hooks.onGuardWait?.(waitMs);
    sleep(10);
  }
  try {
    return { ok: true, value: fn() };
  } finally {
    if (readText(guard) === token) rmSync(guard, { force: true });
  }
}

/**
 * Put a displaced guard back at the canonical path without clobbering: a hard link, or where
 * hard links are unsupported an exclusive write of the same content (same token, so its owner's
 * `finally` still removes it). The displaced copy goes only once the canonical one is in place.
 * False when the canonical path is already taken (or the restore failed otherwise).
 */
function restoreGuard(aside: string, guard: string, link: (from: string, to: string) => void): boolean {
  try {
    link(aside, guard);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "";
    if (!NO_LINK_CODES.has(code)) return false;
    const content = readText(aside);
    if (content === null) return false;
    try {
      writeFileSync(guard, content, { flag: "wx" });
    } catch {
      return false;
    }
  }
  rmSync(aside, { force: true });
  return true;
}

type GuardOwner = { pid: number; host: string; start?: string };

/** `{pid, host, start?}` recorded in a guard, or null for an unreadable or legacy one. */
function guardOwner(text: string | null): GuardOwner | null {
  try {
    const data = JSON.parse(text ?? "") as { pid?: unknown; host?: unknown; start?: unknown };
    if (typeof data.pid !== "number" || typeof data.host !== "string") return null;
    return { pid: data.pid, host: data.host, ...(typeof data.start === "string" ? { start: data.start } : {}) };
  } catch {
    return null;
  }
}

/**
 * Process start time (field 22 of `/proc/<pid>/stat`, clock ticks since boot): with the pid it
 * identifies a process across PID reuse. Null where `/proc` is unavailable or the pid is gone.
 */
function readProcStart(pid: number): string | null {
  const stat = readText(`/proc/${pid}/stat`);
  if (stat === null) return null;
  // Field 2 (comm) is parenthesised and may contain spaces; fields 3… follow the last `)`.
  const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return rest[19] ?? null;
}

/** `process.kill(pid, 0)`: ESRCH means dead; success or EPERM means a live process. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Take the ingest lock for `session`.
 * - no lock → create it atomically (temp file + no-clobber hard link, else `wx`), held
 * - own lock → refresh `ts`, held
 * - foreign lock younger than STALE_LOCK_MS → not held, left untouched
 * - foreign lock that is stale or corrupt → taken over, held + takenOver (a corrupt lock modified
 *   under a second ago is a write in progress: not held)
 * - takeover guard still busy after a short wait → not held + `busy` (retry shortly); an own
 *   refresh waits out a crashed guard instead
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
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return false;
    }
    // A plain write is not atomic: hold only when the read-back is still ours.
    hooks.afterFallbackWrite?.();
    return isOwnedBy(path, session);
  };
  /**
   * May this session replace `lock`? Own and stale locks yes, a fresh foreign one no. A corrupt
   * one yes, unless modified under CORRUPT_GRACE_MS ago: that may be a rival's write in progress.
   */
  const replaceable = (lock: LockFile | "corrupt") =>
    lock === "corrupt"
      ? (ageMs(path) ?? Infinity) >= CORRUPT_GRACE_MS
      : lock.session === session || now - lock.ts >= STALE_LOCK_MS;

  if (create()) return { held: true, takenOver: false };

  const existing = readLock(path);
  // Released between our create attempt and the read: retry the atomic create once.
  if (existing === null) return create() ? { held: true, takenOver: false } : notHeld;
  if (!replaceable(existing)) return notHeld;
  hooks.beforeTakeover?.();

  // An own refresh waits out even a crashed guard; a takeover answers `busy` after a short wait.
  const ownBefore = existing !== "corrupt" && existing.session === session;
  const waitMs = hooks.guardWaitMs ?? (ownBefore ? STALE_GUARD_MS : TAKE_GUARD_WAIT_MS);
  const guarded = withGuard(path, session, waitMs, hooks, (): TakeResult => {
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
  if (!guarded.ok) return { held: false, takenOver: false, busy: true };
  const result = guarded.value;
  if (!result.held) return notHeld;
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
  // Waits out even a crashed guard, so a finished ingest does not leave its lock behind.
  const guarded = withGuard(path, session, hooks.guardWaitMs ?? STALE_GUARD_MS, hooks, () => {
    if (!isOwnedBy(path, session)) return false;
    rmSync(path, { force: true });
    return true;
  });
  return { released: guarded.ok && guarded.value };
}
