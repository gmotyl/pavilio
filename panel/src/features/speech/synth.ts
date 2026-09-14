/**
 * Speech synthesis client, vendored from motyl's `lib/tts/client.ts`.
 *
 * It drives `edge-tts-universal/browser`'s `Communicate` class directly: the
 * simpler `EdgeTTS` / `EdgeTTSBrowser` wrappers never await the async DRM token
 * (`generateSecMsGec`) when they build the WebSocket URL, while
 * `Communicate.stream()` does.
 */

export interface SpeechSynthesisOptions {
  voice?: string;
  rate?: string;
  pitch?: string;
}

const DEFAULT_VOICE = "en-GB-RyanNeural";

/** edge-tts returns MP3 frames. */
export const SPEECH_AUDIO_MIME_TYPE = "audio/mpeg";

/**
 * Distinct synthesis results kept cached. Entries are compressed MP3 (tens of
 * KB), so a couple of hundred costs a few MB — enough headroom for the prefetch
 * ladder to warm several utterances ahead of the one that is playing.
 */
export const SPEECH_CACHE_MAX_ENTRIES = 200;

/** Absent, in flight, or in hand — the three answers the cache can give. */
export type SpeechCacheState = "cold" | "warming" | "ready";

/**
 * One cached synthesis: the promise callers dedupe onto, plus whether it has
 * resolved.
 *
 * The flag is the cheap way to split *in flight* from *in hand*. The promise
 * already knows — but only asynchronously, and the peek is called during
 * render, once per unit per open bar, so it cannot await anything. Flipping a
 * boolean in the promise's own `then` records that same fact synchronously,
 * stores nothing twice (the buffer stays in the promise), and keeps the peek a
 * Map lookup and a property read.
 */
interface SpeechCacheEntry {
  promise: Promise<ArrayBuffer>;
  /** True once `promise` has fulfilled. A rejection evicts instead. */
  ready: boolean;
}

/**
 * Module-level synthesis cache keyed by `${voice}::${text}`.
 *
 * It stores the in-flight promise, so concurrent callers (a prefetch racing the
 * real request) dedupe onto a single synthesis.
 *
 * Eviction is LRU: a Map preserves insertion order, so every *use* — a cache hit
 * in `synthesizeSpeech` — re-inserts the key at the most-recent end, and
 * eviction drops the least-recently-used (front) key. That protects a prefetched
 * unit that has not been played yet, which pure FIFO could not.
 */
const synthesisCache = new Map<string, SpeechCacheEntry>();

function cacheKey(voice: string, text: string): string {
  return `${voice}::${text}`;
}

const cacheListeners = new Set<() => void>();

/**
 * Announces that what a peek would report has changed somewhere.
 *
 * Listeners get no argument: the cache is keyed by voice+text and a reader
 * cares about a handful of keys, so re-peeking the keys it draws is cheaper
 * than delivering a payload every reader would have to filter. Fired once per
 * cache mutation — an add that forces an eviction is one mutation and one
 * notification, not two.
 */
function notifyCacheListeners(): void {
  for (const listener of cacheListeners) listener();
}

/**
 * Subscribes to cache changes; returns an unsubscribe.
 *
 * The scrubber reads the cache during render, and its only other re-render
 * trigger is playback progress — which publishes nothing while a run is paused
 * or stalled. Without this, a synthesis landing during a pause would be
 * invisible until playback resumed. Shaped for `useSyncExternalStore`.
 */
export function subscribeSpeechCache(listener: () => void): () => void {
  cacheListeners.add(listener);
  return () => {
    cacheListeners.delete(listener);
  };
}

/**
 * Whether this text is absent, still synthesizing, or in hand for this voice.
 *
 * This is the readiness answer — "would clicking this play with no wait" —
 * which {@link isSpeechSynthesized} cannot give, because the cache holds the
 * in-flight promise and so answers yes the moment the socket opens.
 *
 * Read-only in both senses: it does NOT touch the LRU (a scrubber asking on
 * every render is not a *use* of the audio and must not protect it from
 * eviction), and it starts nothing. Kept allocation-free — it runs during
 * render, once per unit per open bar.
 */
export function speechCacheState(
  text: string,
  options: SpeechSynthesisOptions = {},
): SpeechCacheState {
  if (!text || !text.trim()) return "cold";
  const entry = synthesisCache.get(cacheKey(options.voice || DEFAULT_VOICE, text));
  if (entry === undefined) return "cold";
  return entry.ready ? "ready" : "warming";
}

/**
 * Whether this text is in the synthesis cache for this voice — i.e. whether
 * playing it would start with no wait. Read-only: it does NOT touch the LRU,
 * because a scrubber asking "is this segment warm?" on every render is not a
 * use of the audio and must not protect it from eviction.
 *
 * It reports an in-flight synthesis as cached, exactly as `synthesizeSpeech`
 * treats one: the caller dedupes onto the same promise rather than paying for a
 * second synthesis. That is the dedupe question, not the readiness question —
 * for "is the audio actually in hand", ask {@link speechCacheState}.
 */
export function isSpeechSynthesized(
  text: string,
  options: SpeechSynthesisOptions = {},
): boolean {
  if (!text || !text.trim()) return false;
  return synthesisCache.has(cacheKey(options.voice || DEFAULT_VOICE, text));
}

/**
 * Marks a key most-recently-used by moving it to the end of the Map's order.
 *
 * Announces nothing: eviction order is not something a peek can report, so no
 * reader's answer changed. Notifying here would re-render every open bar on
 * every cache hit.
 */
