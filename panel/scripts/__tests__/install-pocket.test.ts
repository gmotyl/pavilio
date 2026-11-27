import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  POCKET_PL_CONFIG,
  POCKET_PL_REVISION,
  POCKET_PORTS,
  POCKET_TTS_VERSION,
  main,
} from "../install-pocket.mjs";

const FOREIGN_CTL = "/x/kokoroctl";

let root: string;
let home: string;
let installDir: string;
let stateDir: string;
let secretsFile: string;
let ctlPath: string;
let workspace: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "install-pocket-")));
  home = join(root, "home");
  installDir = join(root, "pocket-tts");
  stateDir = join(root, "panel-state");
  secretsFile = join(stateDir, "secrets.env");
  ctlPath = join(installDir, "pocketctl");
  workspace = join(root, "workspace");
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeSecrets(text: string) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(secretsFile, text);
}

function secrets(): string {
  return readFileSync(secretsFile, "utf8");
}

function writeToken() {
  mkdirSync(join(home, ".cache", "huggingface"), { recursive: true });
  writeFileSync(join(home, ".cache", "huggingface", "token"), "hf_x\n");
}

function snapshot(dir = root): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) Object.assign(out, snapshot(path));
    else out[path] = `${statSync(path).mtimeMs}:${readFileSync(path, "utf8")}`;
  }
  return out;
}

