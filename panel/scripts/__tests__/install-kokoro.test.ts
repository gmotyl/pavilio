import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  KOKORO_FASTAPI_REF,
  kokoroctlScript,
  main,
} from "../install-kokoro.mjs";

const ADDRESS = "http://127.0.0.1:8880";
const FOREIGN_CTL = "/opt/omnivoice/omnivoicectl";

let root: string;
let installDir: string;
let stateDir: string;
let secretsFile: string;
let ctlPath: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "install-kokoro-")));
  installDir = join(root, "kokoro-fastapi");
  stateDir = join(root, "panel-state");
  secretsFile = join(stateDir, "secrets.env");
  ctlPath = join(installDir, "kokoroctl");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeSecrets(text: string) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(secretsFile, text);
}

function backups(): string[] {
  if (!existsSync(stateDir)) return [];
  return readdirSync(stateDir).filter((name) => name !== "secrets.env");
}

/** Every file under the sandbox with its bytes and mtime, to prove nothing changed. */
function snapshot(dir = root): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) Object.assign(out, snapshot(path));
    else out[path] = `${statSync(path).mtimeMs}:${readFileSync(path, "utf8")}`;
  }
  return out;
}

/**
 * Fakes for every side effect the installer reaches outside its own files:
 * git (a clone is a directory with a recorded ref), the kokoroctl runner, fetch,
 * and a virtual clock that `sleep` advances.
 */
function fakes(overrides: Record<string, unknown> = {}) {
  const calls = { git: [] as string[], ctl: [] as string[], fetch: [] as string[] };
  const server = { running: false };
  const clock = { now: 0 };
  const output: string[] = [];
  const git = (args: string[]) => {
    calls.git.push(args.join(" "));
    let cwd = "";
    let rest = args;
    if (args[0] === "-C") {
      cwd = args[1];
      rest = args.slice(2);
    }
    if (rest[0] === "clone") {
      const target = rest.at(-1) as string;
      const ref = rest[rest.indexOf("--branch") + 1];
      mkdirSync(join(target, ".git"), { recursive: true });
      writeFileSync(join(target, ".git", "FAKE_REF"), ref);
      return { status: 0, stdout: "" };
    }
    if (rest[0] === "describe") {
      return { status: 0, stdout: `${readFileSync(join(cwd, ".git", "FAKE_REF"), "utf8")}\n` };
    }
    if (rest[0] === "checkout") {
      writeFileSync(join(cwd, ".git", "FAKE_REF"), rest.at(-1) as string);
      return { status: 0, stdout: "" };
    }
    return { status: 0, stdout: "" };
  };
  const deps = {
    env: { PAVILIO_KOKORO_DIR: installDir, PANEL_AUTH_STATE_DIR: stateDir } as Record<
      string,
      string
    >,
    platform: "darwin",
    which: () => true,
    git,
    ctl: (path: string, verb: string) => {
      expect(path).toBe(ctlPath);
      calls.ctl.push(verb);
      // kokoroctl status exits 3 when stopped.
      if (verb === "status") return { status: server.running ? 0 : 3 };
      return { status: 0 };
    },
    fetch: async (url: string) => {
      calls.fetch.push(url);
      return { ok: true };
    },
    now: () => clock.now,
    sleep: async (ms: number) => {
      clock.now += ms;
    },
    log: (line: string) => output.push(line),
    error: (line: string) => output.push(line),
    ...overrides,
  };
  return { deps, calls, clock, server, output: () => output.join("\n") };
}

