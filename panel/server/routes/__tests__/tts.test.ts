import { describe, it, expect, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import type { EdgeEngineOptions, SynthesisRequest, SynthesisResult, Tts } from "anytts";

// `lib/auth.ts` reads PANEL_TOKEN once, at module load, so the token has to be
// in the environment before that module is imported (vi.hoisted runs first).
const { TOKEN, previousToken } = vi.hoisted(() => {
  const previousToken = process.env.PANEL_TOKEN;
  process.env.PANEL_TOKEN = "tts-test-token";
  return { TOKEN: "tts-test-token", previousToken };
});

// anytts' `resolveVoice` finds an instance's voice maps only on a real
// `createTts` instance; these fakes register their default here instead. An
// instance with none resolves nothing, as an unconfigured engine would.
const { fakeDefaults } = vi.hoisted(() => ({ fakeDefaults: new WeakMap<object, string>() }));
vi.mock("anytts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("anytts")>()),
  resolveVoice: vi.fn((tts: object, q: { engine: string; voice?: string }) => {
    const voice = q.voice ?? fakeDefaults.get(tts);
    if (voice === undefined) throw new RangeError(`engine is not configured: ${q.engine}`);
    return { voice, fellBack: false };
  }),
}));

import { authMiddleware } from "../../lib/auth";
import { mobileAuthMiddleware } from "../../middleware/mobile-auth";
import { createTtsHandler } from "../tts";
import { createTtsHolder, type TtsHolder } from "../../lib/speech/ttsHolder";
import type { UsageStore } from "../../lib/speech/usage-store";
import { createAnswerAudioCache, type AnswerAudioCache } from "../../lib/speech/answerAudioCache";

afterAll(() => {
  if (previousToken === undefined) delete process.env.PANEL_TOKEN;
  else process.env.PANEL_TOKEN = previousToken;
});

type Transport = NonNullable<EdgeEngineOptions["transport"]>;
type Listener = (event: { data?: unknown }) => void;

/** The bytes the fake read-aloud service streams back for every synthesis. */
const AUDIO = [0xff, 0xf3, 0x01, 0x02, 0x03];

function audioFrame(bytes: number[]): ArrayBuffer {
  const header = new TextEncoder().encode(
    "X-RequestId:abc\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n",
  );
  const out = new Uint8Array(2 + header.length + bytes.length);
  out[0] = header.length >> 8;
  out[1] = header.length & 0xff;
  out.set(header, 2);
  out.set(bytes, 2 + header.length);
  return out.buffer;
}

const TURN_END = "X-RequestId:abc\r\nPath:turn.end\r\n\r\n{}";

/**
 * A WebSocket stand-in that behaves like the read-aloud service on the happy
 * path: it opens, waits for the config + SSML messages, then streams one audio
 * frame and the turn end. The engine attaches its listeners after `open()`
 * returns, so the open is deferred to a microtask.
 */
class FakeSocket {
  readyState = 0;
  binaryType = "blob";
  private listeners = new Map<string, Set<Listener>>();
  private sent = 0;

