import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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

let sandbox: string;
let repo: string;
let stubBin: string;
let serverJs: string;
let port: number;

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

function runPanel(command: string) {
  const res = spawnSync("bash", [join(repo, "scripts", "panel"), command], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubBin}:${process.env.PATH ?? ""}`,
      PANEL_PORT: String(port),
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
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "panel"), { recursive: true });
  mkdirSync(stubBin, { recursive: true });
  copyFileSync(PANEL_CTL, join(repo, "scripts", "panel"));
  copyFileSync(PM_SCRIPT, join(repo, "scripts", "pm"));

  // The stand-in panel server: binds PANEL_PORT and stays up until killed.
  writeFileSync(
    serverJs,
    [
      "const http = require('http');",
      "const port = Number(process.env.PANEL_PORT);",
      "http",
      "  .createServer((req, res) => {",
      "    res.setHeader('content-type', 'application/json');",
      "    res.end('[]');",
      "  })",
      "  .listen(port, '127.0.0.1', () => console.log('stub panel listening on ' + port));",
      "",
    ].join("\n"),
  );

  port = pickFreePort();
  writePnpmStub(BUILD_OK);
});

afterEach(async () => {
  // Kill by port first, then sweep anything still naming the sandbox — an
  // assertion that threw mid-test must not leave a listener behind.
  for (let i = 0; i < 5; i += 1) {
    const pid = listenerPid(port);
    if (!pid) break;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  spawnSync("pkill", ["-9", "-f", sandbox]);
  await waitUntil(() => !portOpen(port), 5000);
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
    // that launched it finishing, cannot take the panel down with it.
    const childSid = sessionId(pid);
    expect(childSid).not.toBe("");
    expect(childSid).not.toBe(sessionId(process.pid));

    expect(await waitUntil(() => panelLog().includes("stub panel listening"))).toBe(true);
    expect(panelLog()).toContain("stub pnpm start in panel");
  }, 60000);

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
  }, 90000);

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
  }, 60000);

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
  }, 60000);

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
  }, 60000);

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
