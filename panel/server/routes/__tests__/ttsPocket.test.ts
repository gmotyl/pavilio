import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

// `lib/auth.ts` reads PANEL_TOKEN once, at module load.
const { TOKEN, previousToken } = vi.hoisted(() => {
  const previousToken = process.env.PANEL_TOKEN;
  process.env.PANEL_TOKEN = "tts-pocket-test-token";
  return { TOKEN: "tts-pocket-test-token", previousToken };
});

import { authMiddleware } from "../../lib/auth";
import { mobileAuthMiddleware } from "../../middleware/mobile-auth";
import { createTtsHandler } from "../tts";
import { createTtsHolder } from "../../lib/speech/ttsHolder";
import type { UsageStore } from "../../lib/speech/usage-store";

afterAll(() => {
  if (previousToken === undefined) delete process.env.PANEL_TOKEN;
  else process.env.PANEL_TOKEN = previousToken;
});
afterEach(() => vi.unstubAllGlobals());

/** A 16-bit mono PCM WAV of silence, as the Pocket server streams it. */
function silentWav(samples = 2400, rate = 24000): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const tag = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, samples * 2, true);
  return buf;
}

describe("/api/tts relay, pocket engine", () => {
  it("a pocket request answers audio/mpeg from the pocket server", async () => {
    const fetchMock = vi.fn(async () => new Response(silentWav(), { headers: { "content-type": "audio/wav" } }));
    vi.stubGlobal("fetch", fetchMock);
    const holder = createTtsHolder({
      resolveKey: (name) =>
        name === "POCKET_TTS_BASE_URL" ? { value: "http://127.0.0.1:8890", source: "file" } : { source: "none" },
    });
    const usage: UsageStore = { record: vi.fn(async () => {}), readAll: vi.fn(async () => []) };
    const app = express();
    app.all("/api/tts", mobileAuthMiddleware, authMiddleware, createTtsHandler({ holder, usage }));

    const res = await request(app)
      .post("/api/tts")
      .set("Cookie", `panel_token=${TOKEN}`)
      .send({ engine: "pocket", text: "Hello there.", voice: "alba" })
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => done(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/mpeg");
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as [unknown, RequestInit][];
    expect(String(calls[0]![0])).toBe("http://127.0.0.1:8890/tts");
    const form = calls[0]![1].body as FormData;
    expect(form.get("text")).toBe("Hello there.");
    expect(form.get("voice_url")).toBe("alba");
  });
});