  constructor() {
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open");
    });
  }
  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
  send(): void {
    // First message is the speech config, second the SSML request.
    if (++this.sent < 2) return;
    queueMicrotask(() => {
      this.emit("message", { data: audioFrame(AUDIO) });
      this.emit("message", { data: TURN_END });
    });
  }
  close(): void {
    this.readyState = 3;
  }
  private emit(type: string, event: { data?: unknown } = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

function fakeTransport(): { transport: Transport; opened: () => number } {
  let count = 0;
  const transport: Transport = {
    open() {
      count++;
      return new FakeSocket() as unknown as WebSocket;
    },
  };
  return { transport, opened: () => count };
}

/**
 * Mirrors the production mount in panel-server.ts: both auth gates and the
 * relay on the exact `/api/tts` path, then the global `express.json()`. The
 * relay reads the raw request stream itself, so a parser running ahead of it
 * would leave it an already-consumed body. That the production file really is
 * shaped this way is asserted separately below; this is only a copy of it.
 */
function loadApp(): { app: Express; opened: () => number } {
  const { transport, opened } = fakeTransport();
  const app = express();
  // A keyless holder, so the test never reads the real ~/.panel/secrets.env or env keys.
  const holder = createTtsHolder({ transport, resolveKey: () => ({ source: "none" }) });
  app.all("/api/tts", mobileAuthMiddleware, authMiddleware, createTtsHandler({ transport, holder, usage: fakeUsage() }));
  app.use(express.json());
  return { app, opened };
}

/** A usage store stand-in, so the relay's counting never writes the real workspace. */
function fakeUsage(): UsageStore & { record: ReturnType<typeof vi.fn> } {
  return { record: vi.fn(async () => {}), readAll: vi.fn(async () => []) };
}

const VOICE = "en-US-AndrewMultilingualNeural";
const COOKIE = `panel_token=${TOKEN}`;

describe("/api/tts relay", () => {
  it("rejects without the panel token cookie", async () => {
    const { app, opened } = loadApp();

    const res = await request(app).post("/api/tts").send({ text: "Hello.", voice: VOICE });

    expect(res.status).toBe(401);
    expect(opened()).toBe(0);
  });

  it("relays a synthesis and answers audio/mpeg", async () => {
    const { app, opened } = loadApp();

    const res = await request(app)
      .post("/api/tts")
      .set("Cookie", COOKIE)
      .send({ text: "Hello there.", voice: VOICE })
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => done(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/mpeg");
    expect([...(res.body as Buffer)]).toEqual(AUDIO);
    expect(opened()).toBe(1);
  });

  it("answers 413 over maxChars and 400 for an unknown voice", async () => {
    const { app, opened } = loadApp();

    const tooLong = await request(app)
      .post("/api/tts")
      .set("Cookie", COOKIE)
      .send({ text: "x".repeat(2001), voice: VOICE });
    expect(tooLong.status).toBe(413);
    expect(tooLong.headers["content-type"]).toMatch(/application\/json/);

    // Exactly at the limit is still accepted.
    const atLimit = await request(app)
      .post("/api/tts")
      .set("Cookie", COOKIE)
      .send({ text: "x".repeat(2000), voice: VOICE });
    expect(atLimit.status).toBe(200);

    const unknownVoice = await request(app)
      .post("/api/tts")
      .set("Cookie", COOKIE)
      .send({ text: "Hello.", voice: "xx-XX-NobodyNeural" });
    expect(unknownVoice.status).toBe(400);
    expect(unknownVoice.body).toEqual({ kind: "unknown-voice" });

    expect(opened()).toBe(1);
  });

  it("panel-server mounts /api/tts before the global json parser", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, "../../panel-server.ts"), "utf8");

    const mount = /app\s*\.\s*(\w+)\s*\(\s*["']\/api\/tts["']\s*,\s*mobileAuthMiddleware\s*,\s*authMiddleware\s*,/.exec(
      source,
    );
    const globalParser = /app\s*\.\s*use\s*\(\s*express\s*\.\s*json\s*\(\s*\)\s*\)/.exec(source);

    expect(mount, "the /api/tts mount behind both auth gates").not.toBeNull();
    expect(globalParser, "the global express.json() mount").not.toBeNull();
    expect(mount!.index).toBeLessThan(globalParser!.index);
    // Not `app.use`: a path-scoped `use` strips `/api/tts` from `req.path`, and
    // both gates only 401 paths that start with `/api/`, so they would let
    // every request through.
    expect(mount![1]).not.toBe("use");
  });
});

/** A `Tts` stand-in: `synthesize` answers with this instance's `name` as the engine. */
function fakeTts(name: string, pending?: Promise<void>): Tts & { synthesize: ReturnType<typeof vi.fn> } {
  const synthesize = vi.fn(async (req: SynthesisRequest): Promise<SynthesisResult> => {
    await pending;
    return { bytes: new Uint8Array(AUDIO).buffer, mime: "audio/mpeg", engine: name, voice: req.voice ?? "v" };
  });
  return {
    synthesize,
    prefetch: () => {},
    isCached: () => false,
    state: () => "cold",
    subscribe: () => () => {},
    restartStalled: () => false,
    engineStatus: () => ({ state: "ready" }),
  } as Tts & { synthesize: ReturnType<typeof vi.fn> };
}

/** The production mount over a holder whose instances come from `instances`, in order. */
function loadHolderApp(
  instances: Tts[],
  answerCache?: AnswerAudioCache,
): {
  app: Express;
  holder: TtsHolder;
  opened: () => number;
  usage: ReturnType<typeof fakeUsage>;
} {
  const { transport, opened } = fakeTransport();
  const queue = [...instances];
  const holder = createTtsHolder({ createTts: () => queue.shift()!, resolveKey: () => ({ source: "none" }) });
  const usage = fakeUsage();
  const app = express();
  app.all("/api/tts", mobileAuthMiddleware, authMiddleware, createTtsHandler({ transport, holder, usage, answerCache }));
  app.use(express.json());
  return { app, holder, opened, usage };
}

