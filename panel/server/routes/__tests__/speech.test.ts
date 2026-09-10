import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
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
 * The app deliberately mounts nothing but the router: the router brings its own
 * JSON parser so that the size cap it declares is the one being exercised.
 */
async function loadApp(): Promise<{ app: Express; cap: number }> {
  vi.resetModules();
  const mod = await import("../speech");
  const app = express();
  app.use("/api/speech", mod.default);
  return { app, cap: mod.MAX_UTTERANCE_BYTES };
}

const frames = () => broadcast.mock.calls.map((c) => c[0] as Frame);

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

    // Nothing is persisted, so a restarted server restores nothing: a fresh
    // module instance comes back with an empty store.
    const restarted = await loadApp();
    const after = await request(restarted.app).get("/api/speech/latest");
    expect(after.body.utterances).toEqual([]);
  });

  it("rejects a missing sessionId, missing text, or blank text without broadcasting", async () => {
    const { app } = await loadApp();

    const bodies = [
      { text: "orphan" },
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
    const { app, cap } = await loadApp();

    const res = await request(app)
      .post("/api/speech/utterance")
      .send({ sessionId: "cell-1", text: "a".repeat(cap + 1) });

    // 413, not 400 — the body never finished parsing, so this is not a
    // validation failure the hook could fix by rewording.
    expect(res.status).toBe(413);
    expect(broadcast).not.toHaveBeenCalled();
    const latest = await request(app).get("/api/speech/latest");
    expect(latest.body.utterances).toEqual([]);
  });
});
