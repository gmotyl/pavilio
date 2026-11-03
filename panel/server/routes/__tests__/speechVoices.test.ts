import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import multer from "multer";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { createOpenaiCatalog } from "../../lib/speech/openaiCatalog";
import { createSpeechVoicesRouter, VOICE_UPLOAD_MAX_BYTES } from "../speechVoices";

/** One upload the fake server received: its text fields and the file it carried. */
interface Upload {
  fields: Record<string, string>;
  file?: { name: string; size: number };
}

/**
 * A stand-in omnivoice-server on a real port, so the route's multipart forwarding goes over the
 * wire: `GET /v1/voices`, `POST /v1/voices`, `DELETE /v1/voices/:name`, `GET /v1/voices/:name/sample`.
 * A POST answers `postReply` when one is set, otherwise it adds a custom voice and answers 201.
 */
interface FakeServer {
  url: string;
  records: Array<{ id: string; source: string; locale?: string }>;
  uploads: Upload[];
  deletes: string[];
  postReply?: { status: number; body: unknown };
  deleteReply?: { status: number; body: unknown };
  close(): Promise<void>;
}

const SAMPLE = Buffer.from("RIFF$\0\0\0WAVEfmt converted-by-the-server");

async function startFakeServer(): Promise<FakeServer> {
  const upload = multer({ storage: multer.memoryStorage() });
  const fake = {
    records: [{ id: "comic-s13", source: "bundled", locale: "en-US" }],
    uploads: [] as Upload[],
    deletes: [] as string[],
  } as FakeServer;
  const app = express();
  app.get("/v1/voices", (_req, res) => {
    res.json({ default: "auto", voices: [{ id: "auto", language: null }, ...fake.records] });
  });
  app.post("/v1/voices", upload.single("file"), (req, res) => {
    const fields = { ...(req.body as Record<string, string>) };
    fake.uploads.push({
      fields,
      file: req.file ? { name: req.file.originalname, size: req.file.size } : undefined,
    });
    if (fake.postReply) {
      res.status(fake.postReply.status).json(fake.postReply.body);
      return;
    }
    const record = { id: fields.name!, source: "custom", locale: fields.locale, ref_text: fields.ref_text };
    fake.records = [...fake.records.filter((r) => r.id !== record.id), record];
    res.status(201).json(record);
  });
  app.delete("/v1/voices/:name", (req, res) => {
    fake.deletes.push(req.params.name);
    if (fake.deleteReply) {
      res.status(fake.deleteReply.status).json(fake.deleteReply.body);
      return;
    }
    fake.records = fake.records.filter((r) => r.id !== req.params.name);
    res.status(204).end();
  });
  app.get("/v1/voices/:name/sample", (req, res) => {
    if (!fake.records.some((r) => r.id === req.params.name)) {
      res.status(404).json({ detail: "unknown voice" });
      return;
    }
    res.type("audio/wav").send(SAMPLE);
  });
  const server: Server = await new Promise((done) => {
    const s = app.listen(0, "127.0.0.1", () => done(s));
  });
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.close = () => new Promise((done) => server.close(() => done()));
  return fake;
}

let root: string;
let fake: FakeServer;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "panel-speech-voices-"));
  fake = await startFakeServer();
});
afterEach(async () => {
  await fake.close();
  rmSync(root, { recursive: true, force: true });
});

interface Loaded {
  app: Express;
  /** The catalog's onChange: the holder rebuild in production. */
  onChange: ReturnType<typeof vi.fn>;
}

/** The router over a real catalog, both pointed at `address` (the fake server unless given; null: none set). */
function loadApp(address: string | null = fake.url): Loaded {
  const onChange = vi.fn();
  const baseUrl = () => address ?? undefined;
  // No recovery retries: a test asks explicitly, and no timer may outlive it.
  const catalog = createOpenaiCatalog({ baseUrl, onChange, timeoutMs: 1000, retryDelaysMs: [] });
  const app = express();
  app.use(express.json());
  app.use("/api/speech", createSpeechVoicesRouter({ catalog, baseUrl, workspaceRoot: root }));
  return { app, onChange };
}

const copyDir = (name: string) => join(root, ".pavilio", "voices", name);

