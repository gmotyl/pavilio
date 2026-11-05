import { spawnSync } from "node:child_process";
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
  return { deps, calls, clock, output: () => output.join("\n") };
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
    expect(calls.ctl).toEqual(["start", "stop"]);
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

  it("refuses to overwrite a foreign PANEL_TTS_SERVER_CTL", async () => {
    // From the secrets file.
    writeSecrets(`PANEL_TTS_SERVER_CTL=${FOREIGN_CTL}\n`);
    const fromFile = fakes();
    expect(await main([], fromFile.deps)).not.toBe(0);
    expect(fromFile.output()).toContain(FOREIGN_CTL);
    expect(fromFile.output()).toContain(`PANEL_TTS_SERVER_CTL=${ctlPath}`);
    expect(readFileSync(secretsFile, "utf8")).toBe(`PANEL_TTS_SERVER_CTL=${FOREIGN_CTL}\n`);
    expect(backups()).toEqual([]);
    expect(fromFile.calls.ctl).toEqual([]);

    // From the process environment, which wins over the file.
    writeSecrets("");
    const fromEnv = fakes();
    fromEnv.deps.env.PANEL_TTS_SERVER_CTL = FOREIGN_CTL;
    expect(await main([], fromEnv.deps)).not.toBe(0);
    expect(fromEnv.output()).toContain(FOREIGN_CTL);
    expect(fromEnv.output()).toContain(`PANEL_TTS_SERVER_CTL=${ctlPath}`);
    expect(readFileSync(secretsFile, "utf8")).toBe("");
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

  it("probe timeout stops the server and keeps the install", async () => {
    const { deps, calls, clock, output } = fakes({
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    expect(await main([], deps)).not.toBe(0);

    expect(clock.now).toBeGreaterThanOrEqual(300_000);
    expect(calls.ctl).toEqual(["start", "stop"]);
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

  it("kokoroctl picks the platform start script", async () => {
    for (const [platform, script] of [
      ["darwin", "start-gpu_mac.sh"],
      ["linux", "start-cpu.sh"],
    ]) {
      const dir = join(root, platform);
      const repo = join(dir, "Kokoro-FastAPI");
      const bin = join(dir, "bin");
      const marker = join(dir, "started");
      mkdirSync(repo, { recursive: true });
      mkdirSync(bin);
      for (const name of ["start-gpu_mac.sh", "start-cpu.sh"]) {
        writeFileSync(
          join(repo, name),
          `#!/bin/bash\necho "${name} $(pwd -P) $HOST $PORT" > "${marker}"\nexec sleep 30\n`,
        );
      }
      writeFileSync(join(bin, "uv"), `#!/bin/bash\n[ "$1" = venv ] && mkdir .venv\nexit 0\n`);
      chmodSync(join(bin, "uv"), 0o755);
      const ctl = join(dir, "kokoroctl");
      writeFileSync(ctl, kokoroctlScript({ platform }));
      chmodSync(ctl, 0o755);
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
      const run = (verb: string) => spawnSync(ctl, [verb], { env, encoding: "utf8", timeout: 20_000 });

      expect(run("start").status).toBe(0);
      for (let i = 0; i < 100 && !existsSync(marker); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      try {
        expect(readFileSync(marker, "utf8").trim()).toBe(`${script} ${realpathSync(repo)} 127.0.0.1 8880`);
        expect(existsSync(join(repo, ".venv"))).toBe(true);
        expect(run("status").status).toBe(0);
      } finally {
        const pid = Number(readFileSync(join(dir, "kokoro.pid"), "utf8"));
        expect(run("stop").status).toBe(0);
        expect(() => process.kill(pid, 0)).toThrow();
      }
      expect(run("status").status).not.toBe(0);
    }
  });
});
