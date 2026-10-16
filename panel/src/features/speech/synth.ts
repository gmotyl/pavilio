/**
 * The panel's one seam over anytts.
 *
 * Every speech caller goes through these exports — and the many test files
 * that mock this module mock exactly these names — so the engine underneath
 * can change without either noticing. anytts owns synthesis, the request
 * scheduler (tiers, promotion, abort), the LRU cache and its in-flight dedupe,
 * the stall timeout and its retry, and the relay fallback for browsers that
 * cannot reach the Edge service directly. This module only translates: it
 * picks the engine from the `speech.engine` preference, maps the library's
 * cache states onto the panel's three words, and fans one library
 * subscription out to the panel's cache listeners.
 *
 * The instance is created lazily, on first use, so importing the module (or a
 * test that mocks anytts) never builds one.
 */
import { createTts, resolveVoice, type SynthesisRequest, type Tts, type TtsConfig } from "anytts";
import { DEFAULT_SPEECH_VOICE, preferences } from "../../preferences/declarations";
import { readPreference } from "../../preferences/store";

export interface SpeechSynthesisOptions {
  voice?: string;
  /** Scheduler tier, most important first: `run` > `warm` > `preload`. */
  tier?: "run" | "warm" | "preload";
  /** Aborting removes a queued request; an in-flight one closes once nobody holds it. */
  signal?: AbortSignal;
}

/** Edge returns MP3 frames. */
export const SPEECH_AUDIO_MIME_TYPE = "audio/mpeg";

/**
 * Distinct synthesis results kept cached. Entries are compressed MP3 (tens of
 * KB), so a couple of hundred costs a few MB — enough headroom to warm several
 * utterances ahead of the one that is playing.
 */
export const SPEECH_CACHE_MAX_ENTRIES = 200;

/** Max gap between audio chunks before anytts treats the stream as stalled and retries. */
export const SPEECH_STREAM_STALL_TIMEOUT_MS = 15000;

/** Absent, in flight, or in hand — the three answers the cache can give. */
export type SpeechCacheState = "cold" | "warming" | "ready";

const TTS_CONFIG: TtsConfig = {
  engines: {
    edge: {
      voices: { default: DEFAULT_SPEECH_VOICE },
      // The panel server mounts anytts' relay here for browsers that cannot
      // open the Edge socket themselves.
      relayUrl: "/api/tts",
      stallMs: SPEECH_STREAM_STALL_TIMEOUT_MS,
    },
  },
  defaultEngine: "edge",
  scheduler: {
    concurrency: 3,
    tiers: [{ name: "run" }, { name: "warm", cap: 2 }, { name: "preload" }],
  },
  cache: { max: SPEECH_CACHE_MAX_ENTRIES },
};

let instance: Tts | undefined;

function tts(): Tts {
  instance ??= createTts(TTS_CONFIG);
  return instance;
}

function isBlank(text: string): boolean {
  return !text || !text.trim();
}

/**
 * The engine from the preference, read at call time. The codec is `str`, so a
 * blank or stale id can be stored; one this instance does not configure would
 * make anytts throw RangeError, so it synthesizes with the default engine.
 */
function engine(): string {
  const stored = readPreference(preferences.speechEngine);
  return Object.hasOwn(TTS_CONFIG.engines, stored) ? stored : TTS_CONFIG.defaultEngine;
}

/** The request for `text`, with the engine read from the preference at call time. */
function request(text: string, options: SpeechSynthesisOptions): SynthesisRequest {
  return {
    text,
    voice: options.voice || undefined,
    engine: engine(),
  };
}

const cacheListeners = new Set<() => void>();
let libraryUnsubscribe: (() => void) | undefined;

/**
 * Announces that what a peek would report has changed somewhere — once per
 * library event (`pending`, `add`, `drop`, `evict`).
 *
 * Listeners get no argument: a reader re-peeks the handful of keys it draws.
 * The round iterates a snapshot, because React unsubscribes during a
 * notification as a matter of course and a live `Set` would let one
 * unsubscribe drop a listener that had not been reached yet. A throwing
 * listener is logged and skipped, never re-thrown: one bad reader must not
 * leave every subscriber after it holding a stale answer.
 */
function notifyCacheListeners(): void {
  for (const listener of [...cacheListeners]) {
    try {
      listener();
    } catch (err) {
      console.error("[speech] cache listener threw; continuing the round", err);
    }
  }
}

/** Subscribes to cache changes; returns the unsubscribe. */
export function subscribeSpeechCache(listener: () => void): () => void {
  cacheListeners.add(listener);
  // One library subscription serves every panel listener, for the module's life.
  libraryUnsubscribe ??= tts().subscribe(notifyCacheListeners);
  return () => {
    cacheListeners.delete(listener);
  };
}

/**
 * Whether this text is absent, still synthesizing (queued or running), or in
 * hand for this voice. Read-only: it starts nothing and does not count as a
 * use for the LRU, so a scrubber may ask on every render.
 */
export function speechCacheState(
  text: string,
  options: SpeechSynthesisOptions = {},
): SpeechCacheState {
  if (isBlank(text)) return "cold";
  const state = tts().state(request(text, options));
  if (state === "pending") return "warming";
  if (state === "ready") return "ready";
  return "cold";
}

/**
 * Whether a synthesis of this text is in flight or in hand — the dedupe
 * question ("would a request join existing work"), not the readiness one; for
 * "is the audio actually in hand", ask {@link speechCacheState}.
 */
export function isSpeechSynthesized(
  text: string,
  options: SpeechSynthesisOptions = {},
): boolean {
  return speechCacheState(text, options) !== "cold";
}

/**
 * Synthesizes `text` and resolves to its MP3 audio. Repeat calls resolve from
 * the library's cache and hand back the same `ArrayBuffer` — wrap it with
 * {@link toSpeechBlob} to play it; never detach or transfer it.
 */
export async function synthesizeSpeech(
  text: string,
  options: SpeechSynthesisOptions = {},
): Promise<ArrayBuffer> {
  if (isBlank(text)) {
    // Surface it instead of asking the engine for silence.
    throw new Error("synthesizeSpeech: empty text");
  }
  const result = await tts().synthesize({
    ...request(text, options),
    tier: options.tier ?? "run",
    signal: options.signal,
  });
  return result.bytes;
}

/**
 * Wraps a cached buffer for an `<audio>` element. `new Blob([buffer])` COPIES
 * its input, so replay and play-from-here can wrap the same cached buffer
 * again and again.
 */
export function toSpeechBlob(buffer: ArrayBuffer): Blob {
  return new Blob([buffer], { type: SPEECH_AUDIO_MIME_TYPE });
}

/**
 * Fire-and-forget warm of the cache. No-op on blank text; the library
 * swallows failures, since the eventual `synthesizeSpeech` call retries. With
 * no tier given it queues as `preload`, the least important work.
 */
export function prefetchSpeech(text: string, options: SpeechSynthesisOptions = {}): void {
  if (isBlank(text)) return;
  tts().prefetch({
    ...request(text, options),
    tier: options.tier ?? "preload",
    signal: options.signal,
  });
}

/**
 * Lenient voice resolution for settings: a voice outside `engine`'s catalog
 * falls back to the engine default with `fellBack: true`.
 */
export function resolveSpeechVoice(q: { engine: string; voice?: string }): {
  voice: string;
  fellBack: boolean;
} {
  return resolveVoice(tts(), q);
}
