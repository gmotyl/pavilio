import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadConfig } from "../config";
import { machineId } from "../lib/hostname";

// scripts/machine-id drives a real tsx process, so it lives in node-slow.
const REPO_ROOT = resolve(__dirname, "../../..");
const SCRIPT = resolve(REPO_ROOT, "scripts/machine-id");

describe("scripts/machine-id", () => {
  it("scripts/machine-id prints the same id as machineId()", async () => {
    // The script loads panel.config.local.ts itself, so compare against the
    // same loaded config rather than bare defaults.
    await loadConfig();
    const expected = `${machineId()}\n`;
    // From the repo root and from an unrelated cwd alike.
    for (const cwd of [REPO_ROOT, tmpdir()]) {
      const res = spawnSync("bash", [SCRIPT], { cwd, encoding: "utf8" });
      expect(res.status, res.stderr).toBe(0);
      expect(res.stdout).toBe(expected);
    }
  });
});
