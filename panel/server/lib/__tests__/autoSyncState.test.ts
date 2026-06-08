import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isEnabled, setEnabled } from "../autoSyncState";

describe("autoSyncState", () => {
  let dir: string, file: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ass-")); file = join(dir, ".autosync-state.json"); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("defaults to enabled when no state file exists", () => {
    expect(isEnabled(file)).toBe(true);
  });
  it("persists an explicit disable across reads", () => {
    setEnabled(false, file);
    expect(isEnabled(file)).toBe(false);
    setEnabled(true, file);
    expect(isEnabled(file)).toBe(true);
  });
});
