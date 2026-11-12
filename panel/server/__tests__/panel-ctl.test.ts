import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * scripts/panel derives its repo root from its own location, so every case here
 * runs a *copy* of it — together with scripts/pm, which it sources — out of
 * <sandbox>/repo/scripts/. That keeps panel/dist, panel/.panel.log and every
 * process the script starts inside the sandbox: the developer's own panel on
 * 3010 is never seen, never bound and never killed.
 *
 * The server is stubbed too. A `pnpm` on a private PATH answers
 * `pm_in panel start` with a tiny node HTTP server and `pm_in panel build` with
 * whatever the case needs, so nothing here builds or boots the real panel.
 *
 * Ports are random and high, so a second concurrent run of this suite cannot
 * collide with the first, and afterEach kills whatever still holds the port even
 * when an assertion threw — a leaked listener would wedge every later run.
 */

const PANEL_CTL = resolve(__dirname, "../../../scripts/panel");
const PM_SCRIPT = resolve(__dirname, "../../../scripts/pm");
const ROOT_PACKAGE_JSON = resolve(__dirname, "../../../package.json");

/** Host tools scripts/panel uses when present and works around when absent (stock macOS). */
const hasTool = (name: string) => spawnSync("bash", ["-c", `command -v ${name}`]).status === 0;
const HAS_SETSID = hasTool("setsid");
const HAS_TIMEOUT = hasTool("timeout");

let sandbox: string;
let repo: string;
let stubBin: string;
let serverJs: string;
/** PANEL_AUTH_STATE_DIR for every run: where scripts/panel looks for secrets.env. */
let stateDir: string;
let port: number;
/** Further sandbox ports a case may have put a listener on; reaped in afterEach. */
let extraPorts: number[] = [];

/** Is anything accepting connections on the port right now? */
function portOpen(p: number): boolean {
  const res = spawnSync("bash", ["-c", `(exec 3<>/dev/tcp/127.0.0.1/${p}) 2>/dev/null`]);
  return res.status === 0;
}

