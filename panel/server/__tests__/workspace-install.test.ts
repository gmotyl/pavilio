import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The repo is one pnpm workspace: the root holds the only lockfile and the
 * install policy, and `panel` is its one package. A second lockfile next to the
 * panel, or install settings left in panel/package.json, would silently split
 * the install back into two — pnpm ignores the `pnpm` field of a non-root
 * workspace package.
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const PANEL_DIR = join(REPO_ROOT, "panel");
const FIX_SCRIPT = join(PANEL_DIR, "scripts", "fix-node-pty-perms.cjs");

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

describe("workspace install", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("the workspace tracks a single root lockfile and no npm lockfile", () => {
    const files = trackedFiles();
    const pnpmLocks = files.filter((f) => f === "pnpm-lock.yaml" || f.endsWith("/pnpm-lock.yaml"));
    const npmLocks = files.filter((f) => f === "package-lock.json" || f.endsWith("/package-lock.json"));
    expect(pnpmLocks).toEqual(["pnpm-lock.yaml"]);
    expect(npmLocks).toEqual([]);
  });

  it("onlyBuiltDependencies lives at the workspace root, not in panel/package.json", () => {
    const panelPkg = JSON.parse(readFileSync(join(PANEL_DIR, "package.json"), "utf8"));
    // panel/package.json carries no install settings of its own.
    expect(panelPkg.pnpm).toBeUndefined();

    const workspace = readFileSync(join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
    // A minimal parse of the two top-level lists the contract names.
    const list = (key: string): string[] => {
      const m = new RegExp(`^${key}:\\s*\\n((?:[ \\t]+-[^\\n]*\\n?)+)`, "m").exec(workspace);
      if (!m) return [];
      return m[1]
        .split("\n")
        .map((l) => l.trim().replace(/^-\s*/, "").replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    };
    expect(list("packages")).toEqual(["panel"]);
    expect(list("onlyBuiltDependencies")).toEqual(["node-pty"]);
  });

  it("fix-node-pty-perms finds node-pty in the workspace root store", () => {
    tmp = mkdtempSync(join(tmpdir(), "pavilio-ws-pty-"));
    const panel = join(tmp, "panel");
    mkdirSync(join(panel, "node_modules"), { recursive: true });
    // node-pty exists only in the root virtual store, as a workspace install lays it out.
    const prebuild = join(
      tmp,
      "node_modules",
      ".pnpm",
      "node-pty@1.1.0",
      "node_modules",
      "node-pty",
      "prebuilds",
      "linux-x64",
    );
    mkdirSync(prebuild, { recursive: true });
    const helper = join(prebuild, "spawn-helper");
    writeFileSync(helper, "#!/bin/sh\n");
    chmodSync(helper, 0o644);

    execFileSync(process.execPath, [FIX_SCRIPT, panel], { encoding: "utf8" });

    expect(statSync(helper).mode & 0o777).toBe(0o755);
  });
});
