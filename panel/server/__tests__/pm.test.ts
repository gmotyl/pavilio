import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * scripts/pm is sourced, never executed, so every case here runs a tiny harness
 * script that sources a *copy* of it from <sandbox>/repo/scripts/ and prints what
 * pm_resolve produced. The copy matters twice over: the not-found message names
 * the repo root it derives from its own location, and pm_local_env_path() points
 * at scripts/start-panel-windows.local.env — an untracked file that may well
 * exist on the real machine.
 *
 * Nothing here may see the host toolchain: the harness gets an environment built
 * from scratch (no process.env), a PATH holding only sandbox stub dirs, and a
 * redirected HOME, so nvm/fnm/volta/pnpm are whatever the fixture puts there.
 * That also means scripts/pm must not reach for coreutils — with this PATH there
 * are none.
 */

const PM_SCRIPT = resolve(__dirname, "../../../scripts/pm");

// Absolute, because the harness runs on a PATH that could not resolve `bash`.
const BASH =
  spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim() || "/bin/bash";

let sandbox: string;
let repo: string;
let home: string;
let stubBin: string;

/** Write an executable stub that echoes the argv it was called with. */
function stub(dir: string, name: string, body = `echo "${name} $*"`) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

/** The untracked per-host env file scripts/pm reads PAVILIO_NODE_BIN from. */
function writeLocalEnv(contents: string) {
  writeFileSync(join(repo, "scripts", "start-panel-windows.local.env"), `${contents}\n`);
}

const DEFAULT_BODY = [
  "pm_resolve || exit 1",
  'echo "PM=$PM"',
  'echo "NODE_BIN_DIR=$NODE_BIN_DIR"',
  'echo "PATH=$PATH"',
].join("\n");

