import type { IncomingMessage, ServerResponse } from "node:http";
import type { EdgeEngineOptions } from "anytts";
import { createRelayHandler, toNodeHandler } from "anytts/server";

/** Longest `text` the relay synthesizes; longer requests get 413. */
const MAX_CHARS = 2000;

export interface TtsHandlerOptions {
  /** Read-aloud WebSocket factory; the route test injects a fake one. */
  transport?: EdgeEngineOptions["transport"];
}

/**
 * The anytts relay as a node `(req, res)` handler: `POST { text, voice }` →
 * `200 audio/mpeg`, or `400/403/413/502` JSON. It reads the raw request stream
 * itself, so it has to be mounted ahead of any body parser. `authorize` stays
 * unset: the panel's own auth middleware gates the route instead.
 */
export function createTtsHandler(
  options: TtsHandlerOptions = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  const { transport } = options;
  return toNodeHandler(
    createRelayHandler({ maxChars: MAX_CHARS, ...(transport ? { edge: { transport } } : {}) }),
  );
}
