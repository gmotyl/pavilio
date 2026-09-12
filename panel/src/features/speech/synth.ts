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
const synthesisCache = new Map<string, Promise<ArrayBuffer>>();

function cacheKey(voice: string, text: string): string {
  return `${voice}::${text}`;
}

/** Marks a key most-recently-used by moving it to the end of the Map's order. */
function touchCache(key: string): void {
  const promise = synthesisCache.get(key);
  if (promise === undefined) return;
  synthesisCache.delete(key);
  synthesisCache.set(key, promise);
}

function storeInCache(key: string, promise: Promise<ArrayBuffer>): void {
  synthesisCache.set(key, promise);

  while (synthesisCache.size > SPEECH_CACHE_MAX_ENTRIES) {
    const lru = synthesisCache.keys().next().value;
    if (lru === undefined) break;
    synthesisCache.delete(lru);
  }

  // Never cache a failure permanently: evict on rejection so a retry is possible.
  promise.catch(() => {
    if (synthesisCache.get(key) === promise) {
      synthesisCache.delete(key);
    }
  });
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
    return cached;
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
