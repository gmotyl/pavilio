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

describe("autoSyncScheduler notify", () => {
  it("fires notifyCmd once on transition into conflict, re-arms after recovery", async () => {
    const dir = mkdtempSync(join(tmpdir(), "notify-"));
    const out = join(dir, "fired.log");
    const states: Array<{ state: string; detail: string }> = [
      { state: "conflict", detail: "Rebase conflict" },
      { state: "conflict", detail: "Rebase conflict" }, // same state again → no second fire
      { state: "synced", detail: "" },                  // recovery → re-arm
      { state: "conflict", detail: "Rebase conflict" }, // fires again
    ];
    for (const s of states) {
      await _notifyForTest(s as never, {
        notifyCmd: `echo "$SYNC_STATE" >> ${out}`,
        intervalMinutes: 30,
      });
      await new Promise((r) => setTimeout(r, 150)); // let /bin/sh finish
    }
    const lines = existsSync(out) ? readFileSync(out, "utf-8").trim().split("\n") : [];
    expect(lines).toEqual(["conflict", "conflict"]);
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
    await new Promise((r) => setTimeout(r, 150));
    expect(readFileSync(out, "utf-8").trim()).toBe("stale");
    rmSync(dir, { recursive: true, force: true });
  }, 15_000);
});