const CASCADE_BODY = { engine: "cascade", text: "Hello.", lang: "en" };

describe("/api/tts over the Tts holder", () => {
  it("rebuild swaps the instance for the next request", async () => {
    const first = fakeTts("first");
    const second = fakeTts("second");
    const { app, holder, usage } = loadHolderApp([first, second]);

    const before = await request(app).post("/api/tts").set("Cookie", COOKIE).send(CASCADE_BODY);
    expect(before.status).toBe(200);
    expect(before.headers["x-anytts-engine"]).toBe("first");

    holder.rebuild();

    const after = await request(app).post("/api/tts").set("Cookie", COOKIE).send(CASCADE_BODY);
    expect(after.status).toBe(200);
    expect(after.headers["x-anytts-engine"]).toBe("second");
    expect(first.synthesize).toHaveBeenCalledTimes(1);
    expect(second.synthesize).toHaveBeenCalledTimes(1);
    expect(second.synthesize.mock.calls[0]![0]).toMatchObject({ engine: "cascade", text: "Hello.", lang: "en" });
    // Each relay counts through its own instance, under the engine that answered.
    expect(usage.record.mock.calls).toEqual([
      ["first", 6],
      ["second", 6],
    ]);
  });

  it("an in-flight request finishes on the old instance", async () => {
    let release!: () => void;
    const first = fakeTts("first", new Promise<void>((r) => (release = r)));
    const second = fakeTts("second");
    const { app, holder } = loadHolderApp([first, second]);

    const inFlight = request(app).post("/api/tts").set("Cookie", COOKIE).send(CASCADE_BODY).then((r) => r);
    await vi.waitFor(() => expect(first.synthesize).toHaveBeenCalledTimes(1));

    holder.rebuild();
    const next = await request(app).post("/api/tts").set("Cookie", COOKIE).send(CASCADE_BODY);
    expect(next.headers["x-anytts-engine"]).toBe("second");

    release();
    const old = await inFlight;
    expect(old.status).toBe(200);
    expect(old.headers["x-anytts-engine"]).toBe("first");
    expect(second.synthesize).toHaveBeenCalledTimes(1);
  });

  it("edge requests are unchanged", async () => {
    const tts = fakeTts("first");
    const { app, opened, usage } = loadHolderApp([tts]);

    const res = await request(app)
      .post("/api/tts")
      .set("Cookie", COOKIE)
      .send({ text: "Hello there.", voice: VOICE })
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => done(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/mpeg");
    expect([...(res.body as Buffer)]).toEqual(AUDIO);
    expect(opened()).toBe(1);
    expect(tts.synthesize).not.toHaveBeenCalled();
    // The browser reports Edge usage; the relay does not count it.
    expect(usage.record).not.toHaveBeenCalled();

    const unauthenticated = await request(app).post("/api/tts").send(CASCADE_BODY);
    expect(unauthenticated.status).toBe(401);
    expect(tts.synthesize).not.toHaveBeenCalled();
  });

  it("relay POST /api/tts answers a repeated unit from disk", async () => {
    // A tmp-root store, so the test never writes the real ~/.pavilio.
    const root = mkdtempSync(join(tmpdir(), "answer-audio-"));
    try {
      const tts = fakeTts("omnivoice");
      const { app, usage } = loadHolderApp([tts], createAnswerAudioCache({ root }));
      const body = { engine: "omnivoice", text: "Hello again.", voice: "alloy", lang: "en" };
      const send = () =>
        request(app)
          .post("/api/tts")
          .set("Cookie", COOKIE)
          .send(body)
          .buffer(true)
          .parse((r, done) => {
            const chunks: Buffer[] = [];
            r.on("data", (c: Buffer) => chunks.push(c));
            r.on("end", () => done(null, Buffer.concat(chunks)));
          });

      const first = await send();
      expect(first.status).toBe(200);
      // The write is not awaited by the response: wait for the file to land.
      // Audio plus its speaker record beside it.
      await vi.waitFor(() => expect(readdirUnit(root)).toEqual([".mp3", ".speaker.json"]));

      const second = await send();
      expect(second.status).toBe(200);
      expect(second.headers["content-type"]).toBe("audio/mpeg");
      expect(second.headers["x-anytts-engine"]).toBe("omnivoice");
      expect([...(second.body as Buffer)]).toEqual(AUDIO);
      expect(tts.synthesize).toHaveBeenCalledTimes(1);
      expect(usage.record.mock.calls).toEqual([["omnivoice", 12]]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("relay answers a repeated cascade unit from disk naming the member that spoke", async () => {
    const root = mkdtempSync(join(tmpdir(), "answer-audio-"));
    try {
      // The cascade's answer names its member and that member's voice.
      const tts = fakeTts("omnivoice");
      tts.synthesize.mockImplementation(
        async (): Promise<SynthesisResult> => ({
          bytes: new Uint8Array(AUDIO).buffer,
          mime: "audio/mpeg",
          engine: "omnivoice",
          voice: "alloy",
        }),
      );
      const { app } = loadHolderApp([tts], createAnswerAudioCache({ root }));
      const body = {
        ...CASCADE_BODY,
        text: "Cascade again.",
        voices: { omnivoice: "alloy" },
        order: ["omnivoice", "edge"],
      };
      const send = () => request(app).post("/api/tts").set("Cookie", COOKIE).send(body);

      const first = await send();
      expect(first.status).toBe(200);
      await vi.waitFor(() => expect(readdirUnit(root)).toEqual([".mp3", ".speaker.json"]));

      const second = await send();
      expect(second.status).toBe(200);
      expect(tts.synthesize).toHaveBeenCalledTimes(1);
      expect(second.headers["x-anytts-engine"]).toBe(first.headers["x-anytts-engine"]);
      expect(second.headers["x-anytts-voice"]).toBe(first.headers["x-anytts-voice"]);
      expect(second.headers["x-anytts-engine"]).toBe("omnivoice");
      expect(second.headers["x-anytts-voice"]).toBe("alloy");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("relay keys a voice-less unit by the current instance's default voice", async () => {
    const root = mkdtempSync(join(tmpdir(), "answer-audio-"));
    try {
      // Each instance speaks a voice-less request in its own default, as a
      // catalog refresh that rebuilds the holder can change it.
      const speaker = (voice: string) => {
        const tts = fakeTts("omnivoice");
        fakeDefaults.set(tts, voice);
        tts.synthesize.mockImplementation(
          async (req: SynthesisRequest): Promise<SynthesisResult> => ({
            bytes: new Uint8Array(AUDIO).buffer,
            mime: "audio/mpeg",
            engine: "omnivoice",
            voice: req.voices?.omnivoice ?? voice,
          }),
        );
        return tts;
      };
      const first = speaker("alloy");
      const second = speaker("echo");
      const { app, holder } = loadHolderApp([first, second], createAnswerAudioCache({ root }));
      const send = (body: object) => request(app).post("/api/tts").set("Cookie", COOKIE).send(body);
      // The relay refuses a single-engine body without a voice: a voice-less
      // unit is a cascade naming none for its preferred member.
      const voiceless = { ...CASCADE_BODY, text: "Default voice.", order: ["omnivoice"] };

      expect((await send(voiceless)).headers["x-anytts-voice"]).toBe("alloy");
      await vi.waitFor(() => expect(readdirUnit(root)).toEqual([".mp3", ".speaker.json"]));

      // Answered from disk, and so is a request naming that default.
      expect((await send(voiceless)).headers["x-anytts-voice"]).toBe("alloy");
      expect((await send({ ...voiceless, voices: { omnivoice: "alloy" } })).headers["x-anytts-voice"]).toBe("alloy");
      expect(first.synthesize).toHaveBeenCalledTimes(1);

      holder.rebuild();
      expect((await send(voiceless)).headers["x-anytts-voice"]).toBe("echo");
      expect(second.synthesize).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("relay passes a voice-less unit through when the instance has no default for it", async () => {
    const root = mkdtempSync(join(tmpdir(), "answer-audio-"));
    try {
      const tts = fakeTts("omnivoice");
      const { app } = loadHolderApp([tts], createAnswerAudioCache({ root }));
      const body = { ...CASCADE_BODY, text: "No default.", order: ["omnivoice"] };
      const send = () => request(app).post("/api/tts").set("Cookie", COOKIE).send(body);

      expect((await send()).status).toBe(200);
      expect((await send()).status).toBe(200);
      expect(tts.synthesize).toHaveBeenCalledTimes(2);
      expect(readdirUnit(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/** The extensions of the store's unit files (no temp files), sorted. */
function readdirUnit(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => /^[0-9a-f]{64}\./.test(name))
    .map((name) => name.slice(64))
    .sort();
}
