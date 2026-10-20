import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
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
});
