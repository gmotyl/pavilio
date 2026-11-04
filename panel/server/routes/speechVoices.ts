import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { getConfig } from "../config.js";
import type { OpenaiCatalog } from "../lib/speech/openaiCatalog.js";
import {
  isSafeVoiceName,
  listWorkspaceVoices,
  removeWorkspaceVoice,
  writeWorkspaceVoice,
} from "../lib/speech/workspaceVoices.js";

/**
 * The OmniVoice server's voices, proxied for Settings → Speech:
 *
 *   GET    /api/speech/openai/voices              → 200 {voices, unreachable, workspaceOnly}
 *   POST   /api/speech/openai/voices              multipart (25 MB) → the server's status + body
 *   DELETE /api/speech/openai/voices/:name        → the server's status
 *   GET    /api/speech/openai/voices/:name/sample → the voice's reference wav, streamed
 *
 * With no address set every route answers `409 {error:"no-address"}`; a server that refuses the
 * connection or times out is `502 {error:"unreachable"}`; a 4xx from the server comes back with
 * its status and `{error, detail}`.
 *
 * GET refreshes the live catalog first (it rebuilds the Tts only when the list changed), so a
 * server that was down at boot is picked up when Settings opens. `workspaceOnly` counts the
 * workspace voice copies the server does not have, for the empty-state hint.
 *
 * A 201 from POST is followed by fetching the voice's converted sample and writing the workspace
 * voice copy; a 204 from DELETE removes it. Both refresh the catalog. Anything else leaves the copy
 * alone. In-use voices need no preference writes here: the browser drops a stale voice id on read.
 */

export const VOICE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** Cloning runs the model on the server; the other calls are quick. */
const CLONE_TIMEOUT_MS = 120_000;
const CALL_TIMEOUT_MS = 10_000;

export interface SpeechVoicesOptions {
  catalog: Pick<OpenaiCatalog, "current" | "unreachable" | "refresh">;
  /** The server address, or undefined when none (or no usable one) is set. */
  baseUrl: () => string | undefined;
  /** Default: the workspace above `projects/`, where `.pavilio/preferences/` lives. */
  workspaceRoot?: string;
  /** Default: the global `fetch`. */
  fetch?: typeof fetch;
}

// One byte over the limit: multer rejects at `fileSize` itself, so a file of exactly
// VOICE_UPLOAD_MAX_BYTES must get through.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fields: 16, fileSize: VOICE_UPLOAD_MAX_BYTES + 1 },
});

function receiveSample(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "too-large", limit: VOICE_UPLOAD_MAX_BYTES });
      return;
    }
    if (err) {
      res.status(400).json({ error: "bad-upload", detail: err instanceof Error ? err.message : "upload failed" });
      return;
    }
    next();
  });
}

/** Thrown when the server could not be reached (refused, reset, timed out). */
class Unreachable extends Error {}

/** The server's `detail` (FastAPI's error shape), or its body as text. */
async function detailOf(upstream: globalThis.Response): Promise<unknown> {
  const text = await upstream.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { detail?: unknown } | null;
    return body?.detail ?? text;
  } catch {
    return text;
  }
}

/** Answers with the server's error status: a 4xx as is, anything else as 502. */
async function passError(res: Response, upstream: globalThis.Response): Promise<void> {
  const status = upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502;
  res.status(status).json({ error: "upstream", detail: await detailOf(upstream) });
}

