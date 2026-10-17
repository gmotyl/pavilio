import { describe, it, expect, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import type { EdgeEngineOptions } from "anytts";

// `lib/auth.ts` reads PANEL_TOKEN once, at module load, so the token has to be
// in the environment before that module is imported (vi.hoisted runs first).
const { TOKEN, previousToken } = vi.hoisted(() => {
  const previousToken = process.env.PANEL_TOKEN;
  process.env.PANEL_TOKEN = "tts-test-token";
  return { TOKEN: "tts-test-token", previousToken };
});

import { authMiddleware } from "../../lib/auth";
import { mobileAuthMiddleware } from "../../middleware/mobile-auth";
import { createTtsHandler } from "../tts";

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
  app.all("/api/tts", mobileAuthMiddleware, authMiddleware, createTtsHandler({ transport }));
  app.use(express.json());
  return { app, opened };
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