function fakes(overrides: Record<string, unknown> = {}) {
  const calls = { run: [] as string[], ctl: [] as string[], fetch: [] as string[] };
  const server = { running: false };
  const clock = { now: 0 };
  const output: string[] = [];
  const deps = {
    env: { HOME: home, PAVILIO_POCKET_DIR: installDir, PANEL_AUTH_STATE_DIR: stateDir } as Record<string, string>,
    platform: "linux",
    which: () => true,
    run: (cmd: string, args: string[]) => {
      calls.run.push([cmd, ...args].join(" "));
      if (args[0] === "venv") mkdirSync(args.at(-1) as string, { recursive: true });
      return { status: 0 };
    },
    ctl: (path: string, verb: string) => {
      expect(path).toBe(ctlPath);
      calls.ctl.push(verb);
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
  return { deps, calls, server, output: () => output.join("\n") };
}

const both = () => ({ servers: ["pocket", "pocket-pl"], workspaceRoot: workspace });

describe("install:pocket", () => {
  it("fresh install of both servers wires the secrets and probes health", async () => {
    writeToken();
    const { deps, calls } = fakes();

    expect(await main(both(), deps)).toEqual({ ok: true });

    expect(POCKET_TTS_VERSION).toBe("4.0.1");
    expect(POCKET_PORTS).toEqual({ pocket: 8890, "pocket-pl": 8891, voiceFiles: 8892 });
    const runs = calls.run.join("\n");
    expect(runs).toContain("--python 3.12");
    expect(runs).toContain("pocket-tts==4.0.1");
    expect(runs).toContain("--extra-index-url https://download.pytorch.org/whl/cpu");
    expect(runs).toContain("--index-strategy unsafe-best-match");
    expect(statSync(ctlPath).mode & 0o111).not.toBe(0);
    expect(existsSync(join(installDir, "pocket.conf"))).toBe(true);
    const text = secrets();
    expect(text).toContain("POCKET_TTS_BASE_URL=http://127.0.0.1:8890\n");
    expect(text).toContain("POCKET_PL_TTS_BASE_URL=http://127.0.0.1:8891\n");
    expect(text).toContain("POCKET_VOICE_FILES_URL=http://127.0.0.1:8892\n");
    expect(text).toContain("POCKET_TTS_CLONING=1\n");
    expect(text).toContain(`PANEL_TTS_SERVER_CTL=${ctlPath}\n`);
    expect(calls.fetch).toEqual(["http://127.0.0.1:8890/health", "http://127.0.0.1:8891/health"]);
    expect(calls.ctl).toEqual(["status", "start", "stop"]);
  });

  it("pocketctl starts the selected servers and the voice-file server", async () => {
    const { deps } = fakes({ platform: "darwin" });
    await main(both(), deps);

    const script = readFileSync(ctlPath, "utf8");
    expect(script).toContain("--host 127.0.0.1 --port 8890");
    expect(script).toContain("--host 127.0.0.1 --port 8891");
    expect(script).toContain(`--config ${POCKET_PL_CONFIG}`);
    expect(POCKET_PL_CONFIG).toBe(
      `hf://shefowl/pocket-tts-polish-6l/config.yaml@${POCKET_PL_REVISION}`,
    );
    expect(script).toContain(`--default-voice hf://shefowl/pocket-tts-polish-6l/reference.wav@${POCKET_PL_REVISION}`);
    expect(script).toContain("http.server 8892 --bind 127.0.0.1 -d");
    expect(script).toContain(".cache/huggingface/token");
    expect(script).toContain("HF_TOKEN");
    const conf = readFileSync(join(installDir, "pocket.conf"), "utf8");
    expect(conf).toContain("pocket pocket-pl");
    expect(conf).toContain(join(workspace, ".pavilio", "voices"));
  });

  it("no Hugging Face token turns English cloning off without failing", async () => {
    const { deps, output } = fakes();

    expect(await main({ servers: ["pocket"], workspaceRoot: workspace }, deps)).toEqual({ ok: true });

    expect(secrets()).toContain("POCKET_TTS_CLONING=0\n");
    const text = output();
    expect(text).toContain("cloning is off");
    expect(text).toContain("https://huggingface.co/kyutai/pocket-tts");
    expect(text).toContain("uvx hf auth login");
    expect(text).toContain("re-run");
  });

  it("re-running the same selection changes nothing", async () => {
    writeToken();
    await main(both(), fakes().deps);
    const before = snapshot();

    const { deps } = fakes();
    expect(await main(both(), deps)).toEqual({ ok: true });

    expect(snapshot()).toEqual(before);
    expect(readdirSync(stateDir)).toEqual(["secrets.env"]);
  });

  it("missing uv writes nothing", async () => {
    const { deps, output } = fakes({ which: () => false });

    expect(await main(both(), deps)).toEqual({ ok: false });

    expect(readdirSync(root)).toEqual(["home"]);
    expect(output()).toContain("curl -LsSf https://astral.sh/uv/install.sh | sh");
  });

  it("a server that never answers is stopped and reported", async () => {
    const { deps, calls, output } = fakes({
      fetch: async () => {
        throw new Error("refused");
      },
    });

    expect(await main(both(), deps)).toEqual({ ok: false });

    expect(calls.ctl.at(-1)).toBe("stop");
    expect(output()).toContain(join(installDir, "pocket.log"));
    expect(existsSync(ctlPath)).toBe(true);
    expect(secrets()).toContain("POCKET_TTS_BASE_URL=http://127.0.0.1:8890");
  });

  it("uninstalling one server keeps the other; the last removes everything", async () => {
    writeSecrets(`PANEL_TTS_SERVER_CTL=${FOREIGN_CTL}\n`);
    await main(both(), fakes().deps);

    expect(await main({ servers: ["pocket-pl"], uninstall: true, workspaceRoot: workspace }, fakes().deps)).toEqual({
      ok: true,
    });
    let text = secrets();
    expect(text).not.toContain("POCKET_PL_TTS_BASE_URL");
    expect(text).toContain("POCKET_TTS_BASE_URL=http://127.0.0.1:8890");
    expect(text).toContain("POCKET_VOICE_FILES_URL");
    expect(text).toContain(ctlPath);
    expect(readFileSync(join(installDir, "pocket.conf"), "utf8")).not.toContain("pocket-pl");
    expect(existsSync(join(installDir, "venv"))).toBe(true);

    await main({ servers: ["pocket"], uninstall: true, workspaceRoot: workspace }, fakes().deps);
    text = secrets();
    expect(text).toBe(`PANEL_TTS_SERVER_CTL=${FOREIGN_CTL}\n`);
    expect(existsSync(installDir)).toBe(false);
  });

  it("pocketctl is appended to an existing ctl list", async () => {
    writeSecrets(`PANEL_TTS_SERVER_CTL=${FOREIGN_CTL}\n`);
    await main(both(), fakes().deps);
    expect(secrets()).toContain(`PANEL_TTS_SERVER_CTL=${FOREIGN_CTL}:${ctlPath}\n`);
  });

  it("a re-run leaves pocketctl, pocket.conf and the secrets file untouched", async () => {
    writeToken();
    await main(both(), fakes().deps);
    const files = [ctlPath, join(installDir, "pocket.conf"), secretsFile];
    const old = new Date("2020-01-01T00:00:00Z");
    for (const file of files) utimesSync(file, old, old);
    const before = files.map((file) => [readFileSync(file, "utf8"), statSync(file).mtimeMs]);

    await main(both(), fakes().deps);

    expect(files.map((file) => [readFileSync(file, "utf8"), statSync(file).mtimeMs])).toEqual(before);
    expect(statSync(ctlPath).mtimeMs).toBe(old.getTime());
  });

  it("a server already running is only probed, never started or stopped", async () => {
    const { deps, calls, server } = fakes();
    server.running = true;

    expect(await main(both(), deps)).toEqual({ ok: true });

    expect(calls.ctl).toEqual(["status"]);
    expect(calls.fetch).toEqual(["http://127.0.0.1:8890/health", "http://127.0.0.1:8891/health"]);
  });

  it("selecting one server on a later run keeps the already-installed other", async () => {
    await main({ servers: ["pocket"], workspaceRoot: workspace }, fakes().deps);

    const { deps, calls } = fakes();
    await main({ servers: ["pocket-pl"], workspaceRoot: workspace }, deps);

    expect(readFileSync(join(installDir, "pocket.conf"), "utf8")).toContain("POCKET_SERVERS='pocket pocket-pl'");
    const text = secrets();
    expect(text).toContain("POCKET_TTS_BASE_URL=http://127.0.0.1:8890\n");
    expect(text).toContain("POCKET_PL_TTS_BASE_URL=http://127.0.0.1:8891\n");
    expect(calls.fetch).toEqual(["http://127.0.0.1:8890/health", "http://127.0.0.1:8891/health"]);
  });

  it("an empty Hugging Face token file counts as no login", async () => {
    mkdirSync(join(home, ".cache", "huggingface"), { recursive: true });
    writeFileSync(join(home, ".cache", "huggingface", "token"), "");
    const { deps } = fakes();

    await main({ servers: ["pocket"], workspaceRoot: workspace }, deps);

    expect(secrets()).toContain("POCKET_TTS_CLONING=0\n");
  });
});

describe.skipIf(process.platform === "win32")("generated pocketctl at runtime", () => {
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
    await main(both(), fakes().deps);
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
    expect(lines).toContain("pocket-tts serve --host 127.0.0.1 --port 8890 HF_TOKEN=hf_secret");
    expect(lines).toContain(
      `pocket-tts serve --host 127.0.0.1 --port 8891 --config ${POCKET_PL_CONFIG} --default-voice hf://shefowl/pocket-tts-polish-6l/reference.wav@${POCKET_PL_REVISION} HF_TOKEN=`,
    );
    expect(lines).toContain(
      `python -m http.server 8892 --bind 127.0.0.1 -d ${join(workspace, ".pavilio", "voices")} HF_TOKEN=`,
    );
    expect(runCtl("status").status).toBe(0);
    const pids = ["pocket", "pocket-pl", "voices"].map((n) => Number(readFileSync(join(installDir, `${n}.pid`), "utf8").split("\n")[0]));

    expect(runCtl("stop").status).toBe(0);

    expect(runCtl("status").status).toBe(3);
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
  });
});
