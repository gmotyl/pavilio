import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../config";
import { machineId } from "../lib/hostname";

// scripts/machine-id drives a real tsx process, so it lives in node-slow.
const REPO_ROOT = resolve(__dirname, "../../..");
const SCRIPT = resolve(REPO_ROOT, "scripts/machine-id");

const tmpRoots: string[] = [];
afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

/** A minimal copy of the repo (scripts + panel server/config) with its own
 *  panel.config.local.ts, so the override path is exercised without ever
 *  writing into the source tree. */
function repoCopyWithLocalConfig(localConfig: string): string {
  const root = mkdtempSync(join(tmpdir(), "machine-id-sh-"));
  tmpRoots.push(root);
  mkdirSync(join(root, "scripts"));
  for (const f of ["machine-id", "pm"]) cpSync(join(REPO_ROOT, "scripts", f), join(root, "scripts", f));
  const panelSrc = join(REPO_ROOT, "panel");
  const panelDst = join(root, "panel");
  mkdirSync(panelDst);
  cpSync(join(panelSrc, "server"), join(panelDst, "server"), {
    recursive: true,
    filter: (src) => !src.includes("__tests__"),
  });
  for (const f of ["panel.config.ts", "tsconfig.json", "package.json"]) {
    cpSync(join(panelSrc, f), join(panelDst, f));
  }
  symlinkSync(join(panelSrc, "node_modules"), join(panelDst, "node_modules"), "dir");
  writeFileSync(join(panelDst, "panel.config.local.ts"), localConfig);
  return root;
}

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

  it("scripts/machine-id prints the sanitized machineId override from panel.config.local.ts", () => {
    const root = repoCopyWithLocalConfig(`export default { machineId: "HAL 9000!" };\n`);
    const script = join(root, "scripts", "machine-id");
    for (const cwd of [root, tmpdir()]) {
      const res = spawnSync("bash", [script], { cwd, encoding: "utf8" });
      expect(res.status, res.stderr).toBe(0);
      expect(res.stdout).toBe("hal-9000\n");
    }
  });
});
