/**
 * The generated `pocketctl` run for real (spawnSync of the script with stub servers), so it
 * lives in the node-slow project; install-pocket.test.ts drives the installer with fakes.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POCKET_PL_CONFIG, POCKET_PL_REVISION, main } from "../install-pocket.mjs";

let root: string;
let home: string;
let installDir: string;
let ctlPath: string;
let workspace: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "install-pocket-rt-")));
  home = join(root, "home");
  installDir = join(root, "pocket-tts");
  ctlPath = join(installDir, "pocketctl");
  workspace = join(root, "workspace");
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Installs with every side effect faked, which leaves pocketctl and pocket.conf on disk. */
function installFakes() {
  let running = false;
  return {
    env: { HOME: home, PAVILIO_POCKET_DIR: installDir, PANEL_AUTH_STATE_DIR: join(root, "state") } as Record<string, string>,
    platform: "linux",
    which: () => true,
    run: (_cmd: string, args: string[]) => {
      if (args[0] === "venv") mkdirSync(args.at(-1) as string, { recursive: true });
      return { status: 0 };
    },
    ctl: (_path: string, verb: string) => {
      if (verb === "status") return { status: running ? 0 : 3 };
      running = verb === "start";
      return { status: 0 };
    },
    fetch: async () => ({ ok: running }),
    now: (() => {
      let t = 0;
      return () => t;
    })(),
    sleep: async () => {},
    log: () => {},
    error: () => {},
  };
}

const both = () => ({ servers: ["pocket", "pocket-pl"], workspaceRoot: workspace });