export function createSpeechVoicesRouter(options: SpeechVoicesOptions): Router {
  const { catalog, baseUrl, fetch: fetchImpl = fetch } = options;
  const workspaceRoot = options.workspaceRoot ?? resolve(getConfig().projectsDir, "..");
  const router = Router();

  /** The address without a trailing slash, or undefined after answering 409. */
  function addressOr409(res: Response): string | undefined {
    const address = baseUrl();
    if (!address) {
      res.status(409).json({ error: "no-address" });
      return undefined;
    }
    return address.replace(/\/+$/, "");
  }

  /** The `:name` param when it is a safe single path segment, or undefined after answering 400. */
  function nameOr400(res: Response, name: unknown): string | undefined {
    if (typeof name === "string" && isSafeVoiceName(name)) return name;
    res.status(400).json({ error: "invalid-name" });
    return undefined;
  }

  async function call(url: string, init: RequestInit, timeoutMs = CALL_TIMEOUT_MS): Promise<globalThis.Response> {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new Unreachable();
    }
  }

  /** Runs a handler; an unreachable server answers 502. */
  const handle =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res);
      } catch (error) {
        if (!(error instanceof Unreachable)) throw error;
        if (!res.headersSent) res.status(502).json({ error: "unreachable" });
        else res.end();
      }
    };

  router.get(
    "/openai/voices",
    handle(async (_req, res) => {
      if (!addressOr409(res)) return;
      await catalog.refresh();
      if (catalog.unreachable()) throw new Unreachable();
      const voices = catalog.current();
      const onServer = new Set(voices.map((voice) => voice.id));
      const copies = await listWorkspaceVoices(workspaceRoot);
      const workspaceOnly = copies.filter((name) => !onServer.has(name)).length;
      res.json({ voices, unreachable: false, workspaceOnly });
    }),
  );

  router.post(
    "/openai/voices",
    // The address is checked before the upload is read, so nothing is buffered for nothing.
    (_req, res, next) => {
      if (addressOr409(res)) next();
    },
    receiveSample,
    handle(async (req, res) => {
      const address = addressOr409(res);
      if (!address) return;
      const fields = (req.body ?? {}) as Record<string, unknown>;
      const name = nameOr400(res, fields.name);
      if (!name) return;

      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) {
        if (typeof value === "string") form.append(key, value);
      }
      if (req.file) {
        const blob = new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype });
        form.append("file", blob, req.file.originalname);
      }

      const upstream = await call(`${address}/v1/voices`, { method: "POST", body: form }, CLONE_TIMEOUT_MS);
      if (!upstream.ok) {
        await passError(res, upstream);
        return;
      }
      const record = (await upstream.json().catch(() => null)) as unknown;

      // The copy keeps the server's converted wav, not the upload, so a reseed clones the same audio.
      try {
        const sample = await call(`${address}/v1/voices/${encodeURIComponent(name)}/sample`, {});
        if (!sample.ok) throw new Error(`sample answered ${sample.status}`);
        await writeWorkspaceVoice(workspaceRoot, name, { record, sample: Buffer.from(await sample.arrayBuffer()) });
      } catch (error) {
        // The voice is on the server either way; only the workspace copy is missing.
        console.error(`[speech] could not save the workspace copy of voice ${name}:`, error instanceof Error ? error.message : error);
      }
      await catalog.refresh();
      res.status(upstream.status).json(record);
    }),
  );

  router.delete(
    "/openai/voices/:name",
    handle(async (req, res) => {
      const address = addressOr409(res);
      if (!address) return;
      const name = nameOr400(res, req.params.name);
      if (!name) return;

      const upstream = await call(`${address}/v1/voices/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (upstream.status !== 204) {
        if (upstream.ok) res.status(upstream.status).end();
        else await passError(res, upstream);
        return;
      }
      await removeWorkspaceVoice(workspaceRoot, name);
      await catalog.refresh();
      res.status(204).end();
    }),
  );

  router.get(
    "/openai/voices/:name/sample",
    handle(async (req, res) => {
      const address = addressOr409(res);
      if (!address) return;
      const name = nameOr400(res, req.params.name);
      if (!name) return;

      const upstream = await call(`${address}/v1/voices/${encodeURIComponent(name)}/sample`, {});
      if (!upstream.ok || !upstream.body) {
        await passError(res, upstream);
        return;
      }
      res.status(200).type("audio/wav");
      const length = upstream.headers.get("content-length");
      if (length) res.setHeader("Content-Length", length);
      Readable.fromWeb(upstream.body as NodeReadableStream<Uint8Array>)
        .on("error", () => res.destroy())
        .pipe(res);
    }),
  );

  return router;
}
