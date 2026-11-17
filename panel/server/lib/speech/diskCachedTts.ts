import type { SynthesisRequest, SynthesisResult, Tts } from "anytts";
import type { AnswerAudioCache, AnswerKey, AnswerRecordKind } from "./answerAudioCache.js";

/** The cascade's engine id (anytts' `CASCADE`, not exported from the package entry). */
const CASCADE = "cascade";

export interface DiskCachedTtsOptions {
  /**
   * The cascade's configured member order, for a cascade request that sends no
   * `order` of its own. Without it, such a request is never stored.
   */
  cascadeOrder?: readonly string[];
}

interface Speaker {
  engine: string;
  voice: string;
}

/**
 * Wraps the relay's Tts so a unit already in the answer audio cache is
 * answered from disk without reaching the engine (and without passing through
 * the usage counter it wraps); a miss synthesizes through `tts` and stores the
 * bytes fire-and-forget, so the response never waits on the disk.
 *
 * Key: the requested engine, voice, language and text. A cascade request names
 * no single voice, so its member `voices`, `order` and `pronunciation` stand in
 * for the voice — changing any of them selects different audio. A request with
 * no engine cannot be looked up (the default engine is the inner instance's
 * private config), so it always synthesizes and is stored under the engine and
 * voice the result reports, where a later request naming them finds it. The
 * relay itself always names an engine: plain Edge never reaches this Tts.
 *
 * A request naming an engine but no voice for its speaker (its own `voice`;
 * for a cascade, the preferred member's entry in `voices`) is passed straight
 * through, neither read nor stored: it gets the engine's default, which the
 * server resolves against a catalog that can change at runtime (the OpenAI
 * catalog refresh rebuilds the holder), and the key cannot tell the old
 * default from the new one.
 *
 * A disk hit reports the engine and voice the original synthesis reported (for
 * a cascade, the member that spoke and its voice: the browser's relay client
 * rejects an answer without them). They live in a speaker record stored under
 * the same key as the audio (the store's `"speaker"` kind, a `.speaker.json`
 * file beside the `.mp3`, so the sweep and the clear route cover it), written
 * after the audio; audio without a
 * readable speaker record is a miss. A hit does not fire the request's
 * `onStart`/`onFirstByte` hooks; the relay passes none.
 *
 * Only a cascade answered by its preferred member is stored: the first member
 * of the request's `order` (else `options.cascadeOrder`) that is a configured
 * engine with a key. A fallback answer is a degraded voice, which must not
 * outlive the preferred member's recovery by the cache's TTL.
 *
 * The store is best-effort: a read or write that throws is treated as a miss /
 * no-op, never failing the synthesis, and logged once per kind for the life
 * of the wrapper.
 *
 * Every other `Tts` method delegates to `tts`, as in {@link countingTts}.
 */
export function diskCachedTts(tts: Tts, cache: AnswerAudioCache, options: DiskCachedTtsOptions = {}): Tts {
  const warned = new Set<"read" | "write">();

  async function synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    if (req.engine !== undefined && !namesVoice(req)) return tts.synthesize(req);
    const requested = req.engine === undefined ? undefined : keyOf(req, req.engine);
    if (requested) {
      const hit = await readHit(requested);
      if (hit) return hit;
    }
    const result = await tts.synthesize(req);
    if (req.engine !== CASCADE || result.engine === preferredMember(req)) {
      const key = requested ?? { ...keyOf(req, result.engine), voice: req.voice ?? result.voice };
      store(key, new Uint8Array(result.bytes), { engine: result.engine, voice: result.voice });
    }
    return result;
  }

  /** The audio and the speaker that produced it, or `undefined` unless both are readable. */
  async function readHit(key: AnswerKey): Promise<SynthesisResult | undefined> {
    const [bytes, record] = await Promise.all([readSafely(key), readSafely(key, "speaker")]);
    const speaker = record && parseSpeaker(record);
    if (!bytes || !speaker) return undefined;
    return { bytes: toArrayBuffer(bytes), mime: "audio/mpeg", engine: speaker.engine, voice: speaker.voice };
  }

  /**
   * The cascade member the request prefers: the first in its order that the
   * inner instance has configured with a key. `undefined` when no order is known.
   */
  function preferredMember(req: SynthesisRequest): string | undefined {
    const order = req.order ?? options.cascadeOrder ?? [];
    return order.find((id) => {
      if (id === CASCADE) return false;
      try {
        return tts.engineStatus(id).state !== "no-key";
      } catch {
        // RangeError: not a configured engine, so the walk drops it.
        return false;
      }
    });
  }

  /** Whether `req` names the voice it is spoken with: its own, or for a cascade the preferred member's. */
  function namesVoice(req: SynthesisRequest): boolean {
    if (req.engine !== CASCADE) return req.voice !== undefined;
    const member = preferredMember(req);
    return member !== undefined && req.voices?.[member] !== undefined;
  }

  /** Writes the audio, then its speaker record; fire-and-forget. */
  function store(key: AnswerKey, bytes: Uint8Array, speaker: Speaker): void {
    const record = new TextEncoder().encode(JSON.stringify(speaker));
    try {
      cache
        .write(key, bytes)
        .then(() => cache.write(key, record, "speaker"))
        .catch((err: unknown) => logFailure("write", err));
    } catch (err) {
      // A store that throws synchronously is logged the same way.
      logFailure("write", err);
    }
  }

  function logFailure(op: "read" | "write", err: unknown): void {
    if (warned.has(op)) return;
    warned.add(op);
    console.warn(`[answer-audio-cache] ${op} failed, synthesis unaffected:`, err instanceof Error ? err.message : err);
  }

  async function readSafely(key: AnswerKey, kind: AnswerRecordKind = "audio"): Promise<Uint8Array | undefined> {
    try {
      return await cache.read(key, kind);
    } catch (err) {
      logFailure("read", err);
      return undefined;
    }
  }

  // A Proxy rather than a hand-listed delegate, so a method anytts adds later
  // still reaches the inner instance.
  return new Proxy(tts, {
    get(target, prop) {
      if (prop === "synthesize") return synthesize;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** The store key for `req` under `engine`; cascade selection fields fold into the voice. */
function keyOf(req: SynthesisRequest, engine: string): AnswerKey {
  const cascade = req.voices !== undefined || req.order !== undefined || req.pronunciation !== undefined;
  const voice = cascade
    ? JSON.stringify([req.voice ?? null, sorted(req.voices), req.order ?? null, sorted(req.pronunciation)])
    : req.voice;
  return {
    engine,
    text: req.text,
    ...(voice !== undefined ? { voice } : {}),
    ...(req.lang !== undefined ? { lang: req.lang } : {}),
  };
}

/** A record's entries in key order, so `{a,b}` and `{b,a}` key the same. */
function sorted<T>(record: Record<string, T> | undefined): [string, T][] | null {
  return record === undefined ? null : Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** The speaker record's fields, or `undefined` when it is not one (never empty). */
function parseSpeaker(bytes: Uint8Array): Speaker | undefined {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<Speaker> | null;
    if (typeof value?.engine === "string" && value.engine && typeof value.voice === "string" && value.voice) {
      return { engine: value.engine, voice: value.voice };
    }
  } catch {
    // Unreadable: treated as missing.
  }
  return undefined;
}
