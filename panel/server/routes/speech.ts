import { Router } from "express";
import { randomUUID } from "node:crypto";
import { broadcast } from "../watcher.js";

// Keep in sync with panel/src/features/speech/types.ts
/**
 * An utterance is a live notification, not a log: the agent's finished response
 * arrives from the `Stop` hook inside the PTY, is kept as the *latest* one for
 * its session, and is broadcast to every open tab. Only the latest per session
 * is retained — heard or not, so it stays replayable — and nothing is ever
 * written to disk, so a restart leaves the panel with nothing to restore.
 */
interface Utterance {
  /** Server-assigned; a fresh one on every utterance. */
  id: string;
  /** `PAVILIO_TERMINAL_ID` — the cell the response belongs to. */
  sessionId: string;
  /** Raw response markdown, exactly as the hook sent it. */
  text: string;
  /** Epoch ms, server-assigned. */
  at: number;
}

/**
 * Size cap for one utterance POST — a response long enough to exceed 100 KB of
 * markdown is not something anyone wants read aloud.
 *
 * This constant is the cap's single source: panel-server.ts feeds it to an
 * `express.json({ limit: MAX_UTTERANCE_BYTES })` mounted on `/api/speech`
 * *before* the global `express.json()`, because body-parser skips a request
 * whose stream it finds already finished — so the first parser to read the body
 * is the one whose limit applies. Changing the number here changes what the
 * route accepts, in both directions; no other route's limit moves with it.
 *
 * The cap cannot be enforced from inside this router: by the time a
 * router-level middleware runs, some app-level parser has already read the
 * body, which is why the parser lives at the mount point instead of here. The
 * boundary test in `__tests__/speech.test.ts` mirrors that mount order and
 * probes one byte either side of the constant.
 */
export const MAX_UTTERANCE_BYTES = 100 * 1024;

/** sessionId → its latest utterance. In memory only, by design. */
const latestBySession = new Map<string, Utterance>();

const speechRouter = Router();

speechRouter.post("/utterance", (req, res) => {
  const { sessionId, text } = (req.body ?? {}) as Record<string, unknown>;

  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    return res.status(400).json({ error: "sessionId is required" });
  }
  // Emptiness is judged after trimming, but the text is stored as sent: the
  // browser's preparation stage owns whitespace, not this route.
  if (typeof text !== "string" || text.trim() === "") {
    return res.status(400).json({ error: "text is required" });
  }

  // id and at are the server's to assign — anything the client sent is ignored.
  const utterance: Utterance = { id: randomUUID(), sessionId, text, at: Date.now() };
  latestBySession.set(sessionId, utterance);
  broadcast({ type: "speech-utterance", ...utterance });

  res.status(204).end();
});

speechRouter.get("/latest", (_req, res) => {
  res.json({ utterances: [...latestBySession.values()] });
});

// An over-limit body throws inside the app-level parser mounted at
// `/api/speech`, i.e. before this router runs at all, so a router-level error
// handler for `entity.too.large` can never be reached and is deliberately
// absent. The 413 and its JSON body come from the error handler sitting next to
// that parser in panel-server.ts, which is the only place the throw passes
// through.

export default speechRouter;
