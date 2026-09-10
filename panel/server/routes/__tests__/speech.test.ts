import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";

// The route's only side effect on the rest of the server is the WS fan-out.
// vi.hoisted keeps one stable spy across vi.resetModules() so a freshly loaded
// route module still broadcasts into the same fn.
const { broadcast } = vi.hoisted(() => ({ broadcast: vi.fn() }));
vi.mock("../../watcher", () => ({ broadcast }));

interface Frame {
  type: string;
  id: string;
  sessionId: string;
  text: string;
  at: number;
}

/**
 * Loads a *fresh* instance of the route module. The latest-per-session store
 * lives in module scope with nothing behind it, so a fresh instance is exactly
 * what a restarted server process starts from — which is how the
 * "nothing survives a restart" requirement is asserted below.
 *
 * The middleware order mirrors production exactly: a global `express.json()`
 * (panel-server.ts:98) and then the router mounted under `/api/speech`
 * (panel-server.ts:124). It has to, because that global parser reads the body
 * to completion first and is therefore what enforces the size cap — mounting
 * the router on a bare app would exercise a limit no real request ever meets.
 */
async function loadApp(): Promise<{ app: Express; cap: number }> {
  vi.resetModules();
  const mod = await import("../speech");
  const app = express();
  app.use(express.json());
  app.use("/api/speech", mod.default);
  return { app, cap: mod.MAX_UTTERANCE_BYTES };
}

const frames = () => broadcast.mock.calls.map((c) => c[0] as Frame);

/**
 * A raw JSON body whose serialized length is exactly `bytes`, so the enforced
 * limit can be probed one byte either side of it. The filler is plain ASCII, so
 * `JSON.stringify` adds nothing but the two quotes the empty envelope already
 * counted.
 */
function bodyOfExactly(bytes: number): string {
  const envelope = JSON.stringify({ sessionId: "cell-1", text: "" });
  const filler = "x".repeat(bytes - Buffer.byteLength(envelope));
  const body = JSON.stringify({ sessionId: "cell-1", text: filler });
  if (Buffer.byteLength(body) !== bytes) {
    throw new Error(`wanted a ${bytes}-byte body, built ${Buffer.byteLength(body)}`);
  }
  return body;
}

const here = dirname(fileURLToPath(import.meta.url));

const postRaw = (app: Express, body: string) =>
  request(app)
    .post("/api/speech/utterance")
    .set("Content-Type", "application/json")
    .send(body);