/** A workspace copy written the way the route writes one. */
function seedCopy(name: string) {
  mkdirSync(copyDir(name), { recursive: true });
  writeFileSync(join(copyDir(name), "voice.json"), JSON.stringify({ id: name, source: "custom" }));
  writeFileSync(join(copyDir(name), "sample.wav"), SAMPLE);
}

function postVoice(app: Express, name = "my-voice", file: Buffer = Buffer.from("m4a bytes")) {
  return request(app)
    .post("/api/speech/openai/voices")
    .field("name", name)
    .field("ref_text", "Dzień dobry, to mój głos.")
    .field("locale", "pl-PL")
    .field("gender", "male")
    .field("label", "Greg")
    .field("multilingual", "true")
    .attach("file", file, "sample.m4a");
}

describe("/api/speech/openai/voices", () => {
  it("GET refreshes and reports workspace-only voices", async () => {
    seedCopy("my-voice");
    seedCopy("comic-s13");
    const { app, onChange } = loadApp();

    const res = await request(app).get("/api/speech/openai/voices");
    expect(res.status).toBe(200);
    expect(res.body.unreachable).toBe(false);
    expect(res.body.voices.map((v: { id: string }) => v.id)).toEqual(["comic-s13"]);
    // `my-voice` is saved in the workspace but the server does not have it.
    expect(res.body.workspaceOnly).toBe(1);
    expect(onChange).toHaveBeenCalledTimes(1);

    // An unchanged list does not rebuild the Tts again.
    await request(app).get("/api/speech/openai/voices");
    expect(onChange).toHaveBeenCalledTimes(1);

    fake.records.push({ id: "my-voice", source: "custom" });
    const after = await request(app).get("/api/speech/openai/voices");
    expect(after.body.workspaceOnly).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("POST forwards, writes the workspace copy and refreshes", async () => {
    const { app, onChange } = loadApp();

    const res = await postVoice(app);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "my-voice", source: "custom" });

    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0]!.fields).toEqual({
      name: "my-voice",
      ref_text: "Dzień dobry, to mój głos.",
      locale: "pl-PL",
      gender: "male",
      label: "Greg",
      multilingual: "true",
    });
    expect(fake.uploads[0]!.file).toEqual({ name: "sample.m4a", size: "m4a bytes".length });

    // The copy holds the server's converted wav and the record it answered with.
    expect(readFileSync(join(copyDir("my-voice"), "sample.wav")).equals(SAMPLE)).toBe(true);
    expect(JSON.parse(readFileSync(join(copyDir("my-voice"), "voice.json"), "utf8"))).toMatchObject({
      id: "my-voice",
      source: "custom",
      ref_text: "Dzień dobry, to mój głos.",
    });
    // The catalog was refreshed: the new voice is in it, and the Tts was rebuilt.
    expect(onChange).toHaveBeenCalledTimes(1);
    const list = await request(app).get("/api/speech/openai/voices");
    expect(list.body.voices.map((v: { id: string }) => v.id)).toContain("my-voice");
  });

  it("POST passes upstream 400 and 409 through without a copy", async () => {
    const { app, onChange } = loadApp();

    fake.postReply = { status: 409, body: { detail: "bundled voice — pick another name" } };
    const clash = await postVoice(app, "comic-s13");
    expect(clash.status).toBe(409);
    expect(clash.body).toMatchObject({ detail: "bundled voice — pick another name" });
    expect(typeof clash.body.error).toBe("string");

    fake.postReply = { status: 400, body: { detail: "ref_text must not be blank" } };
    const bad = await postVoice(app, "ania");
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ detail: "ref_text must not be blank" });

    expect(fake.uploads).toHaveLength(2);
    expect(existsSync(join(root, ".pavilio"))).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("DELETE removes the copy only on 204", async () => {
    seedCopy("ania");
    seedCopy("comic-s13");
    fake.records.push({ id: "ania", source: "custom" });
    const { app, onChange } = loadApp();
    await request(app).get("/api/speech/openai/voices");
    expect(onChange).toHaveBeenCalledTimes(1);

    fake.deleteReply = { status: 403, body: { detail: "bundled voice" } };
    const bundled = await request(app).delete("/api/speech/openai/voices/comic-s13");
    expect(bundled.status).toBe(403);
    expect(bundled.body).toMatchObject({ detail: "bundled voice" });
    expect(existsSync(copyDir("comic-s13"))).toBe(true);

    fake.deleteReply = { status: 404, body: { detail: "unknown voice" } };
    const unknown = await request(app).delete("/api/speech/openai/voices/ania");
    expect(unknown.status).toBe(404);
    expect(existsSync(copyDir("ania"))).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);

    fake.deleteReply = undefined;
    const ok = await request(app).delete("/api/speech/openai/voices/ania");
    expect(ok.status).toBe(204);
    expect(fake.deletes).toEqual(["comic-s13", "ania", "ania"]);
    expect(existsSync(copyDir("ania"))).toBe(false);
    // The catalog was refreshed, and the list without `ania` rebuilt the Tts.
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("serves a voice's sample as a wav stream", async () => {
    const { app } = loadApp();
    const res = await request(app)
      .get("/api/speech/openai/voices/comic-s13/sample")
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^audio\/wav/);
    expect((res.body as Buffer).equals(SAMPLE)).toBe(true);

    const missing = await request(app).get("/api/speech/openai/voices/nope/sample");
    expect(missing.status).toBe(404);
  });

  it("no address answers 409 and a down server 502", async () => {
    const none = loadApp(null).app;
    for (const res of [
      await request(none).get("/api/speech/openai/voices"),
      await postVoice(none),
      await request(none).delete("/api/speech/openai/voices/ania"),
      await request(none).get("/api/speech/openai/voices/ania/sample"),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "no-address" });
    }

    const downUrl = fake.url;
    await fake.close();
    fake = { ...fake, close: async () => {} };
    const down = loadApp(downUrl).app;
    for (const res of [
      await request(down).get("/api/speech/openai/voices"),
      await postVoice(down),
      await request(down).delete("/api/speech/openai/voices/ania"),
      await request(down).get("/api/speech/openai/voices/ania/sample"),
    ]) {
      expect(res.status).toBe(502);
      expect(res.body).toEqual({ error: "unreachable" });
    }
    expect(existsSync(join(root, ".pavilio"))).toBe(false);
  });

  it("oversized upload answers 413", async () => {
    const { app } = loadApp();
    const res = await postVoice(app, "my-voice", Buffer.alloc(VOICE_UPLOAD_MAX_BYTES + 1));
    expect(res.status).toBe(413);
    expect(fake.uploads).toHaveLength(0);
    expect(existsSync(join(root, ".pavilio"))).toBe(false);
    expect(VOICE_UPLOAD_MAX_BYTES).toBe(25 * 1024 * 1024);
  });

  it("rejects path-escaping names", async () => {
    seedCopy("victim");
    const { app } = loadApp();

    for (const name of ["../victim", "a/b", ".."]) {
      const res = await postVoice(app, name);
      expect(res.status, name).toBe(400);
    }
    expect(fake.uploads).toHaveLength(0);

    for (const encoded of ["%2E%2E%2Fvictim", "a%2Fb", "..%2Fvictim"]) {
      expect((await request(app).delete(`/api/speech/openai/voices/${encoded}`)).status, encoded).toBe(400);
      expect((await request(app).get(`/api/speech/openai/voices/${encoded}/sample`)).status, encoded).toBe(400);
    }
    expect(fake.deletes).toEqual([]);
    expect(existsSync(copyDir("victim"))).toBe(true);
  });

  it("is mounted behind the global auth gate with the server's catalog", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, "../../panel-server.ts"), "utf8");
    const gate = /app\s*\.\s*use\s*\(\s*authMiddleware\s*\)/.exec(source);
    const mount =
      /app\s*\.\s*use\s*\(\s*["']\/api\/speech["']\s*,\s*createSpeechVoicesRouter\s*\(\s*\{\s*catalog\s*:\s*openaiCatalog\s*,\s*baseUrl\s*:\s*openaiBaseUrl\s*\}\s*\)\s*\)/.exec(
        source,
      );
    expect(gate).not.toBeNull();
    expect(mount, "the speech voices router mount").not.toBeNull();
    expect(mount!.index).toBeGreaterThan(gate!.index);
  });
});