describe.skipIf(process.platform === "win32")("generated pocketctl at runtime", () => {
  it("start fails when a server exits at once", async () => {
    await main({ servers: ["pocket"], workspaceRoot: workspace }, installFakes());
    mkdirSync(join(installDir, "venv", "bin"), { recursive: true });
    writeFileSync(join(installDir, "venv", "bin", "pocket-tts"), "#!/bin/bash\nexit 1\n", { mode: 0o755 });
    writeFileSync(join(installDir, "venv", "bin", "python"), "#!/bin/bash\nexec sleep 60\n", { mode: 0o755 });
    try {
      const res = spawnSync(ctlPath, ["start"], { env: { ...process.env, HOME: home }, encoding: "utf8" });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("pocket exited at once");
      expect(existsSync(join(installDir, "pocket.pid"))).toBe(false);
    } finally {
      spawnSync(ctlPath, ["stop"], { env: { ...process.env, HOME: home } });
    }
  });

  const ctlEnv = () => ({ ...process.env, HOME: home });
  const runCtl = (verb: string) => spawnSync(ctlPath, [verb], { env: ctlEnv(), encoding: "utf8" });

  afterEach(() => {
    // Nothing may outlive the test, even when an assertion failed before `stop`.
    try {
      runCtl("stop");
    } catch {
      // The install dir may not exist if the test failed early.
    }
    for (const name of ["pocket", "pocket-pl", "voices"]) {
      try {
        const pid = Number(readFileSync(join(installDir, `${name}.pid`), "utf8").split("\n")[0]);
        if (pid > 1) process.kill(-pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  });

  it("start launches the three servers with the right args and token; stop kills them", async () => {
    mkdirSync(join(home, ".cache", "huggingface"), { recursive: true });
    writeFileSync(join(home, ".cache", "huggingface", "token"), "hf_secret\n");
    await main(both(), installFakes());
    const argvLog = join(root, "argv.log");
    const stub = `#!/bin/bash\necho "$(basename "$0") $* HF_TOKEN=\${HF_TOKEN:-}" >>${JSON.stringify(argvLog)}\nexec sleep 60\n`;
    mkdirSync(join(installDir, "venv", "bin"), { recursive: true });
    for (const name of ["pocket-tts", "python"]) {
      writeFileSync(join(installDir, "venv", "bin", name), stub, { mode: 0o755 });
    }

    expect(runCtl("start").status).toBe(0);
    for (let i = 0; i < 50 && !(existsSync(argvLog) && readFileSync(argvLog, "utf8").split("\n").length > 3); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }

    const lines = readFileSync(argvLog, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines).toContain("pocket-tts serve --host 127.0.0.1 --port 8895 HF_TOKEN=hf_secret");
    expect(lines).toContain(
      `pocket-tts serve --host 127.0.0.1 --port 8896 --config ${POCKET_PL_CONFIG} --default-voice hf://shefowl/pocket-tts-polish-6l/reference.wav@${POCKET_PL_REVISION} HF_TOKEN=`,
    );
    expect(lines).toContain(
      `python -m http.server 8897 --bind 127.0.0.1 -d ${join(workspace, ".pavilio", "voices")} HF_TOKEN=`,
    );
    expect(runCtl("status").status).toBe(0);
    // One server down is a partial install, not a running one.
    const pidOf = (n: string) => Number(readFileSync(join(installDir, `${n}.pid`), "utf8").split("\n")[0]);
    const plPid = pidOf("pocket-pl");
    const [pocketBefore, voicesBefore] = [pidOf("pocket"), pidOf("voices")];
    process.kill(-plPid, "SIGKILL");
    await new Promise((r) => setTimeout(r, 200));
    expect(runCtl("status").status).toBe(4);
    expect(runCtl("start").status).toBe(0);
    expect(runCtl("status").status).toBe(0);
    // The healthy servers were left alone; only the missing one got a new process.
    expect(pidOf("pocket")).toBe(pocketBefore);
    expect(pidOf("voices")).toBe(voicesBefore);
    expect(pidOf("pocket-pl")).not.toBe(plPid);
    const pids = ["pocket", "pocket-pl", "voices"].map((n) => Number(readFileSync(join(installDir, `${n}.pid`), "utf8").split("\n")[0]));

    expect(runCtl("stop").status).toBe(0);

    expect(runCtl("status").status).toBe(3);
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
  });

  const stubServers = (body: string) => {
    mkdirSync(join(installDir, "venv", "bin"), { recursive: true });
    for (const name of ["pocket-tts", "python"]) {
      writeFileSync(join(installDir, "venv", "bin", name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    }
  };
  const pidOf = (n: string) => Number(readFileSync(join(installDir, `${n}.pid`), "utf8").split("\n")[0]);

  it("stop escalates to KILL for a server that ignores TERM, and exits 0 once it is gone", async () => {
    await main({ servers: ["pocket"], workspaceRoot: workspace }, installFakes());
    stubServers("trap '' TERM\nwhile :; do sleep 1; done");
    expect(runCtl("start").status).toBe(0);
    const pids = [pidOf("pocket"), pidOf("voices")];

    const res = spawnSync(ctlPath, ["stop"], { env: { ...ctlEnv(), POCKETCTL_TERM_STEPS: "2" }, encoding: "utf8" });

    expect(res.status).toBe(0);
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    expect(existsSync(join(installDir, "pocket.pid"))).toBe(false);
  });

  it("stop exits non-zero and keeps the pidfile when a process survives; restart then does not start", async () => {
    await main({ servers: ["pocket"], workspaceRoot: workspace }, installFakes());
    stubServers("exec sleep 60");
    expect(runCtl("start").status).toBe(0);
    const pid = pidOf("pocket");
    // A no-op killer stands in for a process that survives KILL.
    const env = { ...ctlEnv(), POCKETCTL_KILL: "true", POCKETCTL_TERM_STEPS: "1" };

    const res = spawnSync(ctlPath, ["stop"], { env, encoding: "utf8" });

    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain(`pocket (pid ${pid}) did not exit`);
    expect(existsSync(join(installDir, "pocket.pid"))).toBe(true);
    expect(() => process.kill(pid, 0)).not.toThrow();
    const restart = spawnSync(ctlPath, ["restart"], { env, encoding: "utf8" });
    expect(restart.status).not.toBe(0);
    expect(restart.stdout).not.toContain("started");
    expect(pidOf("pocket")).toBe(pid);
  });
});
