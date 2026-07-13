import { describe, it, expect, vi, afterEach } from "vitest";

const syncRepoMock = vi.fn();
const isStaleMock = vi.fn().mockReturnValue(false);
vi.mock("../syncRepo.js", () => ({
  syncRepo: (...a: unknown[]) => syncRepoMock(...a),
  isStale: (...a: unknown[]) => isStaleMock(...a),
}));

import { startScheduler, stopScheduler, _notifyForTest } from "../autoSyncScheduler.js";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

afterEach(() => stopScheduler());

// notifyCmd spawns /bin/sh async; poll for output instead of fixed sleeps (slow under load)
const linesOf = (file: string): string[] =>
  existsSync(file) ? readFileSync(file, "utf-8").trim().split("\n").filter(Boolean) : [];
async function waitForLines(file: string, n: number, ms = 5_000): Promise<string[]> {
  const deadline = Date.now() + ms;
  while (linesOf(file).length < n && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return linesOf(file);
}

describe("autoSyncScheduler notify", () => {
  it("fires notifyCmd once on transition into conflict, re-arms after recovery", async () => {
    const dir = mkdtempSync(join(tmpdir(), "notify-"));
    const out = join(dir, "fired.log");
    const states: Array<{ state: string; detail: string; expectedFires: number }> = [
      { state: "conflict", detail: "Rebase conflict", expectedFires: 1 },
      { state: "conflict", detail: "Rebase conflict", expectedFires: 1 }, // same state again → no second fire
      { state: "synced", detail: "", expectedFires: 1 },                  // recovery → re-arm
      { state: "conflict", detail: "Rebase conflict", expectedFires: 2 }, // fires again
    ];
    for (const s of states) {
      await _notifyForTest(s as never, {
        notifyCmd: `echo "$SYNC_STATE" >> ${out}`,
        intervalMinutes: 30,
      });
      await waitForLines(out, s.expectedFires);
    }
    expect(linesOf(out)).toEqual(["conflict", "conflict"]);
    rmSync(dir, { recursive: true, force: true });
  }, 15_000);

  it("treats stale as an attention state even when state is offline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "notify-"));
    const out = join(dir, "fired.log");
    isStaleMock.mockReturnValueOnce(true);
    await _notifyForTest({ state: "offline", detail: "" } as never, {
      notifyCmd: `echo "$SYNC_STATE" >> ${out}`,
      intervalMinutes: 30,
    });
    await waitForLines(out, 1);
    expect(linesOf(out)).toEqual(["stale"]);
    rmSync(dir, { recursive: true, force: true });
  }, 15_000);

  it("fires push-failed (not stale) when a concrete attention state follows conflict while stale is also true", async () => {
    const dir = mkdtempSync(join(tmpdir(), "notify-"));
    const out = join(dir, "fired.log");
    isStaleMock.mockReturnValue(true);
    const states: Array<{ state: string; detail: string }> = [
      { state: "conflict", detail: "Rebase conflict" },
      { state: "push-failed", detail: "x" },
    ];
    let expected = 0;
    for (const s of states) {
      await _notifyForTest(s as never, {
        notifyCmd: `echo "$SYNC_STATE" >> ${out}`,
        intervalMinutes: 30,
      });
      expected += 1;
      await waitForLines(out, expected);
    }
    isStaleMock.mockReturnValue(false);
    expect(linesOf(out)).toEqual(["conflict", "push-failed"]);
    rmSync(dir, { recursive: true, force: true });
  }, 15_000);
});
