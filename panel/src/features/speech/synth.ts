/**
 * The panel's one seam over anytts.
 *
 * Every speech caller goes through these exports — and the many test files
 * that mock this module mock exactly these names — so the engine underneath
 * can change without either noticing. anytts owns synthesis, the request
 * scheduler (tiers, promotion, abort), the LRU cache and its in-flight dedupe,
 * the stall timeout and its retry, and the relay fallback for browsers that
 * cannot reach the Edge service directly, plus the Pronunciation map. This
 * module only translates: it builds each request from the preferences at call
 * time — the engine from `speech.engine`; under the cascade the member voices,
 * the order (only the members *In cascade*) and the pronunciation switches —
 * maps the library's cache states onto the panel's three words, and fans one
 * library subscription out to the panel's cache listeners.
 *
 * The keyed engines and the cascade are relay clients of the panel server,
 * which holds the keys; Edge alone has a route.
 *
 * The instance is created lazily, on first use, so importing the module (or a
 * test that mocks anytts) never builds one. Two preferences are baked into it
 * — `speech.route` (the edge engine's `mode`) and `speech.pronunciationByEngine`
 * (each engine's `pronunciation`, which a single-engine request cannot carry)
 * — so every use compares them against the ones the instance was built with
 * and rebuilds on a change, dropping the cache.
 */
import { createTts, resolveVoice, type SynthesisRequest, type Tts, type TtsConfig } from "anytts";
import { preferences } from "../../preferences/declarations";
import { readPreference } from "../../preferences/store";
import {
  CASCADE,
  SPEECH_ENGINES,
  cascadeVoicesOf,
  getCascadeOrder,
  isCascadeVoiceKey,
  speechEngines,
} from "./engines";
import { SPEECH_ROUTE_MODES, toSpeechRoute, type SpeechRoute } from "./route";

export interface SpeechSynthesisOptions {
  /** One engine's voice id, or under the cascade the session's member voices as one key. */
  voice?: string;
  /**
   * The text's language (`PreparedSpeech.language`): picks the Pronunciation
   * map anytts respells with, and a member's voice where none is named.
   */
  lang?: string;
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

/** Absent, in flight, or in hand — the three answers the cache can give. */
export type SpeechCacheState = "cold" | "warming" | "ready";

const TTS_CONFIG: TtsConfig = {
  engines: SPEECH_ENGINES,
  defaultEngine: "edge",
  scheduler: {
    concurrency: 3,
    tiers: [{ name: "run" }, { name: "warm", cap: 2 }, { name: "preload" }],
  },
  cache: { max: SPEECH_CACHE_MAX_ENTRIES },
};

/**
 * The config for `route` and the stored pronunciation switches: the edge
 * engine's `mode` is the route's, and an engine with a switch stored gets it
 * as its `pronunciation` (one without keeps anytts' default: Edge on, the
 * others off). The cascade's members are switched per request instead.
 */
function configFor(route: SpeechRoute, pronunciation: Readonly<Record<string, boolean>>): TtsConfig {
  const engines: TtsConfig["engines"] = { ...TTS_CONFIG.engines };
  for (const id of Object.keys(engines)) {
    if (id !== CASCADE && Object.hasOwn(pronunciation, id)) {
      engines[id] = { ...engines[id], pronunciation: pronunciation[id] };
    }
  }
  engines.edge = { ...engines.edge, mode: SPEECH_ROUTE_MODES[route] };
  return { ...TTS_CONFIG, engines };
}

/** What the instance is built from, as one comparable string. */
function instanceKey(route: SpeechRoute, pronunciation: Readonly<Record<string, boolean>>): string {
  const switches = Object.keys(pronunciation)
    .sort()
    .map((id) => [id, pronunciation[id]]);
  return JSON.stringify([route, switches]);
}

const cacheListeners = new Set<() => void>();
let libraryUnsubscribe: (() => void) | undefined;

let instance: Tts | undefined;
let instanceBuiltFrom: string | undefined;

/**
 * The instance for the route and pronunciation switches stored now. A change
 * lets the old instance go and builds a new one; the library subscription
 * moves with it, and the panel's listeners hear about the (now empty) cache
 * on a microtask, since this can run inside a render-time peek.
 */
function tts(): Tts {
  const route = toSpeechRoute(readPreference(preferences.speechRoute));
  const pronunciation = readPreference(preferences.speechPronunciationByEngine);
  const key = instanceKey(route, pronunciation);
  if (instance && instanceBuiltFrom === key) return instance;
  const swapped = instance !== undefined;
  instance = createTts(configFor(route, pronunciation));
  instanceBuiltFrom = key;
  if (swapped && libraryUnsubscribe) {
    libraryUnsubscribe();
    libraryUnsubscribe = instance.subscribe(notifyCacheListeners);
    queueMicrotask(notifyCacheListeners);
  }
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
  return speechEngines().includes(stored) ? stored : TTS_CONFIG.defaultEngine;
}

/**
 * The request for `text`, built from the preferences at call time.
 *
 * A cascade request names no `voice` (anytts refuses one): its `voices` come
 * from the session's cascade voice key, its `order` lists only the members
 * *In cascade*, and its `pronunciation` is the stored switches — over the
 * relay, the server respells per member. A single engine gets its `voice`
 * (never a cascade key, which a race with an engine change could hand it) and
 * respells in the browser from `lang`, by its configured switch.
 */
function request(text: string, options: SpeechSynthesisOptions): SynthesisRequest {
  const id = engine();
  const lang = options.lang || undefined;
  if (id === CASCADE) {
    const voices = cascadeVoicesOf(options.voice);
    return {
      text,
      engine: id,
      ...(lang ? { lang } : {}),
      ...(voices ? { voices } : {}),
      order: getCascadeOrder()
        .filter((member) => member.on)
        .map((member) => member.id),
      pronunciation: { ...readPreference(preferences.speechPronunciationByEngine) },
    };
  }
  const voice = options.voice && !isCascadeVoiceKey(options.voice) ? options.voice : undefined;
  return { text, voice, engine: id, ...(lang ? { lang } : {}) };
}

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
