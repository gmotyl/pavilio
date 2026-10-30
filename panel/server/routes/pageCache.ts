import express, { Router, type NextFunction, type Request, type Response } from "express";
import { createPageCacheStore, HASH_RE, PageCacheEpochError, type PageCacheStore } from "../lib/speech/pageCache.js";

/**
 * The page audio cache, mounted at /api/speech/page-cache:
 *
 *   GET    /                 totals { pages, units, bytes }
 *   DELETE /                 wipe the whole cache → the freed totals
 *   GET    /:page            { units: [{ hash, bytes }], seq } — the page's write
 *                            sequence; empty and 0 for an unknown page
 *   GET    /:page/:unit      the MP3 (audio/mpeg) | 404
 *   PUT    /:page/:unit      raw body (≤ 5 MB, else 413), headers x-doc-key
 *                            (percent-encoded; malformed → 400) and
 *                            x-cache-epoch (missing → 400) → 204, or 409 when
 *                            the page was cleared (or the cache wiped) since
 *                            that epoch was read — nothing is written
 *   POST   /:page/prune      { keep: string[], seq } (the listing's seq, a
 *                            non-negative integer) and header x-cache-epoch
 *                            (the listing's) → { removed }: only units written
 *                            at or before seq go; 409 when the epoch is stale
 *   DELETE /:page            remove the page folder → 204
 *
 * `:page` and `:unit` must be 64 lowercase hex chars, else 400, so no request
 * can address a path outside the root. Both GETs of a page answer its current
 * epoch in `x-cache-epoch`; the client keeps the one from the GET that missed
 * and sends it back on the PUT. Any filesystem failure (typically a
 * root that cannot be created) answers 503, which the browser treats as "no
 * cache", and logs one warning until an operation succeeds again.
 */

export const MAX_UNIT_BYTES = "5mb";
export const EPOCH_HEADER = "x-cache-epoch";

export interface PageCacheRouterOptions {
  /** Default: the store at `~/.pavilio/speech-cache`; tests pass one on a temp root. */
  store?: PageCacheStore;
}

export function createPageCacheRouter(options: PageCacheRouterOptions = {}): Router {
  const store = options.store ?? createPageCacheStore();
  const router = Router();
  let warned = false;

  /** Runs a store call; answers 400 / 503 itself and returns undefined on failure. */
  async function attempt<T>(res: Response, run: () => Promise<T>): Promise<{ value: T } | undefined> {
    try {
      const value = await run();
      warned = false;
      return { value };
    } catch (error) {
      if (error instanceof PageCacheEpochError) {
        res.status(409).json({ error: "page cleared since the epoch was read" });
        return undefined;
      }
      if (error instanceof RangeError) {
        res.status(400).json({ error: error.message });
        return undefined;
      }
      if (!warned) {
        warned = true;
        console.warn("[speech] page cache unavailable:", (error as Error)?.message ?? error);
      }
      res.status(503).json({ error: "page cache unavailable" });
      return undefined;
    }
  }

  const checkId = (_req: Request, res: Response, next: NextFunction, id: string) => {
    if (HASH_RE.test(id)) return next();
    res.status(400).json({ error: "ids must be 64 lowercase hex chars" });
  };
  router.param("page", checkId);
  router.param("unit", checkId);

  router.get("/", async (_req, res) => {
    const got = await attempt(res, () => store.totals());
    if (got) res.json(got.value);
  });

  router.delete("/", async (_req, res) => {
    const got = await attempt(res, () => store.wipe());
    if (got) res.json(got.value);
  });

  /** Read before the store call, so a clear landing meanwhile leaves the answer with a stale epoch. */
  const sendEpoch = (req: Request, res: Response) => res.set(EPOCH_HEADER, store.epoch(req.params.page as string));

  router.get("/:page", async (req, res) => {
    sendEpoch(req, res);
    const got = await attempt(res, () => store.list(req.params.page));
    if (got) res.json(got.value);
  });

  router.get("/:page/:unit", async (req, res) => {
    sendEpoch(req, res);
    const got = await attempt(res, () => store.read(req.params.page, req.params.unit));
    if (!got) return;
    if (!got.value) {
      res.status(404).json({ error: "not cached" });
      return;
    }
    res.type("audio/mpeg").send(got.value);
  });

  router.put(
    "/:page/:unit",
    // Any content type is taken as raw bytes (audio/mpeg, application/octet-stream, …).
    express.raw({ type: () => true, limit: MAX_UNIT_BYTES }),
    async (req, res) => {
      const rawDocKey = req.get("x-doc-key");
      if (!rawDocKey || !rawDocKey.trim()) {
        res.status(400).json({ error: "x-doc-key header is required" });
        return;
      }
      // The browser sends the key percent-encoded (fetch rejects non-Latin-1
      // header values), so page.json stores the decoded, real doc key.
      let docKey: string;
      try {
        docKey = decodeURIComponent(rawDocKey);
      } catch {
        res.status(400).json({ error: "x-doc-key must be a percent-encoded string" });
        return;
      }
      const epoch = req.get(EPOCH_HEADER);
      if (!epoch) {
        res.status(400).json({ error: `${EPOCH_HEADER} header is required` });
        return;
      }
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: "body must be non-empty audio bytes" });
        return;
      }
      // A client that aborted mid-body never reaches here — the raw parser
      // errors instead — and one that hung up after its body arrived no longer
      // wants the write. Those only save work: correctness does not depend on
      // the abort reaching this socket (a reverse proxy may keep the upstream
      // request going). A body that completes after a clear or a wipe was asked
      // for carries the epoch from before it, and the store refuses it (409).
      if (req.socket?.destroyed) return;
      const got = await attempt(res, () => store.write(req.params.page, req.params.unit, body, docKey, epoch));
      if (got) res.status(204).end();
    },
  );

  router.post("/:page/prune", async (req, res) => {
    const { keep, seq } = (req.body as { keep?: unknown; seq?: unknown } | undefined) ?? {};
    if (!Array.isArray(keep) || !keep.every((h) => typeof h === "string")) {
      res.status(400).json({ error: "keep must be an array of unit hashes" });
      return;
    }
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) {
      res.status(400).json({ error: "seq must be the listing's sequence number" });
      return;
    }
    const epoch = req.get(EPOCH_HEADER);
    if (!epoch) {
      res.status(400).json({ error: `${EPOCH_HEADER} header is required` });
      return;
    }
    const got = await attempt(res, () => store.prune(req.params.page, keep as string[], seq, epoch));
    if (got) res.json({ removed: got.value });
  });

  router.delete("/:page", async (req, res) => {
    const got = await attempt(res, () => store.clearPage(req.params.page));
    if (got) res.status(204).end();
  });

  // Turns the raw parser's over-limit throw into JSON instead of express's HTML
  // error page, and ends a PUT the client aborted mid-body quietly: nothing was
  // written, and nobody is listening for an answer.
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const type = (err as { type?: string } | null)?.type;
    if (type === "entity.too.large") {
      res.status(413).json({ error: "unit too large", limit: MAX_UNIT_BYTES });
      return;
    }
    if (type === "request.aborted") {
      res.end();
      return;
    }
    next(err);
  });

  return router;
}
