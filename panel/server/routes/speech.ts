import express, { Router, type ErrorRequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { broadcast } from "../watcher.js";

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
 * Size cap for one utterance POST. A response long enough to exceed 100 KB of
 * markdown is not something anyone wants read aloud, and this matches the limit
 * the panel's global `express.json()` already applies, so the cap the route
 * declares is the cap a request actually meets.
 */
export const MAX_UTTERANCE_BYTES = 100 * 1024;

/** sessionId → its latest utterance. In memory only, by design. */
const latestBySession = new Map<string, Utterance>();

const speechRouter = Router();

// The router carries its own parser so the cap above travels with the route
// rather than depending on how it happens to be mounted. In panel-server the
// global parser has already consumed the body by then (same limit), so this is
// a no-op there — it is what enforces the cap when the router stands alone.
speechRouter.use(express.json({ limit: MAX_UTTERANCE_BYTES }));

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

// body-parser aborts an over-limit body before the handler runs, so the refusal
// has to be shaped here. Express's default handler would surface the status,
// but as HTML from deep inside the stack; the hook wants the same JSON error
// shape as every other rejection, and 413 rather than a 400 it could not fix.
const tooLarge: ErrorRequestHandler = (err, _req, res, next) => {
  if ((err as { type?: string } | null)?.type === "entity.too.large") {
    return res.status(413).json({ error: "utterance too large" });
  }
  return next(err);
};
speechRouter.use(tooLarge);

export default speechRouter;
