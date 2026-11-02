import type { IncomingMessage, ServerResponse } from "node:http";
import type { EdgeEngineOptions, Tts } from "anytts";
import { createRelayHandler, toNodeHandler } from "anytts/server";
import { countingTts } from "../lib/speech/countingTts.js";
import { createTtsHolder, type TtsHolder } from "../lib/speech/ttsHolder.js";
import { createUsageStore, type UsageStore } from "../lib/speech/usage-store.js";

/** Longest `text` the relay synthesizes; longer requests get 413. */
const MAX_CHARS = 2000;

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

export interface TtsHandlerOptions {
  /** Read-aloud WebSocket factory; the route test injects a fake one. */
  transport?: EdgeEngineOptions["transport"];
  /** The server's Tts holder. Default: a fresh one built from the secrets store. */
  holder?: TtsHolder;
  /**
   * Where keyed-engine and cascade syntheses are counted. Default: a store on
   * the workspace usage directory, created on the first request.
   */
  usage?: UsageStore;
}

/**
 * The anytts relay as a node `(req, res)` handler: `POST { text, voice }` →
 * Edge, `POST { engine, … }` (a keyed engine or `cascade`) → the holder's
 * instance; `200 audio/mpeg`, or `400/403/413/502` JSON. It reads the raw
 * request stream itself, so it has to be mounted ahead of any body parser.
 *
 * Each request calls the relay built around the holder's *current* instance:
 * after `holder.rebuild()` the next request gets a new relay, while one already
 * running keeps the relay (and instance) it started with.
 *
 * Keyed-engine and cascade syntheses are counted in `usage` (see
 * {@link countingTts}); plain Edge requests are counted by the browser.
 */
export function createTtsHandler(options: TtsHandlerOptions = {}): NodeHandler {
  const { transport } = options;
  const holder = options.holder ?? createTtsHolder({ transport });
  let usage = options.usage;

  const relayFor = (tts: Tts): NodeHandler =>
    toNodeHandler(
      createRelayHandler({
        tts: countingTts(tts, (usage ??= createUsageStore())),
        maxChars: MAX_CHARS,
        // Every request is let through here: the panel's mobileAuthMiddleware
        // and authMiddleware guard the route before it reaches the relay.
        authorize: () => true,
        ...(transport ? { edge: { transport } } : {}),
      }),
    );

  let built: { tts: Tts; handler: NodeHandler } | undefined;
  return (req, res) => {
    const tts = holder.current();
    // Keyed by the holder's instance, not the counting wrapper around it.
    if (built?.tts !== tts) built = { tts, handler: relayFor(tts) };
    built.handler(req, res);
  };
}
