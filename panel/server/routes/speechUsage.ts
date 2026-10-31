import { Router } from "express";
import type { UsageStore } from "../lib/speech/usage-store.js";

/**
 * Speech usage for Settings → Speech:
 *
 *   POST /api/speech/usage { engine, chars } → 204 | 400 | 500
 *   GET  /api/speech/usage → { months: UsageMonth[] }
 *
 * POST is how the browser reports characters it sent to an engine directly
 * (Edge); server-side synthesis counts itself. Mounted behind the panel auth.
 */

export interface SpeechUsageOptions {
  store: UsageStore;
}

export function createSpeechUsageRouter({ store }: SpeechUsageOptions): Router {
  const router = Router();

  router.post("/usage", async (req, res) => {
    const { engine, chars } = (req.body ?? {}) as { engine?: unknown; chars?: unknown };
    if (typeof engine !== "string" || engine === "") {
      res.status(400).json({ error: "engine must be a non-empty string" });
      return;
    }
    if (typeof chars !== "number" || !Number.isSafeInteger(chars) || chars <= 0) {
      res.status(400).json({ error: "chars must be a positive integer" });
      return;
    }
    try {
      await store.record(engine, chars);
      res.status(204).end();
    } catch (err) {
      console.error("[tts-usage] could not record usage:", (err as Error).message);
      res.status(500).json({ error: "could not record usage" });
    }
  });

  router.get("/usage", async (_req, res) => {
    try {
      res.json({ months: await store.readAll() });
    } catch (err) {
      console.error("[tts-usage] could not read usage:", (err as Error).message);
      res.status(500).json({ error: "could not read usage" });
    }
  });

  return router;
}
