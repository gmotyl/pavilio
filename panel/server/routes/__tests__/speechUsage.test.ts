import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// `lib/auth.ts` reads PANEL_TOKEN once, at module load, so the token has to be
// in the environment before that module is imported (vi.hoisted runs first).
const { TOKEN, previousToken } = vi.hoisted(() => {
  const previousToken = process.env.PANEL_TOKEN;
  process.env.PANEL_TOKEN = "speech-usage-test-token";
  return { TOKEN: "speech-usage-test-token", previousToken };
});

import { authMiddleware } from "../../lib/auth";
import { mobileAuthMiddleware } from "../../middleware/mobile-auth";
import type { UsageMonth, UsageStore } from "../../lib/speech/usage-store";
import { createSpeechUsageRouter } from "../speechUsage";

afterAll(() => {
  if (previousToken === undefined) delete process.env.PANEL_TOKEN;
  else process.env.PANEL_TOKEN = previousToken;
});

const COOKIE = `panel_token=${TOKEN}`;

function fakeStore(months: UsageMonth[] = []) {
  return {
    record: vi.fn<UsageStore["record"]>(async () => {}),
    readAll: vi.fn<UsageStore["readAll"]>(async () => months),
  };
}

/** Mirrors the production mount: global parser and both auth gates ahead of the router. */
function loadApp(store: UsageStore): Express {
  const app = express();
  app.use(express.json());
  app.use(mobileAuthMiddleware);
  app.use(authMiddleware);
  app.use("/api/speech", createSpeechUsageRouter({ store }));
  return app;
}

describe("/api/speech/usage", () => {
  it("POST records a valid report and answers 204", async () => {
    const store = fakeStore();
    const res = await request(loadApp(store))
      .post("/api/speech/usage")
      .set("Cookie", COOKIE)
      .send({ engine: "edge", chars: 42 });

    expect(res.status).toBe(204);
    expect(store.record).toHaveBeenCalledTimes(1);
    expect(store.record).toHaveBeenCalledWith("edge", 42);
  });

  it("POST rejects a missing or malformed engine, or non-positive chars, with 400", async () => {
    const store = fakeStore();
    const app = loadApp(store);
    const bodies: unknown[] = [
      { chars: 42 },
      { engine: "", chars: 42 },
      { engine: 7, chars: 42 },
      // Engine ids are bounded: lowercase letters, digits and dashes, at most 32.
      { engine: "a".repeat(33), chars: 42 },
      { engine: "Edge", chars: 42 },
      { engine: "../x", chars: 42 },
      { engine: "edge ", chars: 42 },
      { engine: "edge" },
      { engine: "edge", chars: 0 },
      { engine: "edge", chars: -5 },
      { engine: "edge", chars: 2.5 },
      { engine: "edge", chars: "42" },
    ];
    for (const body of bodies) {
      const res = await request(app).post("/api/speech/usage").set("Cookie", COOKIE).send(body as object);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(typeof res.body.error).toBe("string");
    }
    expect(store.record).not.toHaveBeenCalled();
  });

  it("GET returns the store's months", async () => {
    const months: UsageMonth[] = [
      { month: "2026-10", engines: { edge: 1500, azure: 200 }, total: 1700 },
      { month: "2026-09", engines: { edge: 10 }, total: 10 },
    ];
    const store = fakeStore(months);
    const res = await request(loadApp(store)).get("/api/speech/usage").set("Cookie", COOKIE);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ months });
  });

  it("POST answers 500 when the store cannot record", async () => {
    const store = fakeStore();
    store.record.mockRejectedValueOnce(new Error("EIO: i/o error"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(loadApp(store))
      .post("/api/speech/usage")
      .set("Cookie", COOKIE)
      .send({ engine: "edge", chars: 42 });

    expect(res.status).toBe(500);
    expect(typeof res.body.error).toBe("string");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("POST accepts every bounded engine id up to 32 characters", async () => {
    const store = fakeStore();
    const app = loadApp(store);
    for (const engine of ["cascade", "elevenlabs", "a".repeat(32), "x-1"]) {
      const res = await request(app).post("/api/speech/usage").set("Cookie", COOKIE).send({ engine, chars: 1 });
      expect(res.status, engine).toBe(204);
    }
    expect(store.record).toHaveBeenCalledTimes(4);
  });

  it("GET answers 500 when the store cannot read", async () => {
    const store = fakeStore();
    store.readAll.mockRejectedValueOnce(new Error("EIO: i/o error"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(loadApp(store)).get("/api/speech/usage").set("Cookie", COOKIE);

    expect(res.status).toBe(500);
    expect(typeof res.body.error).toBe("string");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("refuses requests without panel auth", async () => {
    const store = fakeStore();
    const app = loadApp(store);

    expect((await request(app).get("/api/speech/usage")).status).toBe(401);
    expect((await request(app).post("/api/speech/usage").send({ engine: "edge", chars: 42 })).status).toBe(401);
    expect(store.record).not.toHaveBeenCalled();
    expect(store.readAll).not.toHaveBeenCalled();
  });

  it("the production file mounts the router behind auth, sharing the TTS handler's store", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, "../../panel-server.ts"), "utf8");
    const parser = /app\s*\.\s*use\s*\(\s*express\s*\.\s*json\s*\(\s*\)\s*\)/.exec(source);
    const mobileGate = /app\s*\.\s*use\s*\(\s*mobileAuthMiddleware\s*\)/.exec(source);
    const gate = /app\s*\.\s*use\s*\(\s*authMiddleware\s*\)/.exec(source);
    const mount =
      /app\s*\.\s*use\s*\(\s*["']\/api\/speech["']\s*,\s*createSpeechUsageRouter\s*\(\s*\{\s*store\s*:\s*usageStore\s*\}\s*\)\s*\)/.exec(
        source,
      );
    expect(parser, "the global express.json() mount").not.toBeNull();
    expect(mobileGate, "the global mobileAuthMiddleware mount").not.toBeNull();
    expect(gate, "the global authMiddleware mount").not.toBeNull();
    expect(mount, "the speech usage router mount").not.toBeNull();
    expect(mount!.index).toBeGreaterThan(parser!.index);
    expect(mount!.index).toBeGreaterThan(mobileGate!.index);
    expect(mount!.index).toBeGreaterThan(gate!.index);

    // One store for the server: the relay's counting and the browser's reports
    // share its record chain.
    expect(source.match(/createUsageStore\s*\(/g), "one createUsageStore() call").toHaveLength(1);
    expect(source).toMatch(/const\s+usageStore\s*=\s*createUsageStore\s*\(/);
    expect(source).toMatch(/createTtsHandler\s*\(\s*\{[^}]*\busage\s*:\s*usageStore\b[^}]*\}\s*\)/);
  });
});