describe("POST /api/speech/utterance", () => {
  beforeEach(() => broadcast.mockClear());

  it("accepts a valid utterance and broadcasts it", async () => {
    const { app } = await loadApp();

    const res = await request(app)
      .post("/api/speech/utterance")
      .send({ sessionId: "cell-1", text: "The refactor is done." });

    expect(res.status).toBe(204);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(frames()[0]).toMatchObject({
      type: "speech-utterance",
      sessionId: "cell-1",
      text: "The refactor is done.",
    });
  });

  it("assigns the id and timestamp server-side", async () => {
    const { app } = await loadApp();
    const before = Date.now();

    // A client-supplied id/at must be ignored, not trusted.
    await request(app)
      .post("/api/speech/utterance")
      .send({ sessionId: "cell-1", text: "one", id: "client-id", at: 1 });
    await request(app)
      .post("/api/speech/utterance")
      .send({ sessionId: "cell-2", text: "two", id: "client-id", at: 1 });

    const [first, second] = frames();
    expect(first.id).not.toBe("client-id");
    expect(second.id).not.toBe("client-id");
    expect(first.id).not.toBe(second.id);
    expect(first.at).toBeGreaterThanOrEqual(before);
    expect(first.at).toBeLessThanOrEqual(Date.now());

    // The stored copy carries the server's values too, not the client's.
    const latest = await request(app).get("/api/speech/latest");
    const stored = (latest.body.utterances as Frame[]).find((u) => u.sessionId === "cell-1");
    expect(stored?.id).toBe(first.id);
    expect(stored?.at).toBe(first.at);
  });

  it("replaces an older utterance for the same session", async () => {
    const { app } = await loadApp();

    await request(app).post("/api/speech/utterance").send({ sessionId: "cell-1", text: "older" });
    await request(app).post("/api/speech/utterance").send({ sessionId: "cell-1", text: "newer" });

    const res = await request(app).get("/api/speech/latest");
    const utterances = res.body.utterances as Frame[];
    expect(utterances).toHaveLength(1);
    expect(utterances[0].text).toBe("newer");
    expect(utterances[0].id).toBe(frames()[1].id);
  });

  it("returns the latest utterance per session", async () => {
    const { app } = await loadApp();

    await request(app).post("/api/speech/utterance").send({ sessionId: "cell-1", text: "a" });
    await request(app).post("/api/speech/utterance").send({ sessionId: "cell-2", text: "b" });
    await request(app).post("/api/speech/utterance").send({ sessionId: "cell-1", text: "a2" });

    const res = await request(app).get("/api/speech/latest");
    expect(res.status).toBe(200);
    const bySession = new Map(
      (res.body.utterances as Frame[]).map((u) => [u.sessionId, u.text] as const),
    );
    expect(bySession.get("cell-1")).toBe("a2");
    expect(bySession.get("cell-2")).toBe("b");
    expect(bySession.size).toBe(2);
  });

  it("restores nothing after a restart", async () => {
    const { app } = await loadApp();

    await request(app).post("/api/speech/utterance").send({ sessionId: "cell-1", text: "a" });
    const before = await request(app).get("/api/speech/latest");
    expect(before.body.utterances).toHaveLength(1);

    // A restart is a fresh module instance: the store lives in module scope
    // with nothing behind it, so it comes back empty.
    const restarted = await loadApp();
    const after = await request(restarted.app).get("/api/speech/latest");
    expect(after.body.utterances).toEqual([]);

    // And nothing on the way in writes to disk. A `writeFileSync` added to the
    // POST handler would sail through every behavioural test above — the store
    // would simply never be read back — so the absence of persistence is pinned
    // statically: the route may not so much as import `fs`.
    const source = readFileSync(resolve(here, "../speech.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'](?:node:)?fs["']/);
    expect(source).not.toMatch(/require\(\s*["'](?:node:)?fs["']/);
  });

  it("rejects a missing sessionId, blank sessionId, missing text, or blank text without broadcasting", async () => {
    const { app } = await loadApp();

    const bodies = [
      { text: "orphan" },
      { sessionId: "  ", text: "x" },
      { sessionId: "cell-1" },
      { sessionId: "cell-1", text: "   \n\t  " },
    ];
    for (const body of bodies) {
      const res = await request(app).post("/api/speech/utterance").send(body);
      expect(res.status).toBe(400);
    }

    expect(broadcast).not.toHaveBeenCalled();
    const latest = await request(app).get("/api/speech/latest");
    expect(latest.body.utterances).toEqual([]);
  });

  it("rejects an oversized payload without broadcasting", async () => {
    const { app } = await loadApp();

    // 101 KB, written out as a literal on purpose. Sizing the payload from
    // MAX_UTTERANCE_BYTES would make this assertion self-referential: it would
    // pass for whatever the constant said, including a value nothing enforces.
    const res = await request(app)
      .post("/api/speech/utterance")
      .send({ sessionId: "cell-1", text: "x".repeat(101 * 1024) });

    // 413, not 400 — the body never finished parsing, so this is not a
    // validation failure the hook could fix by rewording.
    expect(res.status).toBe(413);
    expect(broadcast).not.toHaveBeenCalled();
    const latest = await request(app).get("/api/speech/latest");
    expect(latest.body.utterances).toEqual([]);
  });

  it("enforces the limit MAX_UTTERANCE_BYTES claims, to the byte", async () => {
    const { app, cap } = await loadApp();

    // The constant does not configure the parser — express's default 100 kb
    // does — so it can silently drift from the limit it documents. Probing both
    // sides of it pins the two together: raise the constant and the at-the-cap
    // body starts getting 413, lower it and the one-byte-over body starts
    // getting 204.
    const atCap = await postRaw(app, bodyOfExactly(cap));
    expect(atCap.status).toBe(204);
    expect(broadcast).toHaveBeenCalledTimes(1);

    const overCap = await postRaw(app, bodyOfExactly(cap + 1));
    expect(overCap.status).toBe(413);
    expect(broadcast).toHaveBeenCalledTimes(1);

    // The probes above only mean anything if `loadApp` is still a faithful copy
    // of production, so production is pinned too: the global parser must take
    // express's default limit (no `limit` option at all) and must still run
    // before the speech router is mounted.
    const serverSource = readFileSync(resolve(here, "../../panel-server.ts"), "utf8");
    const globalParserAt = serverSource.indexOf("app.use(express.json());");
    const speechRouterAt = serverSource.indexOf('app.use("/api/speech", speechRouter);');
    expect(globalParserAt).toBeGreaterThan(-1);
    expect(speechRouterAt).toBeGreaterThan(globalParserAt);
  });
});
