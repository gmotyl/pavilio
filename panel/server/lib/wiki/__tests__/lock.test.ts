import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readdirSync, renameSync, writeFileSync, readFileSync, existsSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { takeLock, releaseLock, lockPath, STALE_LOCK_MS } from "../lock";

let projectDir = "";
const NOW = Date.parse("2026-10-20T12:00:00Z");

function writeLock(content: string) {
  mkdirSync(join(projectDir, "wiki"), { recursive: true });
  writeFileSync(lockPath(projectDir), content);
}

/** Temp, guard and aside files next to the lock. */
const sideFiles = () => readdirSync(join(projectDir, "wiki")).filter((f) => f.startsWith(".ingest.lock."));

/** Backdate a file's mtime by a minute. */
function age(path: string) {
  const old = new Date(Date.now() - 60_000);
  utimesSync(path, old, old);
}

function readLock() {
  return JSON.parse(readFileSync(lockPath(projectDir), "utf8"));
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "wiki-lock-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("takeLock", () => {
  it("takes a free lock", () => {
    const result = takeLock(projectDir, "s1", NOW);
    expect(result).toEqual({ held: true, takenOver: false });
    expect(readLock()).toEqual({ session: "s1", ts: NOW });
  });

  it("refuses a fresh foreign lock", () => {
    writeLock(JSON.stringify({ session: "other", ts: NOW - 60_000 }));
    expect(takeLock(projectDir, "s1", NOW)).toEqual({ held: false, takenOver: false });
    expect(readLock()).toEqual({ session: "other", ts: NOW - 60_000 });

    // The owning session re-taking its own lock refreshes the timestamp.
    expect(takeLock(projectDir, "other", NOW)).toEqual({ held: true, takenOver: false });
    expect(readLock()).toEqual({ session: "other", ts: NOW });
  });

  it("takes over a stale lock", () => {
    writeLock(JSON.stringify({ session: "other", ts: NOW - STALE_LOCK_MS - 1 }));
    expect(takeLock(projectDir, "s1", NOW)).toEqual({ held: true, takenOver: true });
    expect(readLock()).toEqual({ session: "s1", ts: NOW });

    // A corrupt lock file counts as stale (once it is not a write in progress).
    writeLock("{not json");
    age(lockPath(projectDir));
    expect(takeLock(projectDir, "s2", NOW)).toEqual({ held: true, takenOver: true });
    expect(readLock()).toEqual({ session: "s2", ts: NOW });
  });

  it("is not held when another session wins the takeover race", () => {
    writeLock(JSON.stringify({ session: "other", ts: NOW - STALE_LOCK_MS - 1 }));
    // A rival takes over between our write and the read-back.
    const rival = () => writeLock(JSON.stringify({ session: "rival", ts: NOW }));
    expect(takeLock(projectDir, "s1", NOW, { afterWrite: rival })).toEqual({ held: false, takenOver: false });
    expect(readLock()).toEqual({ session: "rival", ts: NOW });
  });

  it("lets exactly one of two sessions racing a stale lock hold it", () => {
    writeLock(JSON.stringify({ session: "old", ts: NOW - STALE_LOCK_MS - 1 }));
    let rival: ReturnType<typeof takeLock> | undefined;
    // s2 runs its whole takeover after s1 judged the lock stale but before s1 acts on it.
    const race = () => {
      rival = takeLock(projectDir, "s2", NOW);
    };
    const mine = takeLock(projectDir, "s1", NOW, { beforeTakeover: race });

    expect(rival).toEqual({ held: true, takenOver: true });
    expect(mine).toEqual({ held: false, takenOver: false });
    expect(readLock()).toEqual({ session: "s2", ts: NOW });
    expect(sideFiles()).toEqual([]);
  });

  it("lets exactly one of two sessions racing a corrupt lock hold it", () => {
    writeLock("{not json");
    age(lockPath(projectDir));
    let rival: ReturnType<typeof takeLock> | undefined;
    const mine = takeLock(projectDir, "s1", NOW, {
      beforeTakeover: () => {
        rival = takeLock(projectDir, "s2", NOW);
      },
    });

    expect([mine.held, rival?.held].filter(Boolean)).toHaveLength(1);
    expect(readLock()).toEqual({ session: "s2", ts: NOW });
  });

  it("does not refresh an own lock taken over meanwhile", () => {
    writeLock(JSON.stringify({ session: "s1", ts: NOW - 1000 }));
    const rival = () => writeLock(JSON.stringify({ session: "rival", ts: NOW }));
    expect(takeLock(projectDir, "s1", NOW, { beforeTakeover: rival })).toEqual({ held: false, takenOver: false });
    expect(readLock()).toEqual({ session: "rival", ts: NOW });
  });

  it("three-party race on a stale lock leaves exactly one holder", () => {
    writeLock(JSON.stringify({ session: "old", ts: NOW - STALE_LOCK_MS - 1 }));
    let r1: ReturnType<typeof takeLock> | undefined;
    let r3: ReturnType<typeof takeLock> | undefined;
    // s2 judged the lock stale; before it acts, s1 completes a takeover, and while s2 holds the
    // takeover guard s3 tries to slip in.
    const r2 = takeLock(projectDir, "s2", NOW, {
      beforeTakeover: () => {
        r1 = takeLock(projectDir, "s1", NOW);
      },
      underGuard: () => {
        r3 = takeLock(projectDir, "s3", NOW, { guardWaitMs: 0 });
      },
    });

    expect(r1).toEqual({ held: true, takenOver: true });
    expect(r2).toEqual({ held: false, takenOver: false });
    expect(r3).toEqual({ held: false, takenOver: false });
    expect(readLock()).toEqual({ session: "s1", ts: NOW });
    expect(sideFiles()).toEqual([]);

    expect(releaseLock(projectDir, "s1")).toEqual({ released: true });
    expect(existsSync(lockPath(projectDir))).toBe(false);
    expect(sideFiles()).toEqual([]);
  });

  it("takes over a takeover guard left behind by a crashed session", () => {
    writeLock(JSON.stringify({ session: "old", ts: NOW - STALE_LOCK_MS - 1 }));
    const guard = `${lockPath(projectDir)}.takeover`;
    writeFileSync(guard, "");
    age(guard);

    expect(takeLock(projectDir, "s1", NOW, { guardWaitMs: 0 })).toEqual({ held: true, takenOver: true });
    expect(sideFiles()).toEqual([]);
  });

  it("does not take over while a fresh guard is held", () => {
    writeLock(JSON.stringify({ session: "old", ts: NOW - STALE_LOCK_MS - 1 }));
    writeFileSync(`${lockPath(projectDir)}.takeover`, "");

    expect(takeLock(projectDir, "s1", NOW, { guardWaitMs: 0 })).toEqual({ held: false, takenOver: false, busy: true });
    expect(readLock()).toEqual({ session: "old", ts: NOW - STALE_LOCK_MS - 1 });
  });

  it("falls back to an exclusive write where hard links are unsupported", () => {
    const link = () => {
      throw Object.assign(new Error("not permitted"), { code: "EPERM" });
    };
    expect(takeLock(projectDir, "s1", NOW, { link })).toEqual({ held: true, takenOver: false });
    expect(readLock()).toEqual({ session: "s1", ts: NOW });
    expect(sideFiles()).toEqual([]);
  });

  it("removes the refresh temp file when the rename fails", () => {
    writeLock(JSON.stringify({ session: "s1", ts: NOW - 1000 }));
    const rename = () => {
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    };
    expect(() => takeLock(projectDir, "s1", NOW, { rename })).toThrow(/busy/);
    expect(sideFiles()).toEqual([]);
  });

  it("a freshly written corrupt lock is a write in progress, not replaceable", () => {
    writeLock("{half");
    expect(takeLock(projectDir, "s1", NOW)).toEqual({ held: false, takenOver: false });
    expect(readFileSync(lockPath(projectDir), "utf8")).toBe("{half");
  });

  it("the guard is token-owned: a guard claimed by another session is not removed by us", () => {
    writeLock(JSON.stringify({ session: "old", ts: NOW - STALE_LOCK_MS - 1 }));
    const guard = `${lockPath(projectDir)}.takeover`;
    // While s1 holds the guard, someone else replaces it with their own.
    const result = takeLock(projectDir, "s1", NOW, {
      underGuard: () => writeFileSync(guard, "someone-else\n"),
    });
    expect(result).toEqual({ held: true, takenOver: true });
    expect(readFileSync(guard, "utf8")).toBe("someone-else\n");
  });

  it("claims a stale guard by renaming it aside", () => {
    writeLock(JSON.stringify({ session: "old", ts: NOW - STALE_LOCK_MS - 1 }));
    const guard = `${lockPath(projectDir)}.takeover`;
    writeFileSync(guard, "crashed\n");
    age(guard);
    const renamed: string[] = [];
    const result = takeLock(projectDir, "s1", NOW, {
      guardWaitMs: 0,
      renameGuard: (from, to) => {
        renamed.push(from);
        renameSync(from, to);
      },
    });
    expect(result).toEqual({ held: true, takenOver: true });
    expect(renamed).toEqual([guard]);
    expect(sideFiles()).toEqual([]);
  });

  it("own refresh and release wait out a crashed guard; a foreign take waits briefly", () => {
    const guard = `${lockPath(projectDir)}.takeover`;
    const budgets: number[] = [];
    const freeGuard = (budget: number) => {
      budgets.push(budget);
      rmSync(guard, { force: true });
    };

    writeLock(JSON.stringify({ session: "s1", ts: NOW - 1000 }));
    writeFileSync(guard, "busy\n");
    expect(takeLock(projectDir, "s1", NOW, { onGuardWait: freeGuard })).toEqual({ held: true, takenOver: false });

    writeFileSync(guard, "busy\n");
    expect(releaseLock(projectDir, "s1", { onGuardWait: freeGuard })).toEqual({ released: true });

    writeLock(JSON.stringify({ session: "old", ts: NOW - STALE_LOCK_MS - 1 }));
    writeFileSync(guard, "busy\n");
    expect(takeLock(projectDir, "s2", NOW, { onGuardWait: freeGuard })).toEqual({ held: true, takenOver: true });

    expect(budgets).toEqual([30_000, 30_000, 2_000]);
  });

  it("no-hardlink fallback holds only when the read-back is ours", () => {
    const link = () => {
      throw Object.assign(new Error("not permitted"), { code: "EPERM" });
    };
    const rival = () => writeLock(JSON.stringify({ session: "rival", ts: NOW }));
    expect(takeLock(projectDir, "s1", NOW, { link, afterFallbackWrite: rival })).toEqual({ held: false, takenOver: false });
    expect(readLock()).toEqual({ session: "rival", ts: NOW });
  });

  it("ensures the wiki gitignore lists the lock and repo clones", () => {
    takeLock(projectDir, "s1", NOW);
    const gitignore = join(projectDir, "wiki", ".gitignore");
    expect(readFileSync(gitignore, "utf8")).toBe(".ingest.lock*\nraw/repos/\n");

    // An existing file keeps its lines and gains only the missing ones, once.
    writeFileSync(gitignore, "*.tmp\nraw/repos/");
    takeLock(projectDir, "s1", NOW);
    takeLock(projectDir, "s1", NOW);
    expect(readFileSync(gitignore, "utf8")).toBe("*.tmp\nraw/repos/\n.ingest.lock*\n");
  });
});

describe("releaseLock", () => {
  it("release removes only its own lock", () => {
    writeLock(JSON.stringify({ session: "other", ts: NOW }));
    expect(releaseLock(projectDir, "s1")).toEqual({ released: false });
    expect(existsSync(lockPath(projectDir))).toBe(true);

    expect(releaseLock(projectDir, "other")).toEqual({ released: true });
    expect(existsSync(lockPath(projectDir))).toBe(false);

    // Releasing when no lock exists is a no-op.
    expect(releaseLock(projectDir, "other")).toEqual({ released: false });
  });

  it("release keeps a lock taken over just before removal", () => {
    writeLock(JSON.stringify({ session: "s1", ts: NOW }));
    const rival = () => writeLock(JSON.stringify({ session: "rival", ts: NOW }));
    expect(releaseLock(projectDir, "s1", { beforeRemove: rival })).toEqual({ released: false });
    expect(readLock()).toEqual({ session: "rival", ts: NOW });
  });
});
