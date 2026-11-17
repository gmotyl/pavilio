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
      console.warn("[speech] answer cache clear failed:", reason);
      res.status(503).json({ error: `answer cache clear failed: ${reason}` });
    }
  });

  return router;
}

const toMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

/**
 * Removes expired answer audio and logs one line with what was removed and
 * kept. Never rejects, so the server can start it without awaiting it.
 */
export async function runStartupSweep(
  cache: AnswerAudioCache,
  log: (line: string) => void = console.log,
): Promise<void> {
  try {
    const t = await cache.sweep();
    log(
      `[answer-cache] swept: removed ${t.removedFiles} files (${toMb(t.removedBytes)} MB), ` +
        `kept ${t.keptFiles} files (${toMb(t.keptBytes)} MB)`,
    );
  } catch (error) {
    console.warn("[answer-cache] sweep failed:", (error as Error)?.message ?? error);
  }
}
