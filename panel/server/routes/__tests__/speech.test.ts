import { describe, it, expect, beforeEach, vi } from "vitest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
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
 * The middleware order mirrors production (panel-server.ts): the speech-scoped
 * `express.json({ limit: MAX_UTTERANCE_BYTES })` and its 413 handler first,
 * then the global default-limit `express.json()`, then the router. The order
 * matters — body-parser skips a request whose stream is already finished, so
 * whichever parser is mounted first is the one whose limit applies. That the
 * production file really is shaped this way is a separate assertion below;
 * this function is only a copy of it.
 */
async function loadApp(): Promise<{ app: Express; cap: number }> {
  vi.resetModules();
  const mod = await import("../speech");
  const cap = mod.MAX_UTTERANCE_BYTES;
  const app = express();
  app.use("/api/speech", express.json({ limit: cap }));
  app.use("/api/speech", (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if ((err as { type?: string } | null)?.type === "entity.too.large") {
      res.status(413).json({ error: "utterance too large", limit: cap });
      return;
    }
    next(err);
  });
  app.use(express.json());
  app.use("/api/speech", mod.default);
  // A control route, mounted the way the panel's other twelve routers are:
  // after the global parser and outside the speech path. It is here so the
  // speech-scoped parser can be shown not to have moved anyone else's limit.
  app.post("/api/control/echo", (_req, res) => void res.status(204).end());
  return { app, cap };
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

const readServerSource = () => readFileSync(resolve(here, "../../panel-server.ts"), "utf8");

/** One `app.use(...)` that mounts a body parser, with where it sits in the file. */
interface ParserMount {
  /** The path it is scoped to, or null when it is mounted app-wide. */
  path: string | null;
  /** The literal text of the parser's options argument (`""` when it takes none). */
  options: string;
  /** Offset of the `app.use` in the source, for ordering comparisons. */
  at: number;
}

/**
 * Every body parser panel-server.ts mounts, in source order.
 *
 * Whitespace-tolerant, like `bind.test.ts`, and it resolves a parser that was
 * extracted to a variable first (`const jsonBody = express.json();
 * app.use(jsonBody);`) the way `entry-points.contract.test.ts` resolves import
 * aliases — a behaviour-preserving refactor should not read as a regression.
 *
 * Source order is only mount order because panel-server.ts mounts every parser
 * from one straight-line function body; a parser mounted inside a conditional,
 * a loop, or a helper would fool this.
 */
function parserMounts(source: string): ParserMount[] {
  const PARSER = String.raw`(?:express|bodyParser)\s*\.\s*(?:json|urlencoded|raw|text)\s*\(([^)]*)\)`;
  const named = new Map<string, string>();
  for (const m of source.matchAll(
    new RegExp(String.raw`(?:const|let|var)\s+(\w+)\s*=\s*${PARSER}`, "g"),
  )) {
    named.set(m[1], m[2]);
  }

  const mounts: ParserMount[] = [];
  const use = new RegExp(
    String.raw`app\s*\.\s*use\s*\(\s*(?:(["'][^"']*["'])\s*,\s*)?(?:${PARSER}|(\w+))`,
    "g",
  );
  for (const m of source.matchAll(use)) {
    const [, quotedPath, inlineOptions, ident] = m;
    const options = inlineOptions ?? (ident === undefined ? undefined : named.get(ident));
    if (options === undefined) continue; // an app.use of something that is not a parser
    mounts.push({
      path: quotedPath ? quotedPath.slice(1, -1) : null,
      options,
      at: m.index ?? -1,
    });
  }
  return mounts;
}

const postRawTo = (app: Express, path: string, body: string) =>
  request(app).post(path).set("Content-Type", "application/json").send(body);

const postRaw = (app: Express, body: string) => postRawTo(app, "/api/speech/utterance", body);

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
    // would simply never be read back — so a tripwire catches the obvious
    // accident: the route reaching for `fs`. It covers the submodule
    // (`fs/promises`, the idiomatic modern write), the `node:` prefix, `require`,
    // and the dynamic `await import("fs")` form.
    //
    // A tripwire, not a guarantee: it says nothing about `child_process`, a
    // write smuggled through some other module that imports `fs` itself, or a
    // process-level escape hatch. It buys the cheap 90%, and the "restores
    // nothing after a restart" assertion above is what actually holds the
    // requirement.
    const source = readFileSync(resolve(here, "../speech.ts"), "utf8");
    expect(source).not.toMatch(
      /(?:from|import|require)\s*\(?\s*["'](?:node:)?fs(?:\/[\w./-]+)?["']/,
    );
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
    // validation failure the hook could fix by rewording. And JSON, not
    // express's default HTML error page, which in a non-production NODE_ENV
    // carries a stack trace with absolute node_modules paths.
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: expect.any(String) });
    expect(broadcast).not.toHaveBeenCalled();
    const latest = await request(app).get("/api/speech/latest");
    expect(latest.body.utterances).toEqual([]);
  });

  it("enforces the limit MAX_UTTERANCE_BYTES sets, to the byte", async () => {
    const { app, cap } = await loadApp();

    // The constant configures the parser, so this probes that it really governs
    // rather than describing something else: raise the constant and the
    // one-byte-over body starts getting 204, lower it and the at-the-cap body
    // starts getting 413. Sizing both bodies from the constant is the point
    // here — the fixed-literal check lives in the test above.
    const atCap = await postRaw(app, bodyOfExactly(cap));
    expect(atCap.status).toBe(204);
    expect(broadcast).toHaveBeenCalledTimes(1);

    const overCap = await postRaw(app, bodyOfExactly(cap + 1));
    expect(overCap.status).toBe(413);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("leaves every other route on express's default limit", async () => {
    const { app } = await loadApp();

    // Fixed literals, not the constant: the whole point is that moving
    // MAX_UTTERANCE_BYTES must not drag this boundary with it. 100 kb is
    // express's own `json()` default, which the global parser still takes.
    const atDefault = await postRawTo(app, "/api/control/echo", bodyOfExactly(100 * 1024));
    expect(atDefault.status).toBe(204);

    const overDefault = await postRawTo(app, "/api/control/echo", bodyOfExactly(100 * 1024 + 1));
    expect(overDefault.status).toBe(413);
  });

  it("mounts the cap in production where it can actually bite", () => {
    // Everything above runs against `loadApp`, which is a hand-written copy of
    // the production middleware order — so the copy is worth nothing unless
    // panel-server.ts is still shaped the same way. This is that check.
    const serverSource = readServerSource();
    const mounts = parserMounts(serverSource);
    expect(mounts.length).toBeGreaterThan(1);

    // Exclusivity, not mere presence: the FIRST parser mounted is the one that
    // reads the body, so it is the one whose limit applies. A parser sneaked in
    // ahead of this line — global or path-scoped, wider or narrower — would
    // quietly take the cap over, so "there is a parser somewhere before the
    // router" is not a strong enough claim to make.
    const [first, ...rest] = mounts;
    expect(first.path).toBe("/api/speech");
    expect(first.options).toMatch(/limit\s*:\s*MAX_UTTERANCE_BYTES/);

    // The rest of the panel: exactly one app-wide parser, taking no `limit` of
    // its own, so every other route keeps express's default.
    const appWide = rest.filter((m) => m.path === null);
    expect(appWide).toHaveLength(1);
    expect(appWide[0].options.trim()).toBe("");
    expect(rest.filter((m) => m.path === "/api/speech")).toEqual([]);

    // The 413 body is JSON because an error handler sits between the speech
    // parser and everything downstream; without it express answers with its
    // default HTML page.
    const tooLargeAt = serverSource.search(/entity\.too\.large/);
    expect(tooLargeAt).toBeGreaterThan(first.at);

    // And the router itself still mounts after its parser.
    const routerAt = serverSource.search(
      /app\s*\.\s*use\s*\(\s*["']\/api\/speech["']\s*,\s*speechRouter\s*\)/,
    );
    expect(routerAt).toBeGreaterThan(first.at);
  });
});
