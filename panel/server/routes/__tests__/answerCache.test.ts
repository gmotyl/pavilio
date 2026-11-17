import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";

// `lib/auth.ts` reads PANEL_TOKEN once, at module load, so the token has to be
// in the environment before that module is imported (vi.hoisted runs first).
const { TOKEN, previousToken } = vi.hoisted(() => {
  const previousToken = process.env.PANEL_TOKEN;
  process.env.PANEL_TOKEN = "answer-cache-test-token";
  return { TOKEN: "answer-cache-test-token", previousToken };
});

import { authMiddleware } from "../../lib/auth";
import { mobileAuthMiddleware } from "../../middleware/mobile-auth";
import { ANSWER_CACHE_TTL_MS, createAnswerAudioCache, type AnswerAudioCache } from "../../lib/speech/answerAudioCache";
import { ANSWER_SUBDIR } from "../../lib/speech/pageCache";
import { createAnswerCacheRouter, runStartupSweep } from "../answerCache";

afterAll(() => {
  if (previousToken === undefined) delete process.env.PANEL_TOKEN;
  else process.env.PANEL_TOKEN = previousToken;
});

const COOKIE = `panel_token=${TOKEN}`;
const BASE = "/api/speech/answer-cache";
const PAGE = "a".repeat(64);

let dir: string;
let speechRoot: string;
let answersRoot: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "panel-answer-cache-"));
  speechRoot = join(dir, "speech-cache");
  answersRoot = join(speechRoot, ANSWER_SUBDIR);
  vi.stubEnv("PANEL_AUTH_STATE_DIR", dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** Mirrors the production mount: the speech JSON parser, then the global parser and both auth gates. */
function loadApp(cache: AnswerAudioCache): Express {
  const app = express();
  app.use("/api/speech", express.json({ limit: "64kb" }));
  app.use(express.json());
  app.use(mobileAuthMiddleware);
  app.use(authMiddleware);
  app.use(BASE, createAnswerCacheRouter({ cache }));
  return app;
}

/** Page audio and answer audio side by side, as on disk in production. */
function seed(): void {
  mkdirSync(join(speechRoot, PAGE), { recursive: true });
  writeFileSync(join(speechRoot, PAGE, `${"b".repeat(64)}.mp3`), "page audio");
  mkdirSync(answersRoot, { recursive: true });
  writeFileSync(join(answersRoot, "one.mp3"), "answer one");
  writeFileSync(join(answersRoot, "two.mp3"), "answer two");
}

describe("answer cache route", () => {
  it("DELETE clears answer audio and leaves page audio", async () => {
    seed();
    const app = loadApp(createAnswerAudioCache({ root: answersRoot }));

    const res = await request(app).delete(BASE).set("Cookie", COOKIE);

    expect(res.status).toBe(204);
    expect(readdirSync(answersRoot)).toEqual([]);
    expect(readFileSync(join(speechRoot, PAGE, `${"b".repeat(64)}.mp3`), "utf8")).toBe("page audio");
  });

  it("DELETE without auth is refused", async () => {
    seed();
    const app = loadApp(createAnswerAudioCache({ root: answersRoot }));

    expect((await request(app).delete(BASE)).status).toBe(401);
    expect(readdirSync(answersRoot).sort()).toEqual(["one.mp3", "two.mp3"]);
  });

  it("DELETE answers 503 with the reason when clearing fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = createAnswerAudioCache({ root: answersRoot });
    vi.spyOn(cache, "clear").mockRejectedValue(new Error("EACCES: permission denied"));
    const app = loadApp(cache);

    const res = await request(app).delete(BASE).set("Cookie", COOKIE);

    expect(res.status).toBe(503);
    // Just the reason: Settings adds "Couldn't clear answer audio: " in front.
    expect(res.body.error).toBe("EACCES: permission denied");
  });
});

describe("startup sweep", () => {
  it("startup sweep logs removed and kept totals", async () => {
    const now = Date.now();
    mkdirSync(answersRoot, { recursive: true });
    const old = join(answersRoot, "old.mp3");
    writeFileSync(old, Buffer.alloc(3 * 1024 * 1024));
    const stale = (now - ANSWER_CACHE_TTL_MS - 60_000) / 1000;
    utimesSync(old, stale, stale);
    writeFileSync(join(answersRoot, "fresh-1.mp3"), Buffer.alloc(1024 * 1024));
    writeFileSync(join(answersRoot, "fresh-2.mp3"), Buffer.alloc(512 * 1024));
    const log = vi.fn();

    await runStartupSweep(createAnswerAudioCache({ root: answersRoot, now: () => now }), log);

    expect(existsSync(old)).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("[answer-cache] swept: removed 1 files (3.0 MB), kept 2 files (1.5 MB)");
  });
});
