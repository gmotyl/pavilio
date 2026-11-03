import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error -- plain .mjs script without type declarations
import { resolveBaseUrl, seedVoices } from "../seed-omnivoice-voices.mjs";
// @ts-expect-error -- plain .mjs script without type declarations
import { main as installMain } from "../install-speech-hook.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SEED_SCRIPT = join(TEST_DIR, "..", "seed-omnivoice-voices.mjs");
const BASE_URL = "http://omnivoice.test:8890";

interface Call {
  url: string;
  method: string;
  form?: FormData;
}

/**
 * A fake omnivoice-server: `GET /v1/voices` lists `auto`, one bundled voice and every name
 * posted so far; `POST /v1/voices` answers per `postStatus` (200 by default) and records the name.
 */
function fakeServer(postStatus: Record<string, { status: number; detail: string }> = {}) {
  const custom = new Set<string>();
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const form = init.body instanceof FormData ? init.body : undefined;
    calls.push({ url, method, form });
    if (url !== `${BASE_URL}/v1/voices`) return new Response("not found", { status: 404 });
    if (method === "GET") {
      const voices = [
        { id: "auto", source: "bundled" },
        { id: "comic-s13", source: "bundled" },
        ...[...custom].map((id) => ({ id, source: "custom" })),
      ];
      return Response.json({ voices });
    }
    const name = String(form?.get("name"));
    const failure = postStatus[name];
    if (failure) return Response.json({ detail: failure.detail }, { status: failure.status });
    custom.add(name);
    return Response.json({ id: name, source: "custom" });
  });
  return { fetch: fetchImpl, calls, posts: () => calls.filter((c) => c.method === "POST") };
}

let workspaceRoot: string;

function addWorkspaceVoice(name: string, record: Record<string, unknown> = {}): void {
  const dir = join(workspaceRoot, ".pavilio", "voices", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sample.wav"), `RIFF-${name}`);
  writeFileSync(
    join(dir, "voice.json"),
    JSON.stringify({
      id: name,
      source: "custom",
      language: "pl",
      locale: "pl-PL",
      gender: "male",
      label: `${name} label`,
      multilingual: false,
      ref_text: `${name} transcript`,
      ...record,
    }),
  );
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "seed-voices-"));
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("seedVoices", () => {
  it("seeds a missing custom voice", async () => {
    addWorkspaceVoice("my-voice");
    const server = fakeServer();
    const lines: string[] = [];

    await seedVoices({ workspaceRoot, baseUrl: BASE_URL, fetch: server.fetch, log: (l: string) => lines.push(l) });

    const posts = server.posts();
    expect(posts).toHaveLength(1);
    const form = posts[0].form!;
    expect(form.get("name")).toBe("my-voice");
    expect(form.get("ref_text")).toBe("my-voice transcript");
    expect(form.get("locale")).toBe("pl-PL");
    expect(form.get("gender")).toBe("male");
    expect(form.get("label")).toBe("my-voice label");
    expect(form.get("multilingual")).toBe("false");
    const file = form.get("file") as File;
    expect(file.name).toBe("sample.wav");
    expect(await file.text()).toBe("RIFF-my-voice");
    expect(lines).toEqual(["voices: seeded 1, already there 0"]);
  });

  it("is idempotent", async () => {
    addWorkspaceVoice("my-voice");
    const server = fakeServer();
    await seedVoices({ workspaceRoot, baseUrl: BASE_URL, fetch: server.fetch, log: () => {} });
    const lines: string[] = [];

    await seedVoices({ workspaceRoot, baseUrl: BASE_URL, fetch: server.fetch, log: (l: string) => lines.push(l) });

    expect(server.posts()).toHaveLength(1);
    expect(lines).toEqual(["voices: seeded 0, already there 1"]);
  });

  it("skips with one line when there is no address or no server", async () => {
    addWorkspaceVoice("my-voice");
    // No address: neither the environment nor the secrets file names one.
    const stateDir = mkdtempSync(join(tmpdir(), "seed-voices-state-"));
    try {
      expect(resolveBaseUrl({ env: {}, stateDir })).toBeUndefined();
      writeFileSync(join(stateDir, "secrets.env"), "ELEVENLABS_API_KEY=x\r\nOPENAI_TTS_BASE_URL=http://file:1\r\n");
      expect(resolveBaseUrl({ env: {}, stateDir })).toBe("http://file:1");
      expect(resolveBaseUrl({ env: { OPENAI_TTS_BASE_URL: "http://env:2" }, stateDir })).toBe("http://env:2");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }

    const noAddress: string[] = [];
    const unused = vi.fn();
    await seedVoices({ workspaceRoot, baseUrl: undefined, fetch: unused, log: (l: string) => noAddress.push(l) });
    expect(unused).not.toHaveBeenCalled();
    expect(noAddress).toHaveLength(1);
    expect(noAddress[0]).toMatch(/^voices: skipped .*OPENAI_TTS_BASE_URL/);

    const noServer: string[] = [];
    const refusing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await seedVoices({ workspaceRoot, baseUrl: BASE_URL, fetch: refusing, log: (l: string) => noServer.push(l) });
    expect(noServer).toHaveLength(1);
    expect(noServer[0]).toMatch(/^voices: skipped .*omnivoice\.test:8890/);

    // The CLI exits 0 in both cases.
    const stateless = mkdtempSync(join(tmpdir(), "seed-voices-state-"));
    try {
      const env = { ...process.env, PANEL_AUTH_STATE_DIR: stateless };
      delete env.OPENAI_TTS_BASE_URL;
      const unset = spawnSync(process.execPath, [SEED_SCRIPT], { env, encoding: "utf8" });
      expect(unset.status).toBe(0);
      expect(unset.stdout.trim().split("\n")).toHaveLength(1);
      const down = spawnSync(process.execPath, [SEED_SCRIPT], {
        env: { ...env, OPENAI_TTS_BASE_URL: "http://127.0.0.1:9" },
        encoding: "utf8",
      });
      expect(down.status).toBe(0);
      expect(down.stdout).toMatch(/^voices: skipped /);
    } finally {
      rmSync(stateless, { recursive: true, force: true });
    }
  });

  it("a failing voice does not stop the others", async () => {
    addWorkspaceVoice("bad-voice");
    addWorkspaceVoice("my-voice");
    const server = fakeServer({ "bad-voice": { status: 400, detail: "could not decode audio" } });
    const lines: string[] = [];

    await seedVoices({ workspaceRoot, baseUrl: BASE_URL, fetch: server.fetch, log: (l: string) => lines.push(l) });

    expect(server.posts().map((p) => p.form?.get("name"))).toEqual(["bad-voice", "my-voice"]);
    expect(lines.some((l) => l.includes("bad-voice") && l.includes("could not decode audio"))).toBe(true);
    expect(lines.at(-1)).toMatch(/^voices: seeded 1, already there 0/);
  });
});

describe("install-speech-hook seeding", () => {
  it("uninstall does not seed", async () => {
    const seed = vi.fn(async () => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // No targets: the walk itself is not under test and must touch no agent config.
      expect(await installMain(["--uninstall"], { targets: [], seed })).toBe(0);
      expect(seed).not.toHaveBeenCalled();
      // Control: the same call without --uninstall does seed.
      expect(await installMain([], { targets: [], seed })).toBe(0);
      expect(seed).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });
});
