// The tuning knobs that ride the boot document.
//
// `GET /api/preferences.js` is the panel's one parser-blocking script, so it is
// also the one place a server-side value can reach the browser BEFORE React
// mounts and without a rebuild. The answer-wave debounce travels there rather
// than through a `VITE_*` variable for exactly that reason: changing it is an
// env var plus a panel restart, never `pnpm build`.
//
// Every case below boots a FRESH module graph, because `panel.config.ts` reads
// the environment once at import — which is precisely the behaviour under test,
// and the reason the knob needs a restart rather than a reload.

import { describe, it, expect, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { runInNewContext } from "node:vm";

// The route's only side effect beyond the store is the WS fan-out.
const { broadcast } = vi.hoisted(() => ({ broadcast: vi.fn() }));
vi.mock("../../watcher", () => ({ broadcast }));

const ENV_KEY = "PAVILIO_ANSWER_WAVE_DEBOUNCE_MS";
const ORIGINAL = process.env[ENV_KEY];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = ORIGINAL;
  // The next case must not inherit this one's config module.
  vi.resetModules();
});

/**
 * Serve the boot document with the environment as it stands right now, and
 * hand back what it assigned — evaluated the way a browser would, so a body
 * that is not parseable JavaScript throws here rather than passing quietly.
 */
async function bootDocument(): Promise<Record<string, unknown>> {
  vi.resetModules();
  const { default: preferencesRouter } = await import("../preferences.js");
  const app = express();
  app.use("/api", preferencesRouter);

  const res = await request(app).get("/api/preferences.js");
  expect(res.status).toBe(200);

  const window: Record<string, unknown> = {};
  runInNewContext(res.text, { window });
  return window;
}

/** The debounce as the browser would read it off the document. */
async function servedDebounceMs(raw?: string): Promise<unknown> {
  if (raw === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = raw;

  const window = await bootDocument();
  const tuning = window.__PAVILIO_TUNING__ as { answerWaveDebounceMs?: unknown } | undefined;
  return tuning?.answerWaveDebounceMs;
}

describe("the answer-wave debounce on the boot document", () => {
  it("defaults to 3000 when the environment sets nothing", async () => {
    expect(await servedDebounceMs(undefined)).toBe(3000);
  });

  it("takes a positive integer from the environment", async () => {
    expect(await servedDebounceMs("500")).toBe(500);
  });

  it("falls back to the default for a non-numeric value", async () => {
    expect(await servedDebounceMs("abc")).toBe(3000);
    // An empty (or blank) variable is the shape a shell leaves behind after
    // `PAVILIO_ANSWER_WAVE_DEBOUNCE_MS=` — `Number("")` is 0, not NaN, so it
    // only lands on the default because the guard rejects non-positives too.
    expect(await servedDebounceMs("")).toBe(3000);
  });

  it("falls back to the default for zero and for a negative value", async () => {
    // Both are the dangerous half of the range: zero would make the debounce a
    // no-op and revive the reattach false positive, and a negative delay is not
    // a delay at all.
    expect(await servedDebounceMs("0")).toBe(3000);
    expect(await servedDebounceMs("-1")).toBe(3000);
  });
});
