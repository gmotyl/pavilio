import { Router } from "express";
import type { AnswerAudioCache } from "../lib/speech/answerAudioCache.js";

/**
 * The answer audio cache, mounted at /api/speech/answer-cache behind the
 * global auth gates:
 *
 *   DELETE /   delete every answer audio file → 204; the page audio cache is
 *              untouched. A filesystem failure answers 503 with the reason in
 *              `error`, which Settings shows to the user.
 */

export interface AnswerCacheRouterOptions {
  /** The server's one answer audio cache — the same instance the TTS relay uses. */
  cache: AnswerAudioCache;
}

export function createAnswerCacheRouter({ cache }: AnswerCacheRouterOptions): Router {
  const router = Router();

  router.delete("/", async (_req, res) => {
    try {
      await cache.clear();
      res.status(204).end();
    } catch (error) {
      const reason = (error as Error)?.message ?? String(error);
      console.warn("[speech] clearing answer audio failed:", reason);
      // Just the reason: Settings prefixes it with "Couldn't clear answer audio: ".
      res.status(503).json({ error: reason });
    }
  });

  return router;
}

const toMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

/**
 * Removes expired answer audio and logs one line with what was removed and
 * kept, in the contracted wording
 * `[answer-cache] swept: removed <n> files (<x.y> MB), kept <m> files (<z.w> MB)`.
 * "Files" are the committed audio files — one per cached answer unit
 * (`*Units`); the megabytes are every file's on disk, so speaker records and
 * the temp files of writes still in flight (always kept) ride along in the
 * bytes but not in the file counts. Never rejects, so the server can start
 * it without awaiting it.
 */
export async function runStartupSweep(
  cache: AnswerAudioCache,
  log: (line: string) => void = console.log,
): Promise<void> {
  try {
    const t = await cache.sweep();
    log(
      `[answer-cache] swept: removed ${t.removedUnits} files (${toMb(t.removedBytes)} MB), ` +
        `kept ${t.keptUnits} files (${toMb(t.keptBytes)} MB)`,
    );
  } catch (error) {
    console.warn("[answer-cache] sweep failed:", (error as Error)?.message ?? error);
  }
}
