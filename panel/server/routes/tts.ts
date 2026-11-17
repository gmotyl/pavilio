import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveVoice, type EdgeEngineOptions, type Tts } from "anytts";
import { createRelayHandler, toNodeHandler } from "anytts/server";
import type { AnswerAudioCache } from "../lib/speech/answerAudioCache.js";
import { countingTts } from "../lib/speech/countingTts.js";
import { diskCachedTts } from "../lib/speech/diskCachedTts.js";
import { CASCADE_ORDER, createTtsHolder, type TtsHolder } from "../lib/speech/ttsHolder.js";
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
  /**
   * The answer audio disk store the relay reads before synthesizing and writes
   * after a miss (see {@link diskCachedTts}). Default: none — no disk caching,
   * so a handler built without one (every route test) never touches the real
   * home directory; the panel server passes its one store.
   */
  answerCache?: AnswerAudioCache;
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
 * {@link countingTts}); plain Edge requests are counted by the browser. With
 * an `answerCache`, a unit already on disk is answered from it ahead of the
 * counter, so a disk hit is neither synthesized nor counted.
 */
export function createTtsHandler(options: TtsHandlerOptions = {}): NodeHandler {
  const { transport, answerCache } = options;
  const holder = options.holder ?? createTtsHolder({ transport });
  let usage = options.usage;

  const relayFor = (tts: Tts): NodeHandler => {
    const counted = countingTts(tts, (usage ??= createUsageStore()));
    return toNodeHandler(
      createRelayHandler({
        tts: answerCache
          ? diskCachedTts(counted, answerCache, {
              cascadeOrder: CASCADE_ORDER,
              // This instance's default, the one it will speak a voice-less request
              // with: a rebuild (e.g. a catalog refresh) builds a new relay, and so
              // a new resolver. Asked of the instance itself: anytts finds an
              // instance's voice maps by identity, not through the counting wrapper.
              defaultVoice: (engine, lang) =>
                resolveVoice(tts, { engine, ...(lang !== undefined ? { lang } : {}) }).voice,
            })
          : counted,
        maxChars: MAX_CHARS,
        // Every request is let through here: the panel's mobileAuthMiddleware
        // and authMiddleware guard the route before it reaches the relay.
        authorize: () => true,
        ...(transport ? { edge: { transport } } : {}),
      }),
    );
  };

  let built: { tts: Tts; handler: NodeHandler } | undefined;
  return (req, res) => {
    const tts = holder.current();
    // Keyed by the holder's instance, not the counting wrapper around it.
    if (built?.tts !== tts) built = { tts, handler: relayFor(tts) };
    built.handler(req, res);
  };
}
