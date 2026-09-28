import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * scripts/start-panel-windows.sh is what a Windows desktop shortcut runs through
 * `bash -lc`. A login shell reads none of the dotfiles that put nvm/fnm on PATH,
 * so the launcher has to resolve its own toolchain (scripts/pm) before it starts
 * anything, and then hand the process off to scripts/panel rather than shelling
 * out to a bare `npm`.
 *
 * Every case here runs a *copy* of the launcher out of <sandbox>/repo/scripts/,
 * next to the real scripts/pm and a stub scripts/panel that only records the
 * subcommand it was asked for.
 *
 * ISOLATION — this suite also runs inside real WSL, where powershell.exe is on
 * PATH, netsh is one interop hop away, and a real panel may be listening on the
 * default port. None of that may be reachable:
 *
 *   - the environment is built from literals; process.env is never passed on,
 *     so no inherited PATH, HOME, PANEL_* or PAVILIO_NODE_BIN leaks in;
 *   - PATH is a single sandbox directory. It holds a stub curl, a stub bash, a
 *     sentinel netsh, and symlinks to a short, explicit whitelist of read-only
 *     coreutils. powershell.exe is deliberately absent, which is the only thing
 *     that gates the portproxy block — so the Windows side is unreachable by
 *     construction, not by assertion;
 *   - the sentinel netsh writes a marker file that every case asserts is absent,
 *     so a future edit that reached for netsh some other way would go red;
 *   - PANEL_PORT is 39010, not the default 3010, and curl is a stub that never
 *     opens a socket — no real panel can be polled, rebound or started;
 *   - HOME points into the sandbox, so pm's nvm/fnm/volta probes see an empty
 *     home instead of the developer's.
 */

const LAUNCHER = resolve(__dirname, "../../../scripts/start-panel-windows.sh");
const PM_SCRIPT = resolve(__dirname, "../../../scripts/pm");

// Absolute, because the launcher runs on a PATH that could not resolve `bash`.
const BASH =
  spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim() || "/bin/bash";

/** Not the default 3010: nothing real is ever on this one. */
const PORT = "39010";

/** What the stub curl answers for /api/mobile-access/status. */
const LAN_IP = "192.168.7.42";
const TOKEN = "TESTTOKEN42";
const TS_HOST = "sandbox-host.tail1a2b3.ts.net";

/**
 * The real body of GET /api/mobile-access/status, as built by
 * panel/server/routes/mobile-access.ts: `{ tailscale, lan, host }` in that
 * order. The LAN address lives at `lan.lanIp` and every pair link is a `qrUrl`
 * — there is no flat `pairUrl` anywhere in it.
 *
 * The ordering is load-bearing for the launcher, not decoration: `tailscale`
 * comes first and carries a `#mt=` of its own, so the `head -n 1` the launcher
 * uses to pull the token reads the tailscale link, not the LAN one. Both
 * channels are stamped with the same pairing token, which is exactly why that
 * is safe — this fixture pins it.
 */
const STATUS_JSON = JSON.stringify({
  tailscale: {
    state: "on",
    selfHost: TS_HOST,
    url: `https://${TS_HOST}`,
    qrUrl: `https://${TS_HOST}/#mt=${TOKEN}`,
  },
  lan: {
    state: "on",
    lanIp: LAN_IP,
    url: `http://${LAN_IP}:${PORT}`,
    qrUrl: `http://${LAN_IP}:${PORT}/#mt=${TOKEN}`,
  },
  host: { wsl: false, wslVmIp: null, platform: "linux" },
});

let sandbox: string;
let repo: string;
let home: string;
let stubBin: string;
let nodeBin: string;
/** Ordered record of what actually ran: `panel start`, then any post-launch cmd. */
let orderLog: string;
/** The PATH the stub scripts/panel was handed — proof the toolchain came first. */
let panelPathLog: string;
/** Written only if anything ever invokes netsh. Asserted absent everywhere. */
let netshMarker: string;

/** Absolute path of a host binary, resolved through sh so no shell alias applies. */
function realBin(name: string): string {
  const found = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).stdout.trim();
  expect(found, `host is missing ${name}, which the launcher needs`).toBeTruthy();
  return found;
}

