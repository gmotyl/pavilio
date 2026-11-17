import type { SynthesisRequest, SynthesisResult, Tts } from "anytts";
import type { AnswerAudioCache, AnswerKey } from "./answerAudioCache.js";

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
 * A disk hit reports the requested engine and voice (for a cascade, `cascade`
 * and an empty voice: which member spoke is not stored). It does not fire the
 * request's `onStart`/`onFirstByte` hooks; the relay passes none.
 *
 * The store is best-effort: a read or write that throws is logged and treated
 * as a miss / no-op, never failing the synthesis.
 *
 * Every other `Tts` method delegates to `tts`, as in {@link countingTts}.
 */
export function diskCachedTts(tts: Tts, cache: AnswerAudioCache): Tts {
  async function synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const requested = req.engine === undefined ? undefined : keyOf(req, req.engine);
    if (requested) {
      const stored = await readSafely(requested);
      if (stored) {
        return { bytes: toArrayBuffer(stored), mime: "audio/mpeg", engine: requested.engine, voice: req.voice ?? "" };
      }
    }
    const result = await tts.synthesize(req);
    const key = requested ?? { ...keyOf(req, result.engine), voice: req.voice ?? result.voice };
    writeSafely(key, new Uint8Array(result.bytes));
    return result;
  }

  async function readSafely(key: AnswerKey): Promise<Uint8Array | undefined> {
    try {
      return await cache.read(key);
    } catch (err) {
      logFailure("read", err);
      return undefined;
    }
  }

  function writeSafely(key: AnswerKey, bytes: Uint8Array): void {
    try {
      cache.write(key, bytes).catch((err: unknown) => logFailure("write", err));
    } catch (err) {
      // A store that throws synchronously is logged the same way.
      logFailure("write", err);
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

function logFailure(op: "read" | "write", err: unknown): void {
  console.warn(`[answer-audio-cache] ${op} failed, synthesis unaffected:`, err instanceof Error ? err.message : err);
}
