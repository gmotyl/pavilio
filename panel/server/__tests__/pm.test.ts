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

/** The same file, byte for byte — for the CRLF/BOM cases a Windows editor writes. */
function writeLocalEnvRaw(contents: string) {
  writeFileSync(join(repo, "scripts", "start-panel-windows.local.env"), contents);
}

/**
 * A fake ~/.nvm/nvm.sh: the real one defines `nvm` as a shell function, and
 * scripts/pm sources it and then runs `nvm use default`. Nothing but a function
 * definition is needed for the probe to be exercised.
 */
function writeNvmSh(nodeDir: string) {
  mkdirSync(join(home, ".nvm"), { recursive: true });
  writeFileSync(
    join(home, ".nvm", "nvm.sh"),
    ['nvm() {', '  [ "$1" = "use" ] || return 0', `  PATH="${nodeDir}:$PATH"`, "  export PATH", "}", ""].join(
      "\n",
    ),
  );
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
    // The probe walks the glob, i.e. lexical order: v18.1.0, v20.0.0, v9.11.2.
    // The numerically newest is v20.0.0, which is neither the first nor the last
    // of those — so a comparator that always says "greater" lands on v9.11.2, one
    // that never does lands on v18.1.0, a reversed one lands on v9.11.2, and a
    // plain string compare picks v9.11.2 as well. Only a numeric, segment-wise
    // compare picks v20.0.0.
    const versions = ["v9.11.2", "v18.1.0", "v20.0.0"].map((v) =>
      join(home, ".nvm", "versions", "node", v, "bin"),
    );
    const newest = join(home, ".nvm", "versions", "node", "v20.0.0", "bin");
    for (const dir of versions) {
      stub(dir, "node");
      stub(dir, "pnpm");
    }

    const { status, output } = runHarness();

    expect(status).toBe(0);
    expect(field(output, "NODE_BIN_DIR")).toBe(newest);
    expect(field(output, "PATH")).not.toContain(join(sandbox, "gone"));
  }, 30000);

  // pm_version_gt is hand-rolled (no `sort -V`: an external, and BSD sort has no
  // -V), so it gets a table of its own rather than only the fixture above.
  it("compares versions numerically, segment by segment", () => {
    const cases: Array<[string, string, boolean]> = [
      // Lexical order disagrees with numeric order.
      ["v10.0.0", "v9.11.2", true],
      ["v9.11.2", "v10.0.0", false],
      ["v100.0.0", "v99.99.99", true],
      ["v99.99.99", "v100.0.0", false],
      // Later segments still count.
      ["v20.0.10", "v20.0.0", true],
      ["v20.0.0", "v20.0.10", false],
      ["v22.1", "v22", true],
      ["v22", "v22.1", false],
      ["v20.0.0.1", "v20.0.0", true],
      ["v20.0.0", "v20.0.0.1", false],
      // Equal is not greater, with or without the `v` and leading zeros.
      ["v20.0.0", "v20.0.0", false],
      ["v08.0.0", "8.0.0", false],
      ["v08.0.0", "v7.9.9", true],
      // A prerelease sorts below its own release, never above it.
      ["v22.0.0-rc.1", "v22.0.0", false],
      ["v22.0.0", "v22.0.0-rc.1", true],
      ["v22.0.0-rc.1", "v22.0.1", false],
      ["v22.0.1", "v22.0.0-rc.1", true],
      // Junk directory names sort below anything numeric, and never hang.
      ["lts", "v20.0.0", false],
      ["v20.0.0", "lts", true],
      ["", "v1.0.0", false],
      ["v1.0.0", "", true],
    ];

    const body = cases
      .map(
        ([a, b], i) => `if pm_version_gt "${a}" "${b}"; then echo "C${i}=yes"; else echo "C${i}=no"; fi`,
      )
      .join("\n");
    const { status, output } = runHarness(body);

    expect(status).toBe(0);
    const actual = cases.map((_, i) => field(output, `C${i}`));
    const expected = cases.map(([, , gt]) => (gt ? "yes" : "no"));
    // Compared as a whole so a failure names every pair that moved.
    expect(cases.map(([a, b], i) => `${a} > ${b} : ${actual[i]}`)).toEqual(
      cases.map(([a, b], i) => `${a} > ${b} : ${expected[i]}`),
    );
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

  it("pm_install installs dependencies with pnpm -C and npm --prefix, not a run script", () => {
    const withPnpm = join(sandbox, "with-pnpm");
    stub(withPnpm, "node");
    stub(withPnpm, "pnpm");
    stub(withPnpm, "npm");
    writeLocalEnv(`PAVILIO_NODE_BIN="${withPnpm}"`);

    const body = ["pm_resolve || exit 1", 'echo "PM=$PM"', "pm_install panel"].join("\n");
    const pnpmRun = runHarness(body);

    expect(pnpmRun.status).toBe(0);
    expect(field(pnpmRun.output, "PM")).toBe("pnpm");
    expect(pnpmRun.output).toContain("pnpm -C panel install");

    // The npm fallback this exists for: dependency installation, never
    // `run install`. panel/package.json has no script by that name, so the
    // pm_in spelling (`npm --prefix panel run install --`) dies on
    // "Missing script: install" — and under `set -e` takes the update with it.
    const npmOnly = join(sandbox, "npm-only");
    stub(npmOnly, "node");
    stub(npmOnly, "npm");
    writeLocalEnv(`PAVILIO_NODE_BIN="${npmOnly}"`);

    const npmRun = runHarness(body);

    expect(npmRun.status).toBe(0);
    expect(field(npmRun.output, "PM")).toBe("npm");
    expect(npmRun.output).toContain("npm --prefix panel install");
    expect(npmRun.output).not.toContain("run install");
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

  it("probes PNPM_HOME, nvm, fnm and volta in the documented order", () => {
    const pnpmHome = join(sandbox, "pnpm-home");
    const nvmNode = join(sandbox, "nvm-node");
    const fnmNode = join(sandbox, "fnm-node");
    const voltaBin = join(home, ".volta", "bin");
    for (const dir of [pnpmHome, nvmNode, fnmNode, voltaBin]) {
      stub(dir, "node");
      stub(dir, "pnpm");
    }
    // ~/.nvm/nvm.sh is sourced, `fnm env` prints exports the caller should eval.
    writeNvmSh(nvmNode);
    stub(stubBin, "fnm", `echo 'export PATH="${fnmNode}:$PATH"'`);

    // Every one of the four is available: PNPM_HOME is the first of them.
    const all = runHarness(DEFAULT_BODY, { PNPM_HOME: pnpmHome });
    expect(all.status).toBe(0);
    expect(field(all.output, "NODE_BIN_DIR")).toBe(pnpmHome);

    // Without PNPM_HOME, nvm proper comes before fnm.
    const noPnpmHome = runHarness();
    expect(noPnpmHome.status).toBe(0);
    expect(field(noPnpmHome.output, "NODE_BIN_DIR")).toBe(nvmNode);

    // Without a sourceable nvm.sh, fnm is next.
    rmSync(join(home, ".nvm", "nvm.sh"));
    const noNvm = runHarness();
    expect(noNvm.status).toBe(0);
    expect(field(noNvm.output, "NODE_BIN_DIR")).toBe(fnmNode);

    // Without fnm either, volta is the last of the four.
    rmSync(join(stubBin, "fnm"));
    const voltaOnly = runHarness();
    expect(voltaOnly.status).toBe(0);
    expect(field(voltaOnly.output, "NODE_BIN_DIR")).toBe(voltaBin);
  }, 30000);

  it("survives an nvm.sh that trips nounset and moves on to the next probe", () => {
    // Every entry point that sources pm runs under `set -u`
    // (scripts/panel, scripts/start-panel-windows.sh). A reference to an unbound
    // variable inside a sourced file then aborts the *sourcing* shell outright —
    // not the probe, the whole process — and on the double-clicked Windows
    // shortcut that means the window closes with nothing on it at all. The
    // source is redirected to /dev/null, so there is not even a message.
    mkdirSync(join(home, ".nvm"), { recursive: true });
    writeFileSync(
      join(home, ".nvm", "nvm.sh"),
      'echo "$PM_TEST_DEFINITELY_UNBOUND"\nnvm() { return 0; }\n',
    );

    // A perfectly good toolchain sits one probe further down the list.
    const fnmNode = join(sandbox, "fnm-node");
    stub(fnmNode, "node");
    stub(fnmNode, "pnpm");
    stub(stubBin, "fnm", `echo 'export PATH="${fnmNode}:$PATH"'`);

    const { status, output } = runHarness(
      [
        "set -u",
        DEFAULT_BODY,
        // Still alive, and nounset is still in force for everything after the
        // probe — the guard restores what it found rather than leaving it off.
        'echo "SURVIVED=yes"',
        'case "$-" in *u*) echo "NOUNSET=on" ;; *) echo "NOUNSET=off" ;; esac',
      ].join("\n"),
    );

    expect(status).toBe(0);
    expect(field(output, "SURVIVED")).toBe("yes");
    expect(field(output, "NOUNSET")).toBe("on");
    expect(field(output, "NODE_BIN_DIR")).toBe(fnmNode);
  }, 30000);

  it("short-circuits every probe when node is already on PATH", () => {
    // Step 2 of the documented order: a normal terminal already carrying a
    // toolchain must be left alone, whatever the version managers would say.
    stub(stubBin, "node");
    stub(stubBin, "pnpm");
    const pnpmHome = join(sandbox, "pnpm-home");
    const nvmNode = join(sandbox, "nvm-node");
    const voltaBin = join(home, ".volta", "bin");
    for (const dir of [pnpmHome, nvmNode, voltaBin]) {
      stub(dir, "node");
      stub(dir, "pnpm");
    }
    writeNvmSh(nvmNode);

    const { status, output } = runHarness(DEFAULT_BODY, { PNPM_HOME: pnpmHome });

    expect(status).toBe(0);
    expect(field(output, "PM")).toBe("pnpm");
    expect(field(output, "NODE_BIN_DIR")).toBe(stubBin);
    expect(field(output, "PATH")).toBe(stubBin);
  }, 30000);

  it("reads a pin written with CRLF line endings and a BOM", () => {
    // scripts/start-panel-windows.local.env is edited on the Windows side, where
    // an editor may well save CRLF and a leading BOM. Either one used to end up
    // inside the value, fail the -d test, and drop the pin with no diagnostic.
    const pinned = join(sandbox, "pinned-bin");
    stub(pinned, "node");
    stub(pinned, "pnpm");
    writeLocalEnvRaw(`PAVILIO_NODE_BIN="${pinned}"\r\nPANEL_EXTRA_PORTS="4000"\r\n`);

    const crlf = runHarness();
    expect(crlf.status).toBe(0);
    expect(field(crlf.output, "NODE_BIN_DIR")).toBe(pinned);

    writeLocalEnvRaw(`\uFEFFPAVILIO_NODE_BIN="${pinned}"\r\n`);

    const bom = runHarness();
    expect(bom.status).toBe(0);
    expect(field(bom.output, "NODE_BIN_DIR")).toBe(pinned);
  }, 30000);

  it("honours an exported PAVILIO_NODE_BIN whether or not the env file exists", () => {
    const exported = join(sandbox, "exported-bin");
    stub(exported, "node");
    stub(exported, "pnpm");

    // No env file at all.
    const noFile = runHarness(DEFAULT_BODY, { PAVILIO_NODE_BIN: exported });
    expect(noFile.status).toBe(0);
    expect(field(noFile.output, "NODE_BIN_DIR")).toBe(exported);

    // An env file that sets other things must not discard it either.
    writeLocalEnv('PANEL_EXTRA_PORTS="4000"');
    const otherVars = runHarness(DEFAULT_BODY, { PAVILIO_NODE_BIN: exported });
    expect(otherVars.status).toBe(0);
    expect(field(otherVars.output, "NODE_BIN_DIR")).toBe(exported);

    // The file's own pin is the per-host one, so it wins over the environment.
    const filePin = join(sandbox, "file-bin");
    stub(filePin, "node");
    stub(filePin, "pnpm");
    writeLocalEnv(`PAVILIO_NODE_BIN="${filePin}"`);
    const fileWins = runHarness(DEFAULT_BODY, { PAVILIO_NODE_BIN: exported });
    expect(fileWins.status).toBe(0);
    expect(field(fileWins.output, "NODE_BIN_DIR")).toBe(filePin);
  }, 30000);
});