function stub(name: string, body: string) {
  writeFileSync(join(stubBin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

/** The untracked per-host env file, read by both the launcher and scripts/pm. */
function writeLocalEnv(contents: string) {
  writeFileSync(join(repo, "scripts", "start-panel-windows.local.env"), `${contents}\n`);
}

/** What the never-run stubs below shout on stderr if anything ever runs them. */
const EXECUTED_MARKER = "was executed";

/**
 * A directory holding a `node` and a `pnpm` that exist but must never be run:
 * the launcher only has to put them on PATH and hand over to scripts/panel.
 * Both shout on stderr and exit 97, and `expectNoToolchainWasRun` asserts that
 * neither ever happened — without it, a launcher that started shelling out to
 * a bare `node`/`pnpm` again would pass every case here unnoticed.
 */
function writePinnedToolchain() {
  mkdirSync(nodeBin, { recursive: true });
  for (const name of ["node", "pnpm"]) {
    writeFileSync(
      join(nodeBin, name),
      `#!/bin/sh\necho "stub ${name} ${EXECUTED_MARKER}" >&2\nexit 97\n`,
      { mode: 0o755 },
    );
  }
}

/** Neither stub ran, and neither one's exit code leaked out of the run. */
function expectNoToolchainWasRun(status: number | null, output: string) {
  expect(output).not.toContain(EXECUTED_MARKER);
  expect(status).not.toBe(97);
}

/** The lines the stub scripts/panel and any post-launch command recorded. */
function order(): string[] {
  if (!existsSync(orderLog)) return [];
  return readFileSync(orderLog, "utf8").split("\n").filter((l) => l.length > 0);
}

function run(extraEnv: Record<string, string> = {}) {
  const res = spawnSync(BASH, [join(repo, "scripts", "start-panel-windows.sh")], {
    encoding: "utf8",
    env: { HOME: home, PATH: stubBin, PANEL_PORT: PORT, ...extraEnv },
    timeout: 25000,
  });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "launcher-toolchain-"));
  repo = join(sandbox, "repo");
  home = join(sandbox, "home");
  stubBin = join(sandbox, "bin");
  nodeBin = join(sandbox, "pinned-node");
  orderLog = join(sandbox, "order.log");
  panelPathLog = join(sandbox, "panel-path.log");
  netshMarker = join(sandbox, "NETSH-WAS-RUN");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(stubBin, { recursive: true });

  copyFileSync(LAUNCHER, join(repo, "scripts", "start-panel-windows.sh"));
  copyFileSync(PM_SCRIPT, join(repo, "scripts", "pm"));

  // The process owner the launcher must delegate to. Records the subcommand and
  // the PATH it inherited; starts nothing.
  writeFileSync(
    join(repo, "scripts", "panel"),
    [
      "#!/bin/sh",
      "# Stub scripts/panel: record the call, start no panel.",
      `echo "panel $*" >> "${orderLog}"`,
      `echo "$PATH" > "${panelPathLog}"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  // Read-only coreutils the launcher legitimately uses, whitelisted one by one.
  // `ip`, `awk`, `sed` and `timeout` are deliberately NOT here: they belong to
  // the WSL block, which must never be entered.
  // `dirname` is first for a reason: without it SCRIPT_DIR collapses to the
  // cwd and the launcher cd's into the *real* checkout instead of the sandbox.
  for (const name of ["dirname", "seq", "grep", "head", "cut", "tr"]) {
    symlinkSync(realBin(name), join(stubBin, name));
  }

  // No-op sleep: the poll loops must not spend real seconds.
  stub("sleep", "exit 0");

  // Stub curl: answers the two endpoints the launcher polls, opens no socket.
  stub(
    "curl",
    [
      "# Stub curl: no network. The URL is always the last argument.",
      'for arg in "$@"; do url="$arg"; done',
      'case "$url" in',
      `  */api/mobile-access/status) printf '%s\\n' '${STATUS_JSON}' ;;`,
      "esac",
      "exit 0",
    ].join("\n"),
  );

  // Stub bash: the launcher ends with `exec bash`, and with `exec bash -lc <cmd>`
  // when PANEL_POST_LAUNCH_CMD is set. Answer both without an interactive shell.
  stub(
    "bash",
    [
      'if [ "$1" = "-lc" ]; then',
      "  shift",
      '  exec /bin/sh -c "$1"',
      "fi",
      "exit 0",
    ].join("\n"),
  );

  // Sentinel: nothing in this suite may ever reach netsh.
  stub("netsh", `: > "${netshMarker}"\nexit 0`);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("scripts/start-panel-windows.sh toolchain handoff", () => {
  it("fails before starting anything when the toolchain cannot be resolved", () => {
    // No pin, no node on PATH, an empty HOME: exactly the double-clicked
    // shortcut whose `bash -lc` read no dotfiles.
    const { status, output } = run();

    expect(status).toBe(1);
    // scripts/pm's own diagnosis, naming the sandbox checkout it derived.
    expect(output).toContain("node/pnpm not found");
    expect(output).toContain(`run: pnpm bootstrap`);
    expect(output).toContain(repo);

    // And nothing was started, polled or printed as ready.
    expect(order()).toEqual([]);
    expect(existsSync(panelPathLog)).toBe(false);
    expect(output).not.toContain("Pavilio panel ready");
    expect(existsSync(netshMarker)).toBe(false);
    expectNoToolchainWasRun(status, output);
  }, 30000);

  it("starts the panel through scripts/panel once the pinned toolchain resolves", () => {
    writePinnedToolchain();
    writeLocalEnv(`PAVILIO_NODE_BIN="${nodeBin}"`);

    const { status, output } = run();

    expect(status).toBe(0);
    // Exactly one delegation, and it is `start`.
    expect(order()).toEqual(["panel start"]);
    // The pinned interpreter was on PATH before scripts/panel was handed the
    // job — the whole point of resolving first rather than running a bare npm.
    expect(readFileSync(panelPathLog, "utf8").trim().split(":")).toContain(nodeBin);
    expect(output).not.toContain("node/pnpm not found");
    expect(existsSync(netshMarker)).toBe(false);
    // On PATH is all they were ever for: the launcher must not run them itself.
    expectNoToolchainWasRun(status, output);
  }, 30000);

  it("skips the WSL block outside WSL and still prints the local link", () => {
    writePinnedToolchain();
    writeLocalEnv(`PAVILIO_NODE_BIN="${nodeBin}"`);

    // powershell.exe is absent from the stub PATH, so this is a plain Linux
    // checkout as far as the launcher can tell.
    const { status, output } = run();

    expect(status).toBe(0);
    expect(output).not.toContain("portproxy");
    expect(output).not.toContain("UAC");
    expect(existsSync(netshMarker)).toBe(false);

    // The run still reaches the end and hands over a clickable pair link.
    expect(output).toContain("===== Pavilio panel ready =====");
    expect(output).toContain(`Local browser:   http://localhost:${PORT}/#mt=${TOKEN}`);
    expect(output).toContain(`LAN devices:     http://${LAN_IP}:${PORT}/#mt=${TOKEN}`);
    expect(order()).toEqual(["panel start"]);

    // The parting hint has to be a command that works on the host this ran on.
    // `npm stop` is not: the shortcut exists precisely because such a machine
    // may carry pnpm only, or no package manager on PATH at all.
    expect(output).toContain("./scripts/panel stop");
    expect(output).not.toMatch(/Stop with:\s*npm/);
    expectNoToolchainWasRun(status, output);
  }, 30000);

  it("stops with a clear message when scripts/panel cannot start the panel", () => {
    writePinnedToolchain();
    writeLocalEnv(`PAVILIO_NODE_BIN="${nodeBin}"`);

    // scripts/panel already prints the real reason (a failed panel/dist build,
    // a port it cannot have) and exits non-zero. The launcher used to discard
    // that status and carry on: ~15s of dots, then a "(Could not extract
    // pairing token...)" line that blames the wrong thing entirely.
    writeFileSync(
      join(repo, "scripts", "panel"),
      [
        "#!/bin/sh",
        `echo "panel $*" >> "${orderLog}"`,
        'echo "Panel build failed — not starting. Fix the build above and re-run." >&2',
        "exit 1",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const { status, output } = run();

    expect(status).not.toBe(0);
    // scripts/panel was asked exactly once, and its own diagnosis survives.
    expect(order()).toEqual(["panel start"]);
    expect(output).toContain("Panel build failed");
    // ...with the launcher saying plainly that it is giving up.
    expect(output).toMatch(/panel (did not|could not|failed to) start/i);

    // And none of the misleading tail ran: no polling, no pairing links, no
    // token line pinning the blame on a token that was never the problem.
    expect(output).not.toContain("Waiting for panel");
    expect(output).not.toContain("Could not extract pairing token");
    expect(output).not.toContain("===== Pavilio panel ready =====");
    expect(existsSync(netshMarker)).toBe(false);
    expectNoToolchainWasRun(status, output);
  }, 30000);

  it("still runs PANEL_POST_LAUNCH_CMD last", () => {
    writePinnedToolchain();
    writeLocalEnv(
      [
        `PAVILIO_NODE_BIN="${nodeBin}"`,
        `PANEL_POST_LAUNCH_CMD='echo post-launch >> "${orderLog}"'`,
      ].join("\n"),
    );

    const { status, output } = run();

    expect(status).toBe(0);
    expect(output).toContain("Running PANEL_POST_LAUNCH_CMD...");
    // Last, and after the panel was started — not instead of it.
    expect(order()).toEqual(["panel start", "post-launch"]);
    expect(existsSync(netshMarker)).toBe(false);
    expectNoToolchainWasRun(status, output);
  }, 30000);
});
