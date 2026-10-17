/**
 * A stand-in for `../synth` shaped like the anytts instance behind it, for the
 * host suites that care about tiers and abort.
 *
 * What it models of the library, and nothing more:
 *
 * - a request is queued (here: "held") or answered at CALL time — there is no
 *   window in the panel any more, so the call is the request;
 * - one flight per voice + text, joined by every later caller, whatever tier
 *   it asks on (a join on a higher tier is the library's promotion, recorded in
 *   `calls`);
 * - each caller's `signal` aborts only that caller, with an `AbortError`; the
 *   flight is dropped once no caller is left (a held flight leaves `held`);
 * - a failure is never cached, a result is, and `clearCache` models LRU
 *   eviction of results (never of flights).
 *
 * `requests` keeps its old meaning — what reached the synthesizer — so the
 * suites' "requested once" claims still read the same.
 */

export interface SynthCall {
  text: string;
  voice: string | undefined;
  tier: string | undefined;
  signal: AbortSignal | undefined;
}

interface SynthOptions {
  voice?: string;
  tier?: string;
  signal?: AbortSignal;
}

interface Flight {
  readonly text: string;
  readonly promise: Promise<ArrayBuffer>;
  callers: number;
  resolve: (buffer: ArrayBuffer) => void;
  reject: (error: unknown) => void;
}

/** The shape anytts rejects an aborted caller with. */
const abortError = (): DOMException => new DOMException("The operation was aborted.", "AbortError");

export function createTieredSynth() {
  const buffers = new Map<string, ArrayBuffer>();
  const bufferText = new Map<ArrayBuffer, string>();
  const blobText = new Map<Blob, string>();
  const ready = new Map<string, ArrayBuffer>();
  const flights = new Map<string, Flight>();
  /** Texts whose synthesis is held open until `release`/`fail` says otherwise. */
  const holds = new Set<string>();
  /** Held flights by text, oldest request first. */
  const waiting = new Map<string, string>();
  let calls: SynthCall[] = [];
  let requests: SynthCall[] = [];
  /** The most syntheses ever held open at the same moment. */
  let peakHeld = 0;

  const keyOf = (text: string, voice: string | undefined): string => `${voice ?? ""}::${text}`;

  function bufferFor(text: string): ArrayBuffer {
    const existing = buffers.get(text);
    if (existing) return existing;

    const buffer = new Uint8Array([text.length % 255]).buffer;
    buffers.set(text, buffer);
    bufferText.set(buffer, text);
    return buffer;
  }

  function synthesizeSpeech(text: string, options: SynthOptions = {}): Promise<ArrayBuffer> {
    const { signal } = options;
    const call: SynthCall = { text, voice: options.voice, tier: options.tier, signal };
    calls.push(call);
    if (signal?.aborted) return Promise.reject(abortError());

    const key = keyOf(text, options.voice);
    const hit = ready.get(key);
    if (hit) return Promise.resolve(hit);

    let flight = flights.get(key);
    if (!flight) {
      requests.push(call);
      if (!holds.has(text)) {
        const buffer = bufferFor(text);
        ready.set(key, buffer);
        return Promise.resolve(buffer);
      }
      let resolve: (buffer: ArrayBuffer) => void = () => {};
      let reject: (error: unknown) => void = () => {};
      const promise = new Promise<ArrayBuffer>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      // Every caller attaches its own handlers; the flight itself must not
      // surface as an unhandled rejection when the last caller has left.
      promise.catch(() => {});
      flight = { text, promise, callers: 0, resolve, reject };
      flights.set(key, flight);
      waiting.set(text, key);
      peakHeld = Math.max(peakHeld, waiting.size);
    }

    const joined = flight;
    joined.callers += 1;
    return new Promise<ArrayBuffer>((resolve, reject) => {
      let settled = false;
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        joined.callers -= 1;
        // Nobody is waiting any more: the library drops the job.
        if (joined.callers === 0 && flights.get(key) === joined) {
          flights.delete(key);
          if (waiting.get(joined.text) === key) waiting.delete(joined.text);
        }
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      joined.promise.then(
        (buffer) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          resolve(buffer);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  function settle(text: string, outcome: "release" | "fail"): void {
    const key = waiting.get(text);
    const flight = key === undefined ? undefined : flights.get(key);
    if (key === undefined || !flight) throw new Error(`no synthesis is being held for ${text}`);
    waiting.delete(text);
    holds.delete(text);
    flights.delete(key);
    if (outcome === "release") {
      // Cached before the callers hear of it, as the library does.
      const buffer = bufferFor(text);
      ready.set(key, buffer);
      flight.resolve(buffer);
    } else {
      flight.reject(new Error(`synthesis failed: ${text}`));
    }
  }

  return {
    synthesizeSpeech,
    /** Exactly what the real one is: a fire-and-forget `synthesizeSpeech`. */
    prefetchSpeech: (text: string, options: SynthOptions = {}): void => {
      void synthesizeSpeech(text, options).catch(() => {});
    },
    toSpeechBlob: (buffer: ArrayBuffer): Blob => {
      const blob = new Blob([buffer], { type: "audio/mpeg" });
      blobText.set(blob, bufferText.get(buffer) ?? "unknown");
      return blob;
    },
    /** The real one's peek: `speechCacheState !== "cold"` — cached or in flight. */
    isSpeechSynthesized: (text: string, options: SynthOptions = {}): boolean => {
      const key = keyOf(text, options.voice);
      return ready.has(key) || flights.has(key);
    },
    textForBlob: (blob: Blob): string => blobText.get(blob) ?? "unknown",
    /** Holds this text's synthesis open, so "while it is warming" is observable. */
    hold: (text: string): void => {
      holds.add(text);
    },
    release: (text: string): void => settle(text, "release"),
    fail: (text: string): void => settle(text, "fail"),
    /** What reached the synthesizer: one entry per new flight. */
    get requests() {
      return requests;
    },
    /** Every call, joins and cache hits included, with its tier and signal. */
    get calls() {
      return calls;
    },
    /** The calls made for one text, in order. */
    callsFor: (text: string): SynthCall[] => calls.filter((call) => call.text === text),
    /** How many syntheses are held open right now. */
    get held() {
      return waiting.size;
    },
    /** The held texts, oldest request first. */
    get heldTexts() {
      return [...waiting.keys()];
    },
    get peakHeld() {
      return peakHeld;
    },
    /** Evicts every synthesized result, so a re-request is visible. */
    clearCache: (): void => {
      ready.clear();
    },
    reset: (): void => {
      calls = [];
      requests = [];
      peakHeld = 0;
      ready.clear();
      flights.clear();
      holds.clear();
      waiting.clear();
    },
  };
}
