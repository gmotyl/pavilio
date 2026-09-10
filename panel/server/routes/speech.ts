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
 * This route does NOT enforce the cap itself, and must not pretend to: the
 * panel mounts a global `express.json()` (panel-server.ts) that has already
 * read the body to completion before this router is reached, and body-parser
 * skips a second parser whose request stream is already finished. A router-level
 * `express.json({ limit })` here is therefore inert — the *default* 100 kb limit
 * of the global parser is what actually rejects an oversized POST.
 *
 * So this constant is documentation of the enforced limit, not its source: it
 * must stay equal to express's default `json()` limit (100 kb). The boundary
 * test in `__tests__/speech.test.ts` mounts the production middleware order and
 * fails if the two ever diverge in either direction.
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

// An over-limit body is rejected by the global parser, i.e. before this router
// runs at all, so a router-level error handler for `entity.too.large` can never
// be reached and is deliberately absent. The status is right (413), but the body
// is express's default HTML error page — which in a non-production NODE_ENV
// includes a stack trace with absolute node_modules paths. Giving the panel one
// app-level JSON error handler is the fix; it belongs in panel-server.ts, not
// here, because it is every route's problem and not this route's.

export default speechRouter;
