import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import request from "supertest";

// `lib/auth.ts` reads PANEL_TOKEN once, at module load, so the token has to be
// in the environment before that module is imported (vi.hoisted runs first).
const { TOKEN, previousToken } = vi.hoisted(() => {
  const previousToken = process.env.PANEL_TOKEN;
  process.env.PANEL_TOKEN = "page-cache-test-token";
  return { TOKEN: "page-cache-test-token", previousToken };
});

import { authMiddleware } from "../../lib/auth";
import { mobileAuthMiddleware } from "../../middleware/mobile-auth";
import { createPageCacheStore, type PageCacheStore } from "../../lib/speech/pageCache";
import { createPageCacheRouter } from "../pageCache";

afterAll(() => {
  if (previousToken === undefined) delete process.env.PANEL_TOKEN;
  else process.env.PANEL_TOKEN = previousToken;
});

const COOKIE = `panel_token=${TOKEN}`;
const BASE = "/api/speech/page-cache";
const PAGE = "a".repeat(64);
const UNIT = "b".repeat(64);
const OTHER = "c".repeat(64);
const DOC_KEY = "doc:pavilio/notes/a.md";
const MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x44, 0x00, 0x01, 0x02, 0x03]);

let dir: string;
let root: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "panel-page-cache-"));
  root = join(dir, "speech-cache");
  vi.stubEnv("PANEL_AUTH_STATE_DIR", dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** The store behind the last {@link loadApp}, so {@link put} can name its current epoch. */
let currentStore: PageCacheStore;

/** Mirrors the production mount: the speech JSON parser, then the global parser and both auth gates. */
function loadApp(cacheRoot = root): Express {
  const app = express();
  currentStore = createPageCacheStore({ root: cacheRoot });
  app.use("/api/speech", express.json({ limit: "64kb" }));
  app.use(express.json());
  app.use(mobileAuthMiddleware);
  app.use(authMiddleware);
  app.use(BASE, createPageCacheRouter({ store: currentStore }));
  return app;
}

/** A PUT carrying the page's current epoch unless `epoch` says otherwise (`null` omits the header). */
function put(
  app: Express,
  page: string,
  unit: string,
  body: Buffer,
  docKey: string | null = DOC_KEY,
  epoch: string | null = currentStore.epoch(page),
) {
  const req = request(app)
    .put(`${BASE}/${page}/${unit}`)
    .set("Cookie", COOKIE)
    .set("Content-Type", "audio/mpeg");
  if (docKey !== null) req.set("x-doc-key", docKey);
  if (epoch !== null) req.set("x-cache-epoch", epoch);
  return req.send(body);
}

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

async function totals(app: Express) {
  const res = await request(app).get(BASE).set("Cookie", COOKIE);
  expect(res.status).toBe(200);
  return res.body as { pages: number; units: number; bytes: number };
}

describe("/api/speech/page-cache", () => {
  it("put then get returns the mp3", async () => {
    const app = loadApp();
    expect((await put(app, PAGE, UNIT, MP3)).status).toBe(204);

    const res = await request(app)
      .get(`${BASE}/${PAGE}/${UNIT}`)
      .set("Cookie", COOKIE)
      .buffer(true)
      .parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^audio\/mpeg/);
    expect(Buffer.compare(res.body as Buffer, MP3)).toBe(0);

    // The docKey lands in page.json; no temp file is left behind.
    expect(JSON.parse(readFileSync(join(root, PAGE, "page.json"), "utf8"))).toMatchObject({ docKey: DOC_KEY });
    expect(readdirSync(join(root, PAGE)).filter((n) => n.includes(".tmp-"))).toEqual([]);

    const list = await request(app).get(`${BASE}/${PAGE}`).set("Cookie", COOKIE);
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ units: [{ hash: UNIT, bytes: MP3.length }], seq: 1 });

    // Any body type is accepted as raw bytes.
    const octet = await request(app)
      .put(`${BASE}/${PAGE}/${OTHER}`)
      .set("Cookie", COOKIE)
      .set("x-doc-key", DOC_KEY)
      .set("x-cache-epoch", currentStore.epoch(PAGE))
      .set("Content-Type", "application/octet-stream")
      .send(MP3);
    expect(octet.status).toBe(204);
  });

  it("an encoded doc key is stored decoded", async () => {
    // The browser percent-encodes x-doc-key, since fetch rejects non-Latin-1 header values.
    const app = loadApp();
    const docKey = "doc:notatki/żółw.md";
    expect((await put(app, PAGE, UNIT, MP3, encodeURIComponent(docKey))).status).toBe(204);
    expect(JSON.parse(readFileSync(join(root, PAGE, "page.json"), "utf8"))).toMatchObject({ docKey });

    // A malformed escape is refused and nothing is written.
    expect((await put(app, PAGE, OTHER, MP3, "doc%E0%A4%A")).status).toBe(400);
    expect(await totals(app)).toEqual({ pages: 1, units: 1, bytes: MP3.length });
  });

  it("get of an absent unit is 404", async () => {
    const app = loadApp();
    expect((await request(app).get(`${BASE}/${PAGE}/${UNIT}`).set("Cookie", COOKIE)).status).toBe(404);

    // An unknown page lists as empty rather than 404.
    const list = await request(app).get(`${BASE}/${PAGE}`).set("Cookie", COOKIE);
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ units: [], seq: 0 });
  });

  it("non-hex ids answer 400", async () => {
    const app = loadApp();
    const bad = ["A".repeat(64), "a".repeat(63), "g".repeat(64), "%2e%2e%2fetc"];
    for (const id of bad) {
      expect((await request(app).get(`${BASE}/${id}`).set("Cookie", COOKIE)).status, id).toBe(400);
      expect((await request(app).get(`${BASE}/${PAGE}/${id}`).set("Cookie", COOKIE)).status, id).toBe(400);
      expect((await request(app).get(`${BASE}/${id}/${UNIT}`).set("Cookie", COOKIE)).status, id).toBe(400);
      expect((await put(app, id, UNIT, MP3)).status, id).toBe(400);
      expect((await put(app, PAGE, id, MP3)).status, id).toBe(400);
      expect(
        (await request(app).post(`${BASE}/${id}/prune`).set("Cookie", COOKIE).send({ keep: [] })).status,
        id,
      ).toBe(400);
      expect((await request(app).delete(`${BASE}/${id}`).set("Cookie", COOKIE)).status, id).toBe(400);
    }

    // A PUT without a docKey, an epoch or a body is refused too.
    expect((await put(app, PAGE, UNIT, MP3, DOC_KEY, null)).status).toBe(400);
    expect((await put(app, PAGE, UNIT, MP3, null)).status).toBe(400);
    expect((await put(app, PAGE, UNIT, MP3, "")).status).toBe(400);
    expect((await put(app, PAGE, UNIT, Buffer.alloc(0))).status).toBe(400);
    // A prune without a string array, a seq or an epoch is refused.
    const epoch = currentStore.epoch(PAGE);
    for (const body of [{}, { keep: "x", seq: 0 }, { keep: [1], seq: 0 }, { keep: [] }, { keep: [], seq: -1 }, { keep: [], seq: 1.5 }, { keep: [], seq: "1" }]) {
      const res = await request(app).post(`${BASE}/${PAGE}/prune`).set("Cookie", COOKIE).set("x-cache-epoch", epoch).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await request(app).post(`${BASE}/${PAGE}/prune`).set("Cookie", COOKIE).send({ keep: [], seq: 0 })).status).toBe(400);
    expect(await totals(app)).toEqual({ pages: 0, units: 0, bytes: 0 });
  });

  it("an oversized put answers 413", async () => {
    const app = loadApp();
    const res = await put(app, PAGE, UNIT, Buffer.alloc(5 * 1024 * 1024 + 1, 1));
    expect(res.status).toBe(413);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(await totals(app)).toEqual({ pages: 0, units: 0, bytes: 0 });

    // Exactly 5 MB is still accepted.
    expect((await put(app, PAGE, UNIT, Buffer.alloc(5 * 1024 * 1024, 1))).status).toBe(204);
  });

  it("a put aborted mid-body never writes", async () => {
    const store = createPageCacheStore({ root });
    const write = vi.spyOn(store, "write");
    const app = express();
    app.use(express.json());
    app.use(mobileAuthMiddleware);
    app.use(authMiddleware);
    app.use(BASE, createPageCacheRouter({ store }));
    const server = createServer(app);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const { port } = server.address() as AddressInfo;
      const socket = connect(port, "127.0.0.1");
      await new Promise<void>((done) => socket.once("connect", done));
      // Announces 100 bytes, sends 8, then hangs up — as a client abort does.
      socket.write(
        `PUT ${BASE}/${PAGE}/${UNIT} HTTP/1.1\r\nHost: localhost\r\nCookie: ${COOKIE}\r\n` +
          `Content-Type: audio/mpeg\r\nx-doc-key: ${encodeURIComponent(DOC_KEY)}\r\nContent-Length: 100\r\n\r\n`,
      );
      socket.write(MP3);
      await new Promise((done) => setTimeout(done, 50));
      socket.destroy();
      await new Promise((done) => setTimeout(done, 100));

      expect(write).not.toHaveBeenCalled();
      expect(await store.totals()).toEqual({ pages: 0, units: 0, bytes: 0 });
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it("every unit and listing GET carries the current epoch", async () => {
    const app = loadApp();
    const miss = await request(app).get(`${BASE}/${PAGE}/${UNIT}`).set("Cookie", COOKIE);
    expect(miss.status).toBe(404);
    const epoch = miss.headers["x-cache-epoch"];
    expect(epoch).toBe(currentStore.epoch(PAGE));

    expect((await put(app, PAGE, UNIT, MP3, DOC_KEY, epoch)).status).toBe(204);
    const hit = await request(app).get(`${BASE}/${PAGE}/${UNIT}`).set("Cookie", COOKIE);
    expect(hit.status).toBe(200);
    expect(hit.headers["x-cache-epoch"]).toBe(epoch);
    const list = await request(app).get(`${BASE}/${PAGE}`).set("Cookie", COOKIE);
    expect(list.headers["x-cache-epoch"]).toBe(epoch);

    // A clear moves the page to a new epoch; the old one now answers 409 and writes nothing.
    expect((await request(app).delete(`${BASE}/${PAGE}`).set("Cookie", COOKIE)).status).toBe(204);
    const after = await request(app).get(`${BASE}/${PAGE}/${UNIT}`).set("Cookie", COOKIE);
    expect(after.headers["x-cache-epoch"]).not.toBe(epoch);
    expect((await put(app, PAGE, UNIT, MP3, DOC_KEY, epoch)).status).toBe(409);
    expect(await totals(app)).toEqual({ pages: 0, units: 0, bytes: 0 });
  });

  for (const fence of ["clear", "wipe"] as const) {
    it(`a put whose body completes after a ${fence} answered is refused with 409`, async () => {
      const store = createPageCacheStore({ root });
      const app = express();
      app.use(express.json());
      app.use(mobileAuthMiddleware);
      app.use(authMiddleware);
      app.use(BASE, createPageCacheRouter({ store }));
      const server = createServer(app);
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      try {
        const { port } = server.address() as AddressInfo;
        const miss = await request(server).get(`${BASE}/${PAGE}/${UNIT}`).set("Cookie", COOKIE);
        const epoch = String(miss.headers["x-cache-epoch"]);

        // The PUT's headers and half its body are out — a proxy holding the
        // upload, or a slow body — when the clear (or wipe) lands.
        const socket = connect(port, "127.0.0.1");
        await new Promise<void>((done) => socket.once("connect", done));
        const answer = new Promise<string>((done) => {
          let text = "";
          socket.on("data", (c: Buffer) => {
            text += c.toString("latin1");
            if (text.includes("\r\n\r\n")) done(text);
          });
        });
        socket.write(
          `PUT ${BASE}/${PAGE}/${UNIT} HTTP/1.1\r\nHost: localhost\r\nCookie: ${COOKIE}\r\n` +
            `Content-Type: audio/mpeg\r\nx-doc-key: ${encodeURIComponent(DOC_KEY)}\r\n` +
            `x-cache-epoch: ${epoch}\r\nContent-Length: ${MP3.length}\r\nConnection: close\r\n\r\n`,
        );
        socket.write(MP3.subarray(0, 4));
        await new Promise((done) => setTimeout(done, 50));

        const deleted = await request(server)
          .delete(fence === "clear" ? `${BASE}/${PAGE}` : BASE)
          .set("Cookie", COOKIE);
        expect(deleted.status).toBeLessThan(300);

        // The rest of the body arrives after the delete answered.
        socket.write(MP3.subarray(4));
        expect(await answer).toMatch(/^HTTP\/1\.1 409 /);
        socket.destroy();

        expect(await store.totals()).toEqual({ pages: 0, units: 0, bytes: 0 });
      } finally {
        await new Promise<void>((done) => server.close(() => done()));
      }
    });
  }

  it("prune deletes units not in keep", async () => {
    const app = loadApp();
    await put(app, PAGE, UNIT, MP3);
    await put(app, PAGE, OTHER, MP3);

    const seen = await request(app).get(`${BASE}/${PAGE}`).set("Cookie", COOKIE);
    const res = await request(app)
      .post(`${BASE}/${PAGE}/prune`)
      .set("Cookie", COOKIE)
      .set("x-cache-epoch", seen.headers["x-cache-epoch"])
      .send({ keep: [UNIT], seq: seen.body.seq });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removed: 1 });

    const list = await request(app).get(`${BASE}/${PAGE}`).set("Cookie", COOKIE);
    expect(list.body).toEqual({ units: [{ hash: UNIT, bytes: MP3.length }], seq: 2 });
  });

  it("a prune that reaches the server late leaves the units written after its listing", async () => {
    const app = loadApp();
    const page2 = "d".repeat(64);
    await put(app, PAGE, UNIT, MP3);
    await put(app, PAGE, OTHER, MP3);
    // Revision A lists the page and decides to keep only UNIT…
    const seen = await request(app).get(`${BASE}/${PAGE}`).set("Cookie", COOKIE);
    // …but before its prune arrives, revision B uploads a unit A never saw.
    await put(app, PAGE, page2, MP3);

    const res = await request(app)
      .post(`${BASE}/${PAGE}/prune`)
      .set("Cookie", COOKIE)
      .set("x-cache-epoch", seen.headers["x-cache-epoch"])
      .send({ keep: [UNIT], seq: seen.body.seq });
    expect(res.body).toEqual({ removed: 1 });
    const list = await request(app).get(`${BASE}/${PAGE}`).set("Cookie", COOKIE);
    expect((list.body.units as { hash: string }[]).map((u) => u.hash).sort()).toEqual([UNIT, page2]);

    // A prune whose listing predates a clear is refused outright.
    await request(app).delete(`${BASE}/${PAGE}`).set("Cookie", COOKIE);
    await put(app, PAGE, OTHER, MP3);
    const stale = await request(app)
      .post(`${BASE}/${PAGE}/prune`)
      .set("Cookie", COOKIE)
      .set("x-cache-epoch", seen.headers["x-cache-epoch"])
      .send({ keep: [], seq: seen.body.seq });
    expect(stale.status).toBe(409);
    expect(await totals(app)).toEqual({ pages: 1, units: 1, bytes: MP3.length });
  });

  it("delete page and wipe report through totals", async () => {
    const app = loadApp();
    const page2 = "d".repeat(64);
    await put(app, PAGE, UNIT, MP3);
    await put(app, PAGE, OTHER, MP3);
    await put(app, page2, UNIT, MP3);
    expect(await totals(app)).toEqual({ pages: 2, units: 3, bytes: 3 * MP3.length });

    expect((await request(app).delete(`${BASE}/${PAGE}`).set("Cookie", COOKIE)).status).toBe(204);
    expect(await totals(app)).toEqual({ pages: 1, units: 1, bytes: MP3.length });

    const wipe = await request(app).delete(BASE).set("Cookie", COOKIE);
    expect(wipe.status).toBe(200);
    expect(wipe.body).toEqual({ pages: 1, units: 1, bytes: MP3.length });
    expect(await totals(app)).toEqual({ pages: 0, units: 0, bytes: 0 });
  });

  it("unwritable root answers 503", async () => {
    // A regular file where the root should be: mkdir under it fails (ENOTDIR).
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a directory");
    const app = loadApp(join(blocker, "speech-cache"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect((await put(app, PAGE, UNIT, MP3)).status).toBe(503);
    expect((await put(app, PAGE, OTHER, MP3)).status).toBe(503);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/page cache/i);
  });

  it("page-cache routes require auth", async () => {
    const app = loadApp();
    const calls = [
      request(app).get(BASE),
      request(app).delete(BASE),
      request(app).get(`${BASE}/${PAGE}`),
      request(app).get(`${BASE}/${PAGE}/${UNIT}`),
      request(app).put(`${BASE}/${PAGE}/${UNIT}`).set("x-doc-key", DOC_KEY).set("Content-Type", "audio/mpeg").send(MP3),
      request(app).post(`${BASE}/${PAGE}/prune`).send({ keep: [] }),
      request(app).delete(`${BASE}/${PAGE}`),
    ];
    for (const call of calls) expect((await call).status).toBe(401);
    expect(readdirSync(dir)).not.toContain("speech-cache");

    // The production file mounts the router after the global auth gates.
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, "../../panel-server.ts"), "utf8");
    const gate = /app\s*\.\s*use\s*\(\s*authMiddleware\s*\)/.exec(source);
    const mobileGate = /app\s*\.\s*use\s*\(\s*mobileAuthMiddleware\s*\)/.exec(source);
    const mount = /app\s*\.\s*use\s*\(\s*["']\/api\/speech\/page-cache["']\s*,\s*createPageCacheRouter\s*\(/.exec(source);
    expect(gate, "the global authMiddleware mount").not.toBeNull();
    expect(mobileGate, "the global mobileAuthMiddleware mount").not.toBeNull();
    expect(mount, "the page-cache router mount").not.toBeNull();
    expect(mount!.index).toBeGreaterThan(gate!.index);
    expect(mount!.index).toBeGreaterThan(mobileGate!.index);
  });
});