function runHarness(body: string = DEFAULT_BODY, extraEnv: Record<string, string> = {}) {
  const harness = join(sandbox, "harness.sh");
  writeFileSync(
    harness,
    `#!/usr/bin/env bash\n. "${join(repo, "scripts", "pm")}" || exit 1\n${body}\n`,
    { mode: 0o755 },
  );
  const res = spawnSync(BASH, [harness], {
    encoding: "utf8",
    env: { HOME: home, PATH: stubBin, ...extraEnv },
  });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

/** Pull one `KEY=value` line out of the harness output. */
function field(output: string, key: string): string {
  const line = output.split("\n").find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1) : "";
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "pm-resolve-"));
  repo = join(sandbox, "repo");
  home = join(sandbox, "home");
  stubBin = join(sandbox, "bin");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(home, { recursive: true });
  // On PATH for every run, and deliberately empty: no node, no pnpm, no npm.
  mkdirSync(stubBin, { recursive: true });
  copyFileSync(PM_SCRIPT, join(repo, "scripts", "pm"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("scripts/pm toolchain resolution", () => {
  it("uses the pinned PAVILIO_NODE_BIN when the directory exists", () => {
    const pinned = join(sandbox, "pinned-bin");
    stub(pinned, "node");
    stub(pinned, "pnpm");
    writeLocalEnv(`PAVILIO_NODE_BIN="${pinned}"`);

    const { status, output } = runHarness();

    expect(status).toBe(0);
    expect(field(output, "PM")).toBe("pnpm");
    expect(field(output, "NODE_BIN_DIR")).toBe(pinned);
    expect(field(output, "PATH").split(":")[0]).toBe(pinned);

    // Sourced and resolved a second time in the same shell, the pinned dir must
    // not pile up on PATH — start-panel-windows.sh sources it and then calls the
    // update script, which sources it again.
    const twice = runHarness(
      [
        "pm_resolve || exit 1",
        `. "${join(repo, "scripts", "pm")}" || exit 1`,
        "pm_resolve || exit 1",
        'echo "PATH=$PATH"',
      ].join("\n"),
    );
    const entries = field(twice.output, "PATH")
      .split(":")
      .filter((p) => p === pinned);
    expect(entries).toHaveLength(1);
  }, 30000);

  it("falls through a stale pin to the newest nvm version", () => {
    writeLocalEnv(`PAVILIO_NODE_BIN="${join(sandbox, "gone")}"`);
    const old = join(home, ".nvm", "versions", "node", "v20.0.0", "bin");
    const newest = join(home, ".nvm", "versions", "node", "v24.1.0", "bin");
    for (const dir of [old, newest]) {
      stub(dir, "node");
      stub(dir, "pnpm");
    }

    const { status, output } = runHarness();

    expect(status).toBe(0);
    expect(field(output, "NODE_BIN_DIR")).toBe(newest);
    // Lexical ordering would have picked v20 last; the stale pin must be gone.
    expect(field(output, "PATH")).not.toContain(join(sandbox, "gone"));
  }, 30000);

  it("prefers pnpm and falls back to npm with --prefix", () => {
    const withPnpm = join(sandbox, "with-pnpm");
    stub(withPnpm, "node");
    stub(withPnpm, "pnpm");
    stub(withPnpm, "npm");
    writeLocalEnv(`PAVILIO_NODE_BIN="${withPnpm}"`);

    const body = ["pm_resolve || exit 1", 'echo "PM=$PM"', "pm_in panel build"].join("\n");
    const pnpmRun = runHarness(body);

    expect(pnpmRun.status).toBe(0);
    expect(field(pnpmRun.output, "PM")).toBe("pnpm");
    expect(pnpmRun.output).toContain("pnpm -C panel build");

    // Same script, a toolchain that only ships npm.
    const npmOnly = join(sandbox, "npm-only");
    stub(npmOnly, "node");
    stub(npmOnly, "npm");
    writeLocalEnv(`PAVILIO_NODE_BIN="${npmOnly}"`);

    const npmRun = runHarness(body);

    expect(npmRun.status).toBe(0);
    expect(field(npmRun.output, "PM")).toBe("npm");
    expect(npmRun.output).toContain("npm --prefix panel run build --");
  }, 30000);

  it("fails with a message naming pnpm setup when no node is found", () => {
    // No local env file, an empty HOME and a PATH with nothing on it.
    const { status, output } = runHarness();

    expect(status).not.toBe(0);
    expect(output).toMatch(/node\/pnpm not found/i);
    expect(output).toContain("pnpm setup");
    expect(output).toContain(repo);
    expect(output).not.toContain("NODE_BIN_DIR=");
  }, 30000);

  it("probes PNPM_HOME, fnm and volta in the documented order", () => {
    const pnpmHome = join(sandbox, "pnpm-home");
    const fnmNode = join(sandbox, "fnm-node");
    const voltaBin = join(home, ".volta", "bin");
    for (const dir of [pnpmHome, fnmNode, voltaBin]) {
      stub(dir, "node");
      stub(dir, "pnpm");
    }
    // `fnm env` prints the exports its shell should eval.
    stub(stubBin, "fnm", `echo 'export PATH="${fnmNode}:$PATH"'`);

    const all = runHarness(DEFAULT_BODY, { PNPM_HOME: pnpmHome });
    expect(all.status).toBe(0);
    expect(field(all.output, "NODE_BIN_DIR")).toBe(pnpmHome);

    // Without PNPM_HOME, fnm is next.
    const noPnpmHome = runHarness();
    expect(noPnpmHome.status).toBe(0);
    expect(field(noPnpmHome.output, "NODE_BIN_DIR")).toBe(fnmNode);

    // Without fnm either, volta is the last of the three.
    rmSync(join(stubBin, "fnm"));
    const voltaOnly = runHarness();
    expect(voltaOnly.status).toBe(0);
    expect(field(voltaOnly.output, "NODE_BIN_DIR")).toBe(voltaBin);
  }, 30000);
});