/** The pid listening on the port, or 0 when nothing is. */
function listenerPid(p: number): number {
  const res = spawnSync("lsof", ["-ti", `tcp:${p}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  const first = res.stdout.split("\n").find((l) => l.trim().length > 0);
  return first ? Number(first.trim()) : 0;
}

/** Session id of a pid, as `ps` reports it ("" when the pid is gone). */
function sessionId(pid: number): string {
  return spawnSync("ps", ["-o", "sid=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll rather than sleep a fixed amount: this suite shares a loaded machine. */
async function waitUntil(predicate: () => boolean, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return predicate();
}

/** A high, random port, so nothing here ever fights 3010 or a parallel run. */
function pickFreePort(): number {
  for (let i = 0; i < 50; i += 1) {
    const candidate = 41000 + Math.floor(Math.random() * 18000);
    if (!portOpen(candidate)) return candidate;
  }
  throw new Error("no free port found for the sandbox panel");
}

/** Write the stub package manager that `pm_in panel <script>` lands on. */
function writePnpmStub(buildBody: string) {
  writeFileSync(
    join(stubBin, "pnpm"),
    [
      "#!/bin/sh",
      "# Stub pnpm: understands the `-C <dir> run <script>` spelling pm_in uses.",
      'dir="."',
      'if [ "$1" = "-C" ]; then dir="$2"; shift 2; fi',
      '# pm_in always spells an explicit `run`, so pnpm cannot shadow a package',
      '# script with a built-in subcommand of the same name.',
      'if [ "$1" = "run" ]; then shift; fi',
      'case "$1" in',
      "  start)",
      '    echo "stub pnpm start in $dir"',
      `    exec node "${serverJs}"`,
      "    ;;",
      "  build)",
      `    ${buildBody}`,
      "    ;;",
      "  *)",
      '    echo "stub pnpm: unexpected script $1" >&2',
      "    exit 1",
      "    ;;",
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
}

const BUILD_OK = [
  'echo "stub pnpm build in $dir"',
  'mkdir -p "$dir/dist"',
  `printf '<!doctype html>' > "$dir/dist/index.html"`,
].join("\n    ");

const BUILD_FAILS = ['echo "stub pnpm build: TS2345 the bundle is broken" >&2', "exit 1"].join(
  "\n    ",
);

function runPanel(command: string, extraEnv: Record<string, string> = {}, cwd?: string) {
  // The developer's own PANEL_TTS_SERVER_CTL, and the one in their real
  // ~/.panel/secrets.env, must never reach the sandbox: either would start or
  // stop the real local TTS server. The state dir is the sandbox's own.
  const { PANEL_TTS_SERVER_CTL: _ignored, ...inherited } = process.env;
  const res = spawnSync("bash", [join(repo, "scripts", "panel"), command], {
    cwd,
    encoding: "utf8",
    env: {
      ...inherited,
      PATH: `${stubBin}:${process.env.PATH ?? ""}`,
      PANEL_PORT: String(port),
      PANEL_AUTH_STATE_DIR: stateDir,
      ...extraEnv,
    },
    timeout: 60000,
  });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

function panelLog(): string {
  const path = join(repo, "panel", ".panel.log");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "panel-ctl-"));
  repo = join(sandbox, "repo");
  stubBin = join(sandbox, "bin");
  serverJs = join(sandbox, "server.cjs");
  stateDir = join(sandbox, "state");
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "panel"), { recursive: true });
  mkdirSync(stubBin, { recursive: true });
  copyFileSync(PANEL_CTL, join(repo, "scripts", "panel"));
  copyFileSync(PM_SCRIPT, join(repo, "scripts", "pm"));

  // The stand-in panel server: binds PANEL_PORT and stays up until killed.
  //
  // PANEL_STUB_BIND_PORT makes it bind somewhere else instead, which is what
  // the real panel used to do on its own: panel-server.ts auto-increments off a
  // busy port and prints `Panel bound to …` with the port that won. A stub that
  // always honoured PANEL_PORT validated scripts/panel against a server whose
  // behaviour the real one does not have — which is why the orphaned-panel bug
  // got all the way to a smoke run.
  writeFileSync(
    serverJs,
    [
      "const http = require('http');",
      "const port = Number(process.env.PANEL_STUB_BIND_PORT || process.env.PANEL_PORT);",
      "http",
      "  .createServer((req, res) => {",
      "    res.setHeader('content-type', 'application/json');",
      "    res.end('[]');",
      "  })",
      "  .listen(port, '127.0.0.1', () => {",
      "    console.log('stub panel listening on ' + port);",
      "    console.log('Panel bound to http://127.0.0.1:' + port + ' (loopback only)');",
      "  });",
      "",
    ].join("\n"),
  );

  port = pickFreePort();
  extraPorts = [];
  writePnpmStub(BUILD_OK);
});

afterEach(async () => {
  // Kill by port first, then sweep anything still naming the sandbox — an
  // assertion that threw mid-test must not leave a listener behind. Every port
  // the case could have landed on, not just the requested one: the whole point
  // of the drift case is that the panel ends up somewhere else.
  for (const p of [port, ...extraPorts]) {
    for (let i = 0; i < 5; i += 1) {
      const pid = listenerPid(p);
      if (!pid) break;
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  spawnSync("pkill", ["-9", "-f", sandbox]);
  for (const p of [port, ...extraPorts]) {
    expect(await waitUntil(() => !portOpen(p), 5000), `port ${p} still listening`).toBe(true);
  }
  extraPorts = [];
  rmSync(sandbox, { recursive: true, force: true });
});

describe("scripts/panel process control", () => {
  it("start detaches the server from the calling shell and logs to panel/.panel.log", async () => {
    const { status, output } = runPanel("start");

    expect(status).toBe(0);
    expect(output).toContain(`http://localhost:${port}`);

    expect(await waitUntil(() => portOpen(port))).toBe(true);
    const pid = listenerPid(port);
    expect(pid).toBeGreaterThan(0);

    // The shell that ran `panel start` has already exited — spawnSync waited for
    // it — so a server still alive here outlived its parent.
    expect(alive(pid)).toBe(true);
    // And it is in a session of its own: closing the terminal, or the script
    // that launched it finishing, cannot take the panel down with it. Only
    // where setsid exists — without it the script falls back to nohup alone.
    if (HAS_SETSID) {
      const childSid = sessionId(pid);
      expect(childSid).not.toBe("");
      expect(childSid).not.toBe(sessionId(process.pid));
    }

    expect(await waitUntil(() => panelLog().includes("stub panel listening"))).toBe(true);
    expect(panelLog()).toContain("stub pnpm start in panel");
  });

  it("start builds the bundle when dist is missing and aborts on a failed build", async () => {
    expect(existsSync(join(repo, "panel", "dist", "index.html"))).toBe(false);

    const built = runPanel("start");

    expect(built.status).toBe(0);
    expect(built.output).toContain("stub pnpm build in panel");
    expect(existsSync(join(repo, "panel", "dist", "index.html"))).toBe(true);
    expect(await waitUntil(() => portOpen(port))).toBe(true);

    // Now the other half: no bundle, and a build that fails.
    runPanel("stop");
    expect(await waitUntil(() => !portOpen(port), 15000)).toBe(true);
    rmSync(join(repo, "panel", "dist"), { recursive: true, force: true });
    writePnpmStub(BUILD_FAILS);

    const failed = runPanel("start");

    expect(failed.status).toBe(1);
    expect(failed.output).toContain("the bundle is broken");
    expect(portOpen(port)).toBe(false);
  });

  it("start reports an already-running panel with its pid and exits 0", async () => {
    expect(runPanel("start").status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    const pid = listenerPid(port);

    const second = runPanel("start");

    expect(second.status).toBe(0);
    expect(second.output).toContain("already running (pid");
    expect(second.output).toContain(String(pid));
    expect(second.output).toContain(`http://localhost:${port}`);
    // The first server is still the one on the port: nothing was restarted.
    expect(listenerPid(port)).toBe(pid);
  });

  it("stop frees the port and is a no-op when nothing runs", async () => {
    expect(runPanel("start").status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    const pid = listenerPid(port);

    const stopped = runPanel("stop");

    expect(stopped.status).toBe(0);
    expect(await waitUntil(() => !portOpen(port), 15000)).toBe(true);
    expect(alive(pid)).toBe(false);

    const again = runPanel("stop");

    expect(again.status).toBe(0);
    expect(again.output).toMatch(/not running|nothing to stop/i);
  });

  it("status distinguishes running from stopped with exit codes 0 and 3", async () => {
    const stopped = runPanel("status");

    expect(stopped.status).toBe(3);
    expect(stopped.output).toMatch(/^stopped\b/m);

    expect(runPanel("start").status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    const pid = listenerPid(port);

    const running = runPanel("status");

    expect(running.status).toBe(0);
    expect(running.output).toContain(`running pid=${pid}`);
    expect(running.output).toContain(`port=${port}`);
    expect(running.output).toContain(`url=http://localhost:${port}`);
    expect(running.output).toContain("log=panel/.panel.log");
  });

  it("start names the port the panel really bound instead of claiming it never started", async () => {
    // Observed twice in a smoke run against a machine with 3010 already taken:
    // the panel came up on 3011, `scripts/panel start` waited out 30s on 3010,
    // printed "Panel did not come up on port 3010" and exited 1 — leaving the
    // panel it had just started running where `scripts/panel stop` (which looks
    // at $PANEL_PORT) could never find it.
    const landed = pickFreePort();
    expect(landed).not.toBe(port);
    extraPorts.push(landed);

    const { status, output } = runPanel("start", { PANEL_STUB_BIND_PORT: String(landed) });

    // The panel is up — somewhere else.
    expect(await waitUntil(() => portOpen(landed))).toBe(true);
    expect(portOpen(port)).toBe(false);

    // It must not be reported as a failure to start…
    expect(output).not.toMatch(/did not come up/i);
    // …nor as a bare success on the port that was asked for.
    expect(output).toContain(String(landed));
    expect(status).toBe(0);

    // And the process must not be left unmanaged: the report has to hand over
    // the command that actually reaches it.
    expect(output).toMatch(new RegExp(`PANEL_PORT=${landed}`));

    // Not just prose — that command really does manage it.
    const stopped = runPanel("stop", { PANEL_PORT: String(landed) });
    expect(stopped.status).toBe(0);
    expect(await waitUntil(() => !portOpen(landed), 15000)).toBe(true);
  });

  it("start still fails when the panel came up nowhere at all", async () => {
    // The other half: reading the log must not turn a dead panel into a
    // success. A server that exits immediately leaves no `Panel bound to` line.
    writeFileSync(
      join(stubBin, "pnpm"),
      [
        "#!/bin/sh",
        'dir="."',
        'if [ "$1" = "-C" ]; then dir="$2"; shift 2; fi',
        'if [ "$1" = "run" ]; then shift; fi',
        'case "$1" in',
        "  start) echo 'stub panel died on boot' >&2; exit 1 ;;",
        "  build)",
        `    ${BUILD_OK}`,
        "    ;;",
        "esac",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const { status, output } = runPanel("start");

    expect(status).toBe(1);
    expect(output).toMatch(/did not come up/i);
    expect(output).toContain("stub panel died on boot");
    expect(portOpen(port)).toBe(false);
  });

  it("root package.json start/stop/reboot/status delegate to scripts/panel", () => {
    const pkg = JSON.parse(readFileSync(ROOT_PACKAGE_JSON, "utf8")) as {
      scripts: Record<string, string>;
    };

    // Package-script name → scripts/panel subcommand. They match everywhere but
    // `reboot`: `pnpm restart` is npm's lifecycle spelling (it would run stop,
    // restart AND start), so the package script had to be named something pnpm
    // does not claim. scripts/panel's own subcommand is still `restart`.
    const delegates: Record<string, string> = {
      start: "start",
      stop: "stop",
      reboot: "restart",
      status: "status",
    };

    for (const [script, subcommand] of Object.entries(delegates)) {
      expect(pkg.scripts[script], `scripts.${script}`).toContain("scripts/panel");
      expect(pkg.scripts[script], `scripts.${script}`).toContain(subcommand);
    }
    // And the shadowed name is gone from package.json entirely.
    expect(pkg.scripts.restart, "scripts.restart must not exist").toBeUndefined();
    // The old spellings backgrounded pnpm with `&` and killed port 3010 by hand;
    // both are the script's job now.
    expect(pkg.scripts.start).not.toContain("&");
    expect(pkg.scripts.stop).not.toContain("lsof");
  });
});

/**
 * PANEL_TTS_SERVER_CTL: a control script for a local TTS server (omnivoicectl)
 * that scripts/panel starts before the panel and stops after it.
 *
 * The fake control script records its argument *and* whether the panel port
 * was open at that moment — so "before the panel comes up" and "after it goes
 * down" are asserted as observed state, not inferred from line order.
 */
describe("scripts/panel local TTS server control", () => {
  let ctl: string;
  let ctlLog: string;

  function writeCtl(path: string, exitCode = 0, mode = 0o755) {
    writeFileSync(
      path,
      [
        "#!/usr/bin/env bash",
        `if (exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null; then state=up; else state=down; fi`,
        `echo "$1 panel=$state" >> "${ctlLog}"`,
        `exit ${exitCode}`,
        "",
      ].join("\n"),
      { mode },
    );
  }

  function ctlCalls(): string[] {
    return existsSync(ctlLog) ? readFileSync(ctlLog, "utf8").split("\n").filter(Boolean) : [];
  }

  beforeEach(() => {
    ctl = join(sandbox, "fake-ttsctl");
    ctlLog = join(sandbox, "ttsctl.log");
  });

  it("panel start and stop drive PANEL_TTS_SERVER_CTL", async () => {
    writeCtl(ctl);
    const env = { PANEL_TTS_SERVER_CTL: ctl };

    const started = runPanel("start", env);
    expect(started.status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    // Called once, while the port was still closed: before the panel came up.
    expect(ctlCalls()).toEqual(["start panel=down"]);

    const stopped = runPanel("stop", env);
    expect(stopped.status).toBe(0);
    expect(portOpen(port)).toBe(false);
    // Called after the panel went down, not while it was still serving.
    expect(ctlCalls()).toEqual(["start panel=down", "stop panel=down"]);

    // restart goes through stop and start: the server is stopped after the
    // panel is down and started again before the panel comes back.
    expect(runPanel("start", env).status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    const restarted = runPanel("restart", env);
    expect(restarted.status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    expect(ctlCalls().slice(-3)).toEqual([
      "start panel=down",
      "stop panel=down",
      "start panel=down",
    ]);

    // Stop with no panel running still stops the server: it may have outlived
    // a panel that was killed some other way.
    runPanel("stop", env);
    const idle = runPanel("stop", env);
    expect(idle.status).toBe(0);
    expect(idle.output).toMatch(/not running/);
    expect(ctlCalls().slice(-2)).toEqual(["stop panel=down", "stop panel=down"]);
  });

  it("reads PANEL_TTS_SERVER_CTL from the secrets file without sourcing it", async () => {
    writeCtl(ctl);
    const sourcedMarker = join(sandbox, "secrets-were-sourced");
    writeFileSync(
      join(stateDir, "secrets.env"),
      [
        "EDGE_TTS_UNUSED=1",
        `touch "${sourcedMarker}"`,
        // Repeated: the last line wins. Quotes around the value are stripped.
        `PANEL_TTS_SERVER_CTL=${join(sandbox, "an-older-ctl-that-does-not-exist")}`,
        `PANEL_TTS_SERVER_CTL="${ctl}"\r`,
        "",
      ].join("\n"),
    );

    const started = runPanel("start");
    expect(started.status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    expect(runPanel("stop").status).toBe(0);

    expect(ctlCalls()).toEqual(["start panel=down", "stop panel=down"]);
    expect(started.output).not.toMatch(/warning/i);
    expect(existsSync(sourcedMarker)).toBe(false);
  });

  it("resolves a relative PANEL_AUTH_STATE_DIR against panel/, as the server does", async () => {
    writeCtl(ctl);
    const relState = join(repo, "panel", "rel-state");
    mkdirSync(relState, { recursive: true });
    writeFileSync(join(relState, "secrets.env"), `PANEL_TTS_SERVER_CTL=${ctl}\n`);
    // Run from elsewhere: `pnpm start` runs the script from the repo root, not panel/.
    const env = { PANEL_AUTH_STATE_DIR: "rel-state" };

    expect(runPanel("start", env, sandbox).status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    expect(runPanel("stop", env, sandbox).status).toBe(0);

    expect(ctlCalls()).toEqual(["start panel=down", "stop panel=down"]);
  });

  it("a failing TTS control script does not fail the panel", async () => {
    writeCtl(ctl, 1);

    const started = runPanel("start", { PANEL_TTS_SERVER_CTL: ctl });

    expect(started.status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    expect(started.output).toContain("panel started");
    const warnings = started.output.split("\n").filter((line) => line.includes(ctl));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/warning/i);
    expect(warnings[0]).toMatch(/\bstart\b/);
    expect(warnings[0]).toMatch(/exit(ed)?( with)?( code)? 1\b/);
  });

  /** A control script that never returns, and records its pid so a case can check it was reaped. */
  function writeHangingCtl(pidFile: string) {
    writeFileSync(
      ctl,
      ["#!/usr/bin/env bash", `echo $$ > "${pidFile}"`, "while :; do sleep 1; done", ""].join("\n"),
      { mode: 0o755 },
    );
  }

  /**
   * A PATH with every tool the developer's PATH offers *except* `timeout`: one
   * directory of symlinks, first name wins, as `command -v` would resolve it.
   * The pnpm stub still goes first, exactly as runPanel arranges it.
   */
  function pathWithoutTimeout(): string {
    const bin = join(sandbox, "bin-no-timeout");
    mkdirSync(bin, { recursive: true });
    const seen = new Set<string>(["timeout"]);
    for (const dir of (process.env.PATH ?? "").split(":")) {
      if (!dir || dir === stubBin) continue;
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (seen.has(name)) continue;
        seen.add(name);
        symlinkSync(join(dir, name), join(bin, name));
      }
    }
    return `${stubBin}:${bin}`;
  }

  it("a hanging TTS control script is cut off without timeout", async () => {
    const pidFile = join(sandbox, "ctl.pid");
    writeHangingCtl(pidFile);
    const PATH = pathWithoutTimeout();
    // The arranged PATH really has no `timeout` on it.
    const probe = spawnSync("bash", ["-c", "command -v timeout || echo none"], {
      encoding: "utf8",
      env: { ...process.env, PATH },
    });
    expect(probe.stdout.trim()).toBe("none");

    const t0 = Date.now();
    const started = runPanel("start", {
      PANEL_TTS_SERVER_CTL: ctl,
      PANEL_TTS_SERVER_CTL_TIMEOUT: "2",
      PATH,
    });
    const elapsed = Date.now() - t0;

    expect(started.status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    expect(started.output).toContain("panel started");
    const warnings = started.output.split("\n").filter((line) => line.includes(ctl));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/warning/i);
    expect(warnings[0]).toMatch(/timed out after 2s/);
    // Two seconds of patience, a short kill grace and the panel's own start.
    expect(elapsed).toBeLessThan(20000);
    // The control script itself was killed, not left running in the background.
    const ctlPid = Number(readFileSync(pidFile, "utf8").trim());
    expect(await waitUntil(() => !alive(ctlPid), 5000)).toBe(true);
  });

  // Only meaningful where coreutils `timeout` exists; the no-timeout fallback
  // is covered by "a hanging TTS control script is cut off without timeout".
  it.skipIf(!HAS_TIMEOUT)("the coreutils timeout path honours PANEL_TTS_SERVER_CTL_TIMEOUT", async () => {
    const pidFile = join(sandbox, "ctl.pid");
    writeHangingCtl(pidFile);

    const t0 = Date.now();
    const started = runPanel("start", {
      PANEL_TTS_SERVER_CTL: ctl,
      PANEL_TTS_SERVER_CTL_TIMEOUT: "2",
    });
    const elapsed = Date.now() - t0;

    expect(started.status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    const warnings = started.output.split("\n").filter((line) => line.includes(ctl));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/timed out after 2s/);
    expect(elapsed).toBeLessThan(20000);
    const ctlPid = Number(readFileSync(pidFile, "utf8").trim());
    expect(await waitUntil(() => !alive(ctlPid), 5000)).toBe(true);
  });

  it("a non-executable TTS control script is skipped with a warning", async () => {
    writeCtl(ctl, 0, 0o644);

    const started = runPanel("start", { PANEL_TTS_SERVER_CTL: ctl });

    expect(started.status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    expect(started.output).toMatch(new RegExp(`warning.*${ctl}.*not executable`, "i"));
    expect(ctlCalls()).toEqual([]);

    // A missing file is the same: a warning, and the verb still does its job.
    const missing = join(sandbox, "no-such-ctl");
    const stopped = runPanel("stop", { PANEL_TTS_SERVER_CTL: missing });
    expect(stopped.status).toBe(0);
    expect(portOpen(port)).toBe(false);
    expect(stopped.output).toContain("panel stopped");
    expect(stopped.output).toMatch(new RegExp(`warning.*${missing}`, "i"));
  });

  it("no TTS control script leaves panel verbs unchanged", async () => {
    // Unset in the environment (runPanel strips it), and a secrets file that
    // holds other keys but not this one.
    writeFileSync(join(stateDir, "secrets.env"), "ELEVENLABS_API_KEY=sk-test\n");
    // A bundle already in place, so the output is the start/stop lines alone.
    mkdirSync(join(repo, "panel", "dist"), { recursive: true });
    writeFileSync(join(repo, "panel", "dist", "index.html"), "<!doctype html>");
    const quiet = (output: string) => {
      expect(output).not.toMatch(/warning|TTS|PANEL_TTS_SERVER_CTL/i);
    };

    const started = runPanel("start");
    expect(started.status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    expect(started.output).toMatch(/^Starting panel\.* ready\.\npanel started \(pid \d+\)/);
    quiet(started.output);

    const restarted = runPanel("restart");
    expect(restarted.status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    expect(restarted.output).toMatch(/^panel stopped \(was pid \d+\)\nStarting panel/);
    quiet(restarted.output);

    const stopped = runPanel("stop");
    expect(stopped.status).toBe(0);
    expect(stopped.output).toMatch(/^panel stopped \(was pid \d+\)\n$/);
    quiet(stopped.output);

    const idle = runPanel("stop");
    expect(idle.output).toBe(`panel not running (nothing to stop on port ${port})\n`);
  });

  /** A control script that logs `<name> <verb>` to the shared ctl log, so order across scripts shows. */
  function writeNamedCtl(name: string, exitCode = 0): string {
    const path = join(sandbox, name);
    writeFileSync(
      path,
      ["#!/usr/bin/env bash", `echo "${name} $1" >> "${ctlLog}"`, `exit ${exitCode}`, ""].join(
        "\n",
      ),
      { mode: 0o755 },
    );
    return path;
  }

  it("panel start runs every listed control script in order and stop runs them in reverse", async () => {
    const a = writeNamedCtl("ctl-a");
    const b = writeNamedCtl("ctl-b");
    const env = { PANEL_TTS_SERVER_CTL: `${a}:${b}` };

    const started = runPanel("start", env);
    expect(started.status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    expect(started.output).not.toMatch(/warning/i);
    expect(ctlCalls()).toEqual(["ctl-a start", "ctl-b start"]);

    const stopped = runPanel("stop", env);
    expect(stopped.status).toBe(0);
    expect(portOpen(port)).toBe(false);
    expect(ctlCalls()).toEqual(["ctl-a start", "ctl-b start", "ctl-b stop", "ctl-a stop"]);
    // Each script gets its own log marker.
    expect(panelLog()).toContain(`tts server start ${a}`);
    expect(panelLog()).toContain(`tts server stop ${b}`);
  });

  it("a missing entry warns and the other entries still run", async () => {
    const a = writeNamedCtl("ctl-a");
    const b = writeNamedCtl("ctl-b");
    const missing = join(sandbox, "no-such-ctl");
    const notExec = join(sandbox, "not-exec-ctl");
    writeFileSync(notExec, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o644 });
    const env = { PANEL_TTS_SERVER_CTL: `${a}:${missing}:${notExec}:${b}` };

    const started = runPanel("start", env);
    expect(started.status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    expect(started.output).toContain("panel started");
    const missingStart = started.output.split("\n").filter((l) => l.includes(missing));
    expect(missingStart).toHaveLength(1);
    expect(missingStart[0]).toMatch(/warning.*does not exist/i);
    const notExecStart = started.output.split("\n").filter((l) => l.includes(notExec));
    expect(notExecStart).toHaveLength(1);
    expect(notExecStart[0]).toMatch(/warning.*not executable/i);
    expect(ctlCalls()).toEqual(["ctl-a start", "ctl-b start"]);

    const stopped = runPanel("stop", env);
    expect(stopped.status).toBe(0);
    const missingStop = stopped.output.split("\n").filter((l) => l.includes(missing));
    expect(missingStop).toHaveLength(1);
    expect(missingStop[0]).toMatch(/warning/i);
    expect(ctlCalls().slice(-2)).toEqual(["ctl-b stop", "ctl-a stop"]);
  });

  it("a failing entry warns and the next entry still starts", async () => {
    const bad = writeNamedCtl("ctl-bad", 3);
    const ok = writeNamedCtl("ctl-ok");
    const hang1 = join(sandbox, "ctl-hang1");
    const hang2 = join(sandbox, "ctl-hang2");
    for (const h of [hang1, hang2]) {
      writeFileSync(
        h,
        ["#!/usr/bin/env bash", `echo $$ > "${h}.pid"`, "while :; do sleep 1; done", ""].join("\n"),
        { mode: 0o755 },
      );
    }

    const t0 = Date.now();
    const started = runPanel("start", {
      PANEL_TTS_SERVER_CTL: `${bad}:${hang1}:${hang2}:${ok}`,
      PANEL_TTS_SERVER_CTL_TIMEOUT: "1",
    });
    const elapsed = Date.now() - t0;

    expect(started.status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    expect(started.output).toContain("panel started");
    const badWarn = started.output.split("\n").filter((l) => l.includes(bad));
    expect(badWarn).toHaveLength(1);
    expect(badWarn[0]).toMatch(/warning.*\bstart\b.*exited 3\b/i);
    // Each hang is cut at the limit on its own: neither shares the other's budget.
    for (const h of [hang1, hang2]) {
      const w = started.output.split("\n").filter((l) => l.includes(h));
      expect(w).toHaveLength(1);
      expect(w[0]).toMatch(/timed out after 1s/);
      const pid = Number(readFileSync(`${h}.pid`, "utf8").trim());
      expect(await waitUntil(() => !alive(pid), 5000)).toBe(true);
    }
    expect(elapsed).toBeGreaterThanOrEqual(2000);
    expect(ctlCalls()).toEqual(["ctl-bad start", "ctl-ok start"]);
  });

  it("empty and duplicate entries are ignored", async () => {
    const a = writeNamedCtl("ctl-a");
    const b = writeNamedCtl("ctl-b");
    const env = { PANEL_TTS_SERVER_CTL: `:${a}::${b}:${a}:` };

    const started = runPanel("start", env);
    expect(started.status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    expect(started.output).not.toMatch(/warning/i);
    expect(runPanel("stop", env).status).toBe(0);

    expect(ctlCalls()).toEqual(["ctl-a start", "ctl-b start", "ctl-b stop", "ctl-a stop"]);
  });

  it("reads a ':'-separated list from the secrets file", async () => {
    const a = writeNamedCtl("ctl-a");
    const b = writeNamedCtl("ctl-b");
    const sourcedMarker = join(sandbox, "secrets-were-sourced");
    writeFileSync(
      join(stateDir, "secrets.env"),
      [`touch "${sourcedMarker}"`, `PANEL_TTS_SERVER_CTL='${a}:${b}'\r`, ""].join("\n"),
    );

    const started = runPanel("start");
    expect(started.status).toBe(0);
    expect(await waitUntil(() => portOpen(port))).toBe(true);
    expect(started.output).not.toMatch(/warning/i);
    expect(runPanel("stop").status).toBe(0);

    expect(ctlCalls()).toEqual(["ctl-a start", "ctl-b start", "ctl-b stop", "ctl-a stop"]);
    expect(existsSync(sourcedMarker)).toBe(false);
  });
});
