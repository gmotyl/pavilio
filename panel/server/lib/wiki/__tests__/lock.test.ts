import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { takeLock, releaseLock, lockPath, STALE_LOCK_MS } from "../lock";

let projectDir = "";
const NOW = Date.parse("2026-10-20T12:00:00Z");

function writeLock(content: string) {
  mkdirSync(join(projectDir, "wiki"), { recursive: true });
  writeFileSync(lockPath(projectDir), content);
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

    // A corrupt lock file counts as stale.
    writeLock("{not json");
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
    // No stale-rename leftovers next to the lock.
    expect(readdirSync(join(projectDir, "wiki")).filter((f) => f.startsWith(".ingest.lock."))).toEqual([]);
  });

  it("lets exactly one of two sessions racing a corrupt lock hold it", () => {
    writeLock("{not json");
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
