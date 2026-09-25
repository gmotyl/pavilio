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
import { createContext, runInContext, runInNewContext } from "node:vm";

import { answerWaveDebounceMs } from "../../../src/features/terminal/answerWaveDebounce.js";

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

/**
 * The SEAM, end to end: environment → the served document → the accessor the
 * browser actually calls.
 *
 * Everything above stops one step short of it. The document's own key is read
 * by hand — `window.__PAVILIO_TUNING__` spelled a third time, here in the
 * test — so the name is a bare string literal in three places (the route, the
 * client leaf, and this file) with nothing crossing between them. Rename it on
 * one side, or typo it, and both suites still pass while the real panel
 * silently falls back to the default forever: the client would read `undefined`
 * from a global nobody assigns, which is a legitimate case it is built to
 * survive quietly.
 *
 * So this case names the key NOWHERE. It evaluates the served body in a context
 * whose `window` IS its `globalThis` — the browser's arrangement, which is why
 * the route may assign through `window` and the leaf read through `globalThis`
 * — then republishes whatever globals that body created onto this realm and
 * asks the real `answerWaveDebounceMs()`. Whatever the two sides call the
 * thing, they have to call it the same.
 */
async function debounceAsTheClientReadsIt(raw?: string): Promise<number> {
  if (raw === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = raw;

  vi.resetModules();
  const { default: preferencesRouter } = await import("../preferences.js");
  const app = express();
  app.use("/api", preferencesRouter);
  const res = await request(app).get("/api/preferences.js");
  expect(res.status).toBe(200);

  const context = createContext({});
  // A page's `window` and its `globalThis` are the same object. Set BEFORE the
  // snapshot, so it is not mistaken for something the document assigned.
  runInContext("globalThis.window = globalThis;", context);
  const before = new Set(Object.getOwnPropertyNames(context));
  runInContext(res.text, context);
  const assigned = Object.getOwnPropertyNames(context).filter((key) => !before.has(key));

  // The document's globals, on this realm's `globalThis` under the names the
  // SERVER chose — not names this file chose.
  const globals = globalThis as Record<string, unknown>;
  const restore = assigned.map((key) => [key, globals[key]] as const);
  for (const key of assigned) globals[key] = (context as Record<string, unknown>)[key];
  try {
    return answerWaveDebounceMs();
  } finally {
    for (const [key, previous] of restore) {
      if (previous === undefined) delete globals[key];
      else globals[key] = previous;
    }
  }
}

describe("the debounce the client reads off the document the server served", () => {
  it("carries a configured value across the global the two sides share", async () => {
    // The one assertion that fails on a typo in either spelling of the key.
    expect(await debounceAsTheClientReadsIt("500")).toBe(500);
  });

  it("answers with the default for an absent or malformed setting", async () => {
    // An absent variable is the ordinary case, and it is the case a broken
    // seam IMITATES — so it is asserted alongside the one above rather than
    // instead of it: on its own it would pass no matter what the key is called.
    expect(await debounceAsTheClientReadsIt(undefined)).toBe(3000);
    expect(await debounceAsTheClientReadsIt("abc")).toBe(3000);
    expect(await debounceAsTheClientReadsIt("0")).toBe(3000);
    expect(await debounceAsTheClientReadsIt("-1")).toBe(3000);
    expect(await debounceAsTheClientReadsIt("")).toBe(3000);
  });
});
