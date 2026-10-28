import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import type { EngineStatus, Tts, TtsConfig } from "anytts";

// `lib/auth.ts` reads PANEL_TOKEN once, at module load, so the token has to be
// in the environment before that module is imported (vi.hoisted runs first).
const { TOKEN, previousToken } = vi.hoisted(() => {
  const previousToken = process.env.PANEL_TOKEN;
  process.env.PANEL_TOKEN = "speech-engines-test-token";
  return { TOKEN: "speech-engines-test-token", previousToken };
});

import { authMiddleware } from "../../lib/auth";
import { mobileAuthMiddleware } from "../../middleware/mobile-auth";
import { createTtsHolder } from "../../lib/speech/ttsHolder";
import { createSpeechEnginesRouter } from "../speechEngines";

afterAll(() => {
  if (previousToken === undefined) delete process.env.PANEL_TOKEN;
  else process.env.PANEL_TOKEN = previousToken;
});

const KEY_VARS = [
  "ELEVENLABS_API_KEY",
  "CARTESIA_API_KEY",
  "SPEECHIFY_API_KEY",
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_REGION",
] as const;

const COOKIE = `panel_token=${TOKEN}`;
/** A key long enough that its last four characters say nothing about the rest. */
const KEY = "sk-test-0123456789abcdef-WXYZ";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "panel-speech-engines-"));
  vi.stubEnv("PANEL_AUTH_STATE_DIR", dir);
  for (const name of KEY_VARS) vi.stubEnv(name, undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const secretsFile = () => join(dir, "secrets.env");
const secrets = () => (existsSync(secretsFile()) ? readFileSync(secretsFile(), "utf8") : "");

/**
 * A `Tts` stand-in whose `engineStatus` follows its config the way anytts'
 * does: a keyed engine without an `apiKey` is `no-key`, an unconfigured id
 * throws. `windows` overrides the state of a keyed engine that has a key.
 */
function fakeTts(config: TtsConfig, windows: Record<string, EngineStatus>): Tts {
  const engines = config.engines as Record<string, { apiKey?: string } | undefined>;
  return {
    synthesize: vi.fn(),
    prefetch: () => {},
    isCached: () => false,
    state: () => "cold",
    subscribe: () => () => {},
    restartStalled: () => false,
    engineStatus: (id: string): EngineStatus => {
      const engine = engines[id];
      if (!engine) throw new RangeError(`unknown engine ${id}`);
      if (id === "edge" || id === "cascade") return { state: "ready" };
      if (!engine.apiKey) return { state: "no-key" };
      return windows[id] ?? { state: "ready" };
    },
  } as unknown as Tts;
}

interface Loaded {
  app: Express;
  /** Every config the holder built an instance from, oldest first. */
  configs: TtsConfig[];
}

/** Mirrors the production mount: global parser and both auth gates ahead of the router. */
function loadApp(
  options: { windows?: Record<string, EngineStatus>; writeKeys?: Parameters<typeof createSpeechEnginesRouter>[0]["writeKeys"] } = {},
): Loaded {
  const configs: TtsConfig[] = [];
  const holder = createTtsHolder({
    createTts: (config) => {
      configs.push(config);
      return fakeTts(config, options.windows ?? {});
    },
  });
  const app = express();
  app.use(express.json());
  app.use(mobileAuthMiddleware);
  app.use(authMiddleware);
  app.use("/api/speech", createSpeechEnginesRouter({ holder, writeKeys: options.writeKeys }));
  return { app, configs };
}

type Engine = {
  id: string;
  label: string;
  keyed: boolean;
  keySource: string;
  keyLast4?: string;
  region?: string;
  status: EngineStatus;
};

async function engines(app: Express): Promise<Engine[]> {
  const res = await request(app).get("/api/speech/engines").set("Cookie", COOKIE);
  expect(res.status).toBe(200);
  return res.body as Engine[];
}

const engine = (list: Engine[], id: string) => list.find((e) => e.id === id)!;

describe("/api/speech engines and keys", () => {
  it("saving a key writes the file and rebuilds", async () => {
    const { app, configs } = loadApp();
    expect(engine(await engines(app), "elevenlabs")).toMatchObject({
      keyed: true,
      keySource: "none",
      status: { state: "no-key" },
    });

    const res = await request(app)
      .put("/api/speech/keys/elevenlabs")
      .set("Cookie", COOKIE)
      .send({ apiKey: KEY });
    expect(res.status).toBe(204);

    expect(secrets()).toBe(`ELEVENLABS_API_KEY=${KEY}\n`);
    expect(configs).toHaveLength(2);
    expect(configs[1]!.engines.elevenlabs).toEqual({ apiKey: KEY });

    const list = await engines(app);
    expect(list.map((e) => e.id)).toEqual(["elevenlabs", "cartesia", "speechify", "azure", "edge"]);
    expect(engine(list, "elevenlabs")).toEqual({
      id: "elevenlabs",
      label: "ElevenLabs",
      keyed: true,
      keySource: "file",
      keyLast4: "WXYZ",
      status: { state: "ready" },
    });
    expect(engine(list, "edge")).toEqual({
      id: "edge",
      label: expect.any(String),
      keyed: false,
      keySource: "none",
      status: { state: "ready" },
    });
  });

  it("the key never returns", async () => {
    const failing = loadApp({
      writeKeys: async () => {
        throw new Error(`EACCES writing ${KEY}`);
      },
    });
    const { app } = loadApp();
    const bodies: string[] = [];
    const record = (res: request.Response) => {
      bodies.push(res.text ?? "", JSON.stringify(res.body ?? null), JSON.stringify(res.headers));
      return res;
    };

    record(await request(app).put("/api/speech/keys/cartesia").set("Cookie", COOKIE).send({ apiKey: KEY }));
    record(
      await request(app)
        .put("/api/speech/keys/azure")
        .set("Cookie", COOKIE)
        .send({ apiKey: KEY, region: "westeurope" }),
    );
    record(await request(app).get("/api/speech/engines").set("Cookie", COOKIE));
    record(await request(app).put("/api/speech/keys/edge").set("Cookie", COOKIE).send({ apiKey: KEY }));
    record(await request(app).put("/api/speech/keys/azure").set("Cookie", COOKIE).send({ apiKey: KEY }));
    record(await request(app).put("/api/speech/keys/elevenlabs").send({ apiKey: KEY }));
    const failed = record(
      await request(failing.app).put("/api/speech/keys/speechify").set("Cookie", COOKIE).send({ apiKey: KEY }),
    );
    expect(failed.status).toBe(500);
    vi.stubEnv("SPEECHIFY_API_KEY", KEY);
    record(await request(app).get("/api/speech/engines").set("Cookie", COOKIE));
    record(await request(app).put("/api/speech/keys/speechify").set("Cookie", COOKIE).send({ apiKey: KEY }));
    record(await request(app).delete("/api/speech/keys/cartesia").set("Cookie", COOKIE));

    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body).not.toContain(KEY);
  });

  it("the environment wins with 409", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", KEY);
    vi.stubEnv("AZURE_SPEECH_REGION", "westeurope");
    const { app, configs } = loadApp();

    const keyed = await request(app)
      .put("/api/speech/keys/elevenlabs")
      .set("Cookie", COOKIE)
      .send({ apiKey: "sk-other-key-1234" });
    expect(keyed.status).toBe(409);

    // Either Azure variable coming from the environment blocks the pair.
    const azure = await request(app)
      .put("/api/speech/keys/azure")
      .set("Cookie", COOKIE)
      .send({ apiKey: "az-other-key-1234", region: "northeurope" });
    expect(azure.status).toBe(409);

    expect(secrets()).toBe("");
    expect(configs).toHaveLength(1);
    expect(engine(await engines(app), "elevenlabs")).toMatchObject({ keySource: "env", keyLast4: "WXYZ" });
  });

  it("azure needs a region", async () => {
    const { app, configs } = loadApp();
    const put = (path: string, body: object) =>
      request(app).put(`/api/speech/keys/${path}`).set("Cookie", COOKIE).send(body);

    expect((await put("azure", { apiKey: KEY })).status).toBe(400);
    expect((await put("azure", { apiKey: KEY, region: "west europe" })).status).toBe(400);
    expect((await put("azure", { apiKey: KEY, region: "" })).status).toBe(400);
    expect((await put("nope", { apiKey: KEY })).status).toBe(400);
    expect((await put("edge", { apiKey: KEY })).status).toBe(400);
    expect((await put("cascade", { apiKey: KEY })).status).toBe(400);
    expect((await put("elevenlabs", {})).status).toBe(400);
    expect((await put("elevenlabs", { apiKey: "  " })).status).toBe(400);
    expect((await put("elevenlabs", { apiKey: "ab\ncd" })).status).toBe(400);
    expect(secrets()).toBe("");
    expect(configs).toHaveLength(1);

    // A region in any case is stored lowercase, next to the key.
    expect((await put("azure", { apiKey: KEY, region: "WestEurope" })).status).toBe(204);
    expect(secrets()).toBe(`AZURE_SPEECH_KEY=${KEY}\nAZURE_SPEECH_REGION=westeurope\n`);
    expect(engine(await engines(app), "azure")).toMatchObject({
      keySource: "file",
      keyLast4: "WXYZ",
      region: "westeurope",
      status: { state: "ready" },
    });
  });

  it("removing a key", async () => {
    const { app, configs } = loadApp();
    await request(app).put("/api/speech/keys/elevenlabs").set("Cookie", COOKIE).send({ apiKey: KEY });
    await request(app)
      .put("/api/speech/keys/azure")
      .set("Cookie", COOKIE)
      .send({ apiKey: KEY, region: "westeurope" });
    expect(engine(await engines(app), "azure").status.state).toBe("ready");

    const azure = await request(app).delete("/api/speech/keys/azure").set("Cookie", COOKIE);
    expect(azure.status).toBe(204);
    expect(secrets()).toBe(`ELEVENLABS_API_KEY=${KEY}\n`);

    const elevenlabs = await request(app).delete("/api/speech/keys/elevenlabs").set("Cookie", COOKIE);
    expect(elevenlabs.status).toBe(204);
    expect(secrets()).toBe("");
    expect(configs).toHaveLength(5);

    const list = await engines(app);
    for (const id of ["elevenlabs", "azure"]) {
      const entry = engine(list, id);
      expect(entry).toMatchObject({ keySource: "none", status: { state: "no-key" } });
      expect(entry.keyLast4).toBeUndefined();
      expect(entry.region).toBeUndefined();
    }
  });

  it("behind auth", async () => {
    const { app, configs } = loadApp();

    expect((await request(app).get("/api/speech/engines")).status).toBe(401);
    expect((await request(app).put("/api/speech/keys/elevenlabs").send({ apiKey: KEY })).status).toBe(401);
    expect((await request(app).delete("/api/speech/keys/elevenlabs")).status).toBe(401);
    expect(secrets()).toBe("");
    expect(configs).toHaveLength(1);

    // The production file mounts the router after the global auth gate, with the server's one holder.
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, "../../panel-server.ts"), "utf8");
    const gate = /app\s*\.\s*use\s*\(\s*authMiddleware\s*\)/.exec(source);
    const mobileGate = /app\s*\.\s*use\s*\(\s*mobileAuthMiddleware\s*\)/.exec(source);
    const mount =
      /app\s*\.\s*use\s*\(\s*["']\/api\/speech["']\s*,\s*createSpeechEnginesRouter\s*\(\s*\{\s*holder\s*:\s*ttsHolder\s*\}\s*\)\s*\)/.exec(
        source,
      );
    expect(gate, "the global authMiddleware mount").not.toBeNull();
    expect(mobileGate, "the global mobileAuthMiddleware mount").not.toBeNull();
    expect(mount, "the speech engines router mount").not.toBeNull();
    expect(mount!.index).toBeGreaterThan(gate!.index);
    expect(mount!.index).toBeGreaterThan(mobileGate!.index);
  });

  it("status comes from engineStatus", async () => {
    const until = "2026-10-28T12:00:00.000Z";
    vi.stubEnv("ELEVENLABS_API_KEY", KEY);
    vi.stubEnv("CARTESIA_API_KEY", "ca-key-00001111");
    const { app } = loadApp({
      windows: {
        elevenlabs: { state: "rate-limited", until },
        cartesia: { state: "quota-exhausted", until },
      },
    });

    const list = await engines(app);
    expect(engine(list, "elevenlabs").status).toEqual({ state: "rate-limited", until });
    expect(engine(list, "cartesia").status).toEqual({ state: "quota-exhausted", until });
    expect(engine(list, "speechify").status).toEqual({ state: "no-key" });
  });

  it("a failed write answers 500 and rebuilds nothing", async () => {
    const { app, configs } = loadApp({
      writeKeys: async () => {
        throw new Error("EACCES");
      },
    });

    const res = await request(app).put("/api/speech/keys/elevenlabs").set("Cookie", COOKIE).send({ apiKey: KEY });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(configs).toHaveLength(1);

    const removed = await request(app).delete("/api/speech/keys/elevenlabs").set("Cookie", COOKIE);
    expect(removed.status).toBe(500);
  });
});