describe("install:kokoro", () => {
  it("fresh install clones the pinned ref, writes kokoroctl and both secrets lines", async () => {
    writeSecrets("ELEVENLABS_API_KEY=abc\n");
    const { deps, calls } = fakes();

    expect(await main([], deps)).toBe(0);

    expect(calls.git.some((c) => c.startsWith("clone") && c.includes(`--branch ${KOKORO_FASTAPI_REF}`))).toBe(true);
    expect(calls.git.join("\n")).toContain("https://github.com/remsky/Kokoro-FastAPI.git");
    expect(KOKORO_FASTAPI_REF).toBe("v0.9.2");
    expect(statSync(ctlPath).mode & 0o111).not.toBe(0);
    expect(readFileSync(ctlPath, "utf8")).toBe(kokoroctlScript({ platform: "darwin" }));

    const secrets = readFileSync(secretsFile, "utf8");
    expect(secrets).toContain("ELEVENLABS_API_KEY=abc\n");
    expect(secrets).toContain(`KOKORO_TTS_BASE_URL=${ADDRESS}\n`);
    expect(secrets).toContain(`PANEL_TTS_SERVER_CTL=${ctlPath}\n`);
    const [backup] = backups();
    expect(backup).toBeDefined();
    expect(readFileSync(join(stateDir, backup), "utf8")).toBe("ELEVENLABS_API_KEY=abc\n");

    expect(calls.fetch).toContain(`${ADDRESS}/v1/audio/voices`);
    expect(calls.ctl).toEqual(["status", "start", "stop"]);
  });

  it("resolves a relative PANEL_AUTH_STATE_DIR against the panel dir, like the server", async () => {
    const panelDir = join(root, "panel");
    const { deps } = fakes({ panelDir });
    deps.env.PANEL_AUTH_STATE_DIR = "rel-state";

    expect(await main([], deps)).toBe(0);

    const secrets = readFileSync(join(panelDir, "rel-state", "secrets.env"), "utf8");
    expect(secrets).toContain(`KOKORO_TTS_BASE_URL=${ADDRESS}\n`);
    expect(existsSync(join(process.cwd(), "rel-state"))).toBe(false);
  });

  it("missing prerequisite prints the install command and writes nothing", async () => {
    for (const [platform, hint] of [
      ["darwin", "brew install uv"],
      ["linux", "curl -LsSf https://astral.sh/uv/install.sh | sh"],
    ]) {
      const { deps, calls, output } = fakes({ platform, which: (cmd: string) => cmd !== "uv" });

      expect(await main([], deps)).not.toBe(0);

      expect(output()).toContain(hint);
      expect(existsSync(installDir)).toBe(false);
      expect(existsSync(stateDir)).toBe(false);
      expect(calls.git).toEqual([]);
      expect(calls.ctl).toEqual([]);
    }
  });

  it("appends kokoroctl to a foreign PANEL_TTS_SERVER_CTL", async () => {
    writeSecrets(`PANEL_TTS_SERVER_CTL=${FOREIGN_CTL}\n`);
    const { deps, calls } = fakes();

    expect(await main([], deps)).toBe(0);

    const secrets = readFileSync(secretsFile, "utf8");
    expect(secrets).toContain(`PANEL_TTS_SERVER_CTL=${FOREIGN_CTL}:${ctlPath}\n`);
    expect(secrets.match(/PANEL_TTS_SERVER_CTL=/g)).toHaveLength(1);
    expect(calls.ctl).toEqual(["status", "start", "stop"]);
  });

  it("leaves the list alone when kokoroctl is already in it", async () => {
    expect(await main([], fakes().deps)).toBe(0);
    writeSecrets(`KOKORO_TTS_BASE_URL=${ADDRESS}\nPANEL_TTS_SERVER_CTL=${ctlPath}:${FOREIGN_CTL}\n`);
    const before = snapshot();

    const again = fakes();
    expect(await main([], again.deps)).toBe(0);

    expect(snapshot()).toEqual(before);
    expect(backups()).toEqual([]);
  });

  it("warns when the environment value without kokoroctl overrides the file", async () => {
    writeSecrets("");
    const { deps, output } = fakes();
    deps.env.PANEL_TTS_SERVER_CTL = FOREIGN_CTL;

    expect(await main([], deps)).toBe(0);

    expect(readFileSync(secretsFile, "utf8")).toContain(`PANEL_TTS_SERVER_CTL=${ctlPath}\n`);
    expect(output()).toMatch(/warning: PANEL_TTS_SERVER_CTL=.* in the environment overrides the secrets file/);

    // With kokoroctl in the environment list there is nothing to warn about.
    const listed = fakes();
    listed.deps.env.PANEL_TTS_SERVER_CTL = `${FOREIGN_CTL}:${ctlPath}`;
    expect(await main([], listed.deps)).toBe(0);
    expect(listed.output()).not.toMatch(/PANEL_TTS_SERVER_CTL=.* in the environment/);
  });

  it("does not promise the panel drives Kokoro when the environment overrides the list", async () => {
    const { deps, output } = fakes();
    deps.env.PANEL_TTS_SERVER_CTL = FOREIGN_CTL;

    expect(await main([], deps)).toBe(0);

    expect(output()).toContain("pnpm stop && pnpm start");
    expect(output()).not.toContain("starts and stops Kokoro itself");
    expect(output()).toMatch(/PANEL_TTS_SERVER_CTL in the environment must list .*kokoroctl/);

    const plain = fakes();
    expect(await main([], plain.deps)).toBe(0);
    expect(plain.output()).toContain("starts and stops Kokoro itself");
  });

  it("re-run is a no-op", async () => {
    writeSecrets("ELEVENLABS_API_KEY=abc\n");
    expect(await main([], fakes().deps)).toBe(0);
    const before = snapshot();

    const again = fakes();
    expect(await main([], again.deps)).toBe(0);

    expect(snapshot()).toEqual(before);
    expect(again.calls.git.filter((c) => /clone|fetch|checkout/.test(c))).toEqual([]);
  });

  it("a server that is already running is probed, never stopped", async () => {
    expect(await main([], fakes().deps)).toBe(0);

    const again = fakes();
    again.server.running = true;
    expect(await main([], again.deps)).toBe(0);

    expect(again.calls.ctl).toEqual(["status"]);
    expect(again.calls.fetch).toContain(`${ADDRESS}/v1/audio/voices`);
  });

  it("a ref change restarts a running server instead of stopping it", async () => {
    expect(await main([], fakes().deps)).toBe(0);
    writeFileSync(join(installDir, "Kokoro-FastAPI", ".git", "FAKE_REF"), "v0.0.1");

    const again = fakes();
    again.server.running = true;
    expect(await main([], again.deps)).toBe(0);

    expect(again.calls.ctl).toEqual(["status", "restart"]);
    expect(readFileSync(join(installDir, "Kokoro-FastAPI", ".git", "FAKE_REF"), "utf8")).toBe(KOKORO_FASTAPI_REF);
  });

  it("final message says to restart the panel", async () => {
    const { deps, output } = fakes();
    expect(await main([], deps)).toBe(0);
    expect(output()).toContain("pnpm stop && pnpm start");
  });

  it("probe timeout stops the server and keeps the install", async () => {
    const { deps, calls, clock, output } = fakes({
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    expect(await main([], deps)).not.toBe(0);

    expect(clock.now).toBeGreaterThanOrEqual(300_000);
    expect(calls.ctl).toEqual(["status", "start", "stop"]);
    expect(output()).toContain(join(installDir, "kokoro.log"));
    expect(existsSync(ctlPath)).toBe(true);
    const secrets = readFileSync(secretsFile, "utf8");
    expect(secrets).toContain(`KOKORO_TTS_BASE_URL=${ADDRESS}\n`);
    expect(secrets).toContain(`PANEL_TTS_SERVER_CTL=${ctlPath}\n`);
  });

  it("uninstall removes only its own lines", async () => {
    expect(await main([], fakes().deps)).toBe(0);

    // Our address, a foreign ctl: only the address goes.
    writeSecrets(`A=1\nKOKORO_TTS_BASE_URL=${ADDRESS}\nPANEL_TTS_SERVER_CTL=${FOREIGN_CTL}\n`);
    const first = fakes();
    expect(await main(["--uninstall"], first.deps)).toBe(0);
    expect(first.calls.ctl).toEqual(["stop"]);
    expect(existsSync(installDir)).toBe(false);
    expect(readFileSync(secretsFile, "utf8")).toBe(`A=1\nPANEL_TTS_SERVER_CTL=${FOREIGN_CTL}\n`);

    // A foreign address, our ctl: only the ctl goes.
    writeSecrets(`KOKORO_TTS_BASE_URL=http://gpu-box:8880\nPANEL_TTS_SERVER_CTL=${ctlPath}\nB=2\n`);
    expect(await main(["--uninstall"], fakes().deps)).toBe(0);
    expect(readFileSync(secretsFile, "utf8")).toBe("KOKORO_TTS_BASE_URL=http://gpu-box:8880\nB=2\n");
  });

  it("uninstall removes only the kokoroctl entry from the list", async () => {
    expect(await main([], fakes().deps)).toBe(0);
    writeSecrets(`A=1\nPANEL_TTS_SERVER_CTL=${FOREIGN_CTL}:${ctlPath}\n`);

    expect(await main(["--uninstall"], fakes().deps)).toBe(0);

    expect(readFileSync(secretsFile, "utf8")).toBe(`A=1\nPANEL_TTS_SERVER_CTL=${FOREIGN_CTL}\n`);
  });

  it("uninstall removes the line when kokoroctl was the only entry", async () => {
    expect(await main([], fakes().deps)).toBe(0);
    writeSecrets(`A=1\nPANEL_TTS_SERVER_CTL=${ctlPath}\n`);

    expect(await main(["--uninstall"], fakes().deps)).toBe(0);

    expect(readFileSync(secretsFile, "utf8")).toBe("A=1\n");
  });

  it("uninstall leaves files it did not create", async () => {
    expect(await main([], fakes().deps)).toBe(0);
    writeFileSync(join(installDir, "kokoro.log"), "log\n");
    writeFileSync(join(installDir, "kokoro.pid"), "1\n");
    writeFileSync(join(installDir, "notes.txt"), "mine\n");

    expect(await main(["--uninstall"], fakes().deps)).toBe(0);

    expect(readdirSync(installDir)).toEqual(["notes.txt"]);
  });

  it("kokoroctl picks the platform start script and stops the whole tree", async () => {
    for (const [platform, script] of [
      ["darwin", "start-gpu_mac.sh"],
      ["linux", "start-cpu.sh"],
    ]) {
      const box = ctlSandbox(platform);

      expect(box.run("start").status).toBe(0);
      await until(() => existsSync(box.child));
      try {
        expect(readFileSync(box.marker, "utf8").trim()).toBe(`${script} ${realpathSync(box.repo)} 127.0.0.1 8880`);
        expect(existsSync(join(box.repo, ".venv"))).toBe(true);
        expect(box.run("status").status).toBe(0);
      } finally {
        const pid = pidOf(box.pidfile);
        const child = Number(readFileSync(box.child, "utf8"));
        expect(box.run("stop").status).toBe(0);
        expect(alive(pid)).toBe(false);
        // A backgrounded child of the start script dies too: stop kills the group.
        await until(() => !alive(child));
        expect(alive(child)).toBe(false);
      }
      expect(box.run("status").status).not.toBe(0);
    }
  });

  it("kokoroctl treats a pidfile naming an unrelated process as stale", async () => {
    const box = ctlSandbox("darwin");
    // Own process group, like a real server, so only identity tells them apart.
    const stranger = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    stranger.unref();
    const strangerPid = stranger.pid as number;
    // A reused pid: alive and leading its group, but not started when recorded.
    const stale = `${strangerPid}\nThu Jan 1 00:00:00 1970\n`;
    try {
      writeFileSync(box.pidfile, stale);

      expect(box.run("status").status).not.toBe(0);
      writeFileSync(box.pidfile, stale);
      expect(box.run("start").stdout).not.toContain("already running");
      await until(() => existsSync(box.child));
      expect(pidOf(box.pidfile)).not.toBe(strangerPid);

      writeFileSync(box.pidfile, stale);
      expect(box.run("stop").status).toBe(0);
      expect(alive(strangerPid)).toBe(true);
    } finally {
      try {
        process.kill(strangerPid, "SIGKILL");
      } catch {}
      // The real start launched above: take its group down by the child's pgid.
      if (existsSync(box.child)) {
        try {
          process.kill(Number(readFileSync(box.child, "utf8")), "SIGKILL");
        } catch {}
      }
    }
  });
});

/** A kokoroctl beside a fake repo whose start script backgrounds a child and waits. */
function ctlSandbox(platform: string) {
  const dir = join(root, platform);
  const repo = join(dir, "Kokoro-FastAPI");
  const bin = join(dir, "bin");
  const marker = join(dir, "started");
  const child = join(dir, "child");
  mkdirSync(repo, { recursive: true });
  mkdirSync(bin);
  for (const name of ["start-gpu_mac.sh", "start-cpu.sh"]) {
    writeFileSync(
      join(repo, name),
      `#!/bin/bash\necho "${name} $(pwd -P) $HOST $PORT" > "${marker}"\nsleep 30 &\necho $! > "${child}.tmp"\nmv "${child}.tmp" "${child}"\nwait\n`,
    );
  }
  writeFileSync(join(bin, "uv"), `#!/bin/bash\n[ "$1" = venv ] && mkdir .venv\nexit 0\n`);
  chmodSync(join(bin, "uv"), 0o755);
  const ctl = join(dir, "kokoroctl");
  writeFileSync(ctl, kokoroctlScript({ platform }));
  chmodSync(ctl, 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const run = (verb: string) => spawnSync(ctl, [verb], { env, encoding: "utf8", timeout: 20_000 });
  return { repo, marker, child, pidfile: join(dir, "kokoro.pid"), run };
}

function pidOf(pidfile: string): number {
  return Number(readFileSync(pidfile, "utf8").split("\n")[0]);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
}