function touchCache(key: string): void {
  const entry = synthesisCache.get(key);
  if (entry === undefined) return;
  synthesisCache.delete(key);
  synthesisCache.set(key, entry);
}

function storeInCache(key: string, promise: Promise<ArrayBuffer>): void {
  const entry: SpeechCacheEntry = { promise, ready: false };
  synthesisCache.set(key, entry);

  // LRU eviction changes what a peek reports for the dropped key — ready to
  // cold — so it has to be announced too. It happens inside this same
  // mutation, so the one notification below covers both the add and whatever
  // it pushed out; a reader re-peeks the keys it draws either way.
  while (synthesisCache.size > SPEECH_CACHE_MAX_ENTRIES) {
    const lru = synthesisCache.keys().next().value;
    if (lru === undefined) break;
    synthesisCache.delete(lru);
  }

  notifyCacheListeners();

  promise.then(
    () => {
      // A slow synthesis can land after its entry was evicted, or after a
      // retry replaced it. Only the entry still in the cache may settle, and
      // only a real transition announces.
      if (synthesisCache.get(key) !== entry) return;
      entry.ready = true;
      notifyCacheListeners();
    },
    () => {
      // Never cache a failure permanently: evict on rejection so a retry is
      // possible — and so the peek reports `cold`, the honest state for a unit
      // nothing is fetching, rather than a `warming` that never settles.
      if (synthesisCache.get(key) !== entry) return;
      synthesisCache.delete(key);
      notifyCacheListeners();
    },
  );
}

/**
 * The edge-tts WebSocket occasionally stalls mid-stream: it neither sends the
 * next audio frame nor closes, so `for await (... of communicate.stream())`
 * hangs forever with no error and no timeout anywhere upstream. Racing each
 * `.next()` against an inactivity timeout turns that hang into a rejection we
 * can retry.
 */
export const SPEECH_STREAM_STALL_TIMEOUT_MS = 15000;

class SpeechStreamStallError extends Error {
  constructor(timeoutMs: number) {
    super(`speech stream stalled: no data received for ${timeoutMs}ms`);
    this.name = "SpeechStreamStallError";
  }
}

async function collectAudio(
  text: string,
  options: SpeechSynthesisOptions,
  voice: string,
): Promise<ArrayBuffer> {
  const { Communicate } = await import("edge-tts-universal/browser");

  const communicate = new Communicate(text, {
    voice,
    rate: options.rate,
    pitch: options.pitch,
  });

  const iterator = communicate.stream()[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];

  while (true) {
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const next = await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new SpeechStreamStallError(SPEECH_STREAM_STALL_TIMEOUT_MS)),
          SPEECH_STREAM_STALL_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(timeoutHandle));

    if (next.done) break;
    if (next.value.type === "audio" && next.value.data) {
      chunks.push(next.value.data);
    }
  }

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const audio = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.length;
  }

  return audio.buffer;
}

async function synthesizeToBuffer(
  text: string,
  options: SpeechSynthesisOptions,
  voice: string,
): Promise<ArrayBuffer> {
  try {
    return await collectAudio(text, options, voice);
  } catch (err) {
    if (err instanceof SpeechStreamStallError) {
      // Transient: a fresh WebSocket usually succeeds. Retry once so a single
      // stalled connection surfaces as neither a hang nor a hard failure.
      console.warn("[speech] stream stalled, retrying on a fresh connection", err);
      return await collectAudio(text, options, voice);
    }
    throw err;
  }
}

/**
 * Synthesizes `text` and resolves to its MP3 audio. Results are cached by
 * resolved voice + text, so repeat calls resolve from cache and hand back the
 * same `ArrayBuffer` instance — wrap it with {@link toSpeechBlob} to play it.
 */
export async function synthesizeSpeech(
  text: string,
  options: SpeechSynthesisOptions = {},
): Promise<ArrayBuffer> {
  if (!text || !text.trim()) {
    // Surface it instead of caching an empty buffer forever. `prefetchSpeech`
    // guards this earlier; this protects direct callers.
    throw new Error("synthesizeSpeech: empty text");
  }

  const voice = options.voice || DEFAULT_VOICE;
  const key = cacheKey(voice, text);

  const cached = synthesisCache.get(key);
  if (cached) {
    touchCache(key); // LRU: reading an entry marks it most-recently-used.
    return cached.promise;
  }

  // Store the in-flight promise BEFORE awaiting so concurrent callers dedupe.
  const promise = synthesizeToBuffer(text, options, voice);
  storeInCache(key, promise);
  return promise;
}

/**
 * Wraps a cached buffer for an `<audio>` element. `new Blob([buffer])` COPIES
 * its input, so — unlike a Web Audio `decodeAudioData` step, which detaches it —
 * replay and play-from-here can wrap the same cached buffer again and again.
 */
export function toSpeechBlob(buffer: ArrayBuffer): Blob {
  return new Blob([buffer], { type: SPEECH_AUDIO_MIME_TYPE });
}

/**
 * Fire-and-forget warm of the synthesis cache. No-op on empty text; swallows
 * synthesis errors, since the eventual `synthesizeSpeech` call retries.
 *
 * Currently has no caller in the panel outside its own tests: the player's
 * cascade warms through `synthesizeSpeech` instead, because the promise is what
 * refills a window slot and a fire-and-forget warm — which nothing can observe
 * finishing — cannot bound concurrency at all.
 */
export function prefetchSpeech(text: string, options: SpeechSynthesisOptions = {}): void {
  if (!text || !text.trim()) return;
  void synthesizeSpeech(text, options).catch(() => {
    /* prefetch is best-effort; failures are handled on the real request */
  });
}
