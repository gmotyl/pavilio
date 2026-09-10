import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Type tie to the real `edge-tts-universal/browser` `Communicate`: the fake
 * below must keep its constructor signature and `stream()` shape, so an
 * upstream signature change fails the typecheck instead of leaving a green
 * suite running against a stale fake while production breaks.
 *
 * Tied structurally rather than with `implements`, because the real class has
 * private fields that no other class can satisfy.
 */
type RealCommunicate = typeof import("edge-tts-universal/browser").Communicate;
type CommunicateOptions = ConstructorParameters<RealCommunicate>[1];
type CommunicateStream = ReturnType<InstanceType<RealCommunicate>["stream"]>;
type CommunicateContract = new (
  ...args: ConstructorParameters<RealCommunicate>
) => { stream(): CommunicateStream };

// Fake `edge-tts-universal/browser` Communicate that counts instantiations and
// stream() invocations and records what each construction was asked to say, so
// we can assert both that the synthesis cache prevents rework and that a
// caller's voice actually reaches the synthesizer.
const edgeMock = vi.hoisted(() => {
  let constructCount = 0;
  let streamCount = 0;
  let shouldReject = false;
  let stallOnce = false;
  let stallAlways = false;
  let constructions: Array<{ text: string; options: CommunicateOptions }> = [];

  const FakeCommunicate = class FakeCommunicate {
    text: string;
    options: CommunicateOptions;

    constructor(text: string, options?: CommunicateOptions) {
      this.text = text;
      this.options = options;
      constructCount += 1;
      constructions.push({ text, options });
    }

    async *stream(): CommunicateStream {
      streamCount += 1;
      if (shouldReject) throw new Error("synthesis boom");
      if (stallAlways || stallOnce) {
        stallOnce = false;
        yield { type: "audio", data: new Uint8Array([1, 2, 3]) };
        // A WebSocket that neither sends the next frame nor closes — the
        // real-world "stalled stream" failure this mock stands in for.
        await new Promise(() => {});
        return;
      }
      // edge-tts interleaves metadata frames between the audio frames. This one
      // carries no `data`, so the collector must skip it instead of folding it
      // into the buffer; the audio bytes still assemble to [1, 2, 3].
      yield { type: "audio", data: new Uint8Array([1, 2]) };
      yield { type: "WordBoundary", offset: 0, duration: 1_250_000, text: "hello" };
      yield { type: "audio", data: new Uint8Array([3]) };
    }
  } satisfies CommunicateContract;

  return {
    FakeCommunicate,
    get constructCount() {
      return constructCount;
    },
    get streamCount() {
      return streamCount;
    },
    /** What each `new Communicate(...)` was handed, in construction order. */
    get constructions() {
      return constructions;
    },
    setReject: (value: boolean) => {
      shouldReject = value;
    },
    setStallOnce: (value: boolean) => {
      stallOnce = value;
    },
    setStallAlways: (value: boolean) => {
      stallAlways = value;
    },
    reset: () => {
      constructCount = 0;
      streamCount = 0;
      shouldReject = false;
      stallOnce = false;
      stallAlways = false;
      constructions = [];
    },
  };
});

vi.mock("edge-tts-universal/browser", () => ({
  Communicate: edgeMock.FakeCommunicate,
}));

let synthesizeSpeech: typeof import("../synth").synthesizeSpeech;
let prefetchSpeech: typeof import("../synth").prefetchSpeech;
let toSpeechBlob: typeof import("../synth").toSpeechBlob;
let SPEECH_CACHE_MAX_ENTRIES: number;
let SPEECH_STREAM_STALL_TIMEOUT_MS: number;

/**
 * `prefetchSpeech` is fire-and-forget, and the synthesis it starts only reaches
 * `new Communicate(...)` after the dynamic `import()` inside `collectAudio`
 * settles (~17 microtasks today). Draining the microtask queue lets it get
 * there without a real-timer sleep; the drain is bounded, so a prefetch that
 * never synthesizes fails the following assertion instead of hanging.
 */
async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    await Promise.resolve();
  }
}

// The cache lives at module scope, so every test gets a fresh module instance.
beforeEach(async () => {
  vi.resetModules();
  edgeMock.reset();
  const mod = await import("../synth");
  synthesizeSpeech = mod.synthesizeSpeech;
  prefetchSpeech = mod.prefetchSpeech;
  toSpeechBlob = mod.toSpeechBlob;
  SPEECH_CACHE_MAX_ENTRIES = mod.SPEECH_CACHE_MAX_ENTRIES;
  SPEECH_STREAM_STALL_TIMEOUT_MS = mod.SPEECH_STREAM_STALL_TIMEOUT_MS;
});

describe("synthesizeSpeech cache", () => {
  it("caches by voice+text and synthesizes once for repeat calls", async () => {
    const first = await synthesizeSpeech("hello", { voice: "en-GB-RyanNeural" });
    const second = await synthesizeSpeech("hello", { voice: "en-GB-RyanNeural" });

    expect(edgeMock.constructCount).toBe(1);
    expect(edgeMock.streamCount).toBe(1);
    expect(second).toBe(first);
    // Only the audio frames are collected: the interleaved WordBoundary frame
    // carries no data and must not reach the buffer.
    expect(Array.from(new Uint8Array(first))).toEqual([1, 2, 3]);
  });

  it("keys on voice so a different voice re-synthesizes", async () => {
    await synthesizeSpeech("same text", { voice: "en-GB-RyanNeural" });
    await synthesizeSpeech("same text", { voice: "pl-PL-ZofiaNeural" });

    expect(edgeMock.constructCount).toBe(2);
    expect(edgeMock.streamCount).toBe(2);
    // Keying on voice is only half the contract: the requested voice must also
    // be the one handed to the synthesizer, and the text must pass through
    // unchanged. A hardcoded or dropped voice would still key correctly.
    expect(edgeMock.constructions.map((call) => call.options?.voice)).toEqual([
      "en-GB-RyanNeural",
      "pl-PL-ZofiaNeural",
    ]);
    expect(edgeMock.constructions.map((call) => call.text)).toEqual(["same text", "same text"]);
  });

  it("prefetchSpeech warms the cache so a later synthesizeSpeech does not re-synthesize", async () => {
    prefetchSpeech("warm me", { voice: "en-GB-RyanNeural" });

    // Assert the prefetch alone did the one and only synthesis, BEFORE the real
    // request. Without this, a `prefetchSpeech` that did nothing at all would
    // satisfy the final count identically.
    await drainMicrotasks();
    expect(edgeMock.constructCount).toBe(1);
    expect(edgeMock.streamCount).toBe(1);

    const buffer = await synthesizeSpeech("warm me", { voice: "en-GB-RyanNeural" });

    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(edgeMock.constructCount).toBe(1);
    expect(edgeMock.streamCount).toBe(1);
  });

  it("prefetchSpeech with empty or whitespace text does nothing", async () => {
    prefetchSpeech("", { voice: "en-GB-RyanNeural" });
    prefetchSpeech("   \n  ", { voice: "en-GB-RyanNeural" });
    await drainMicrotasks();

    expect(edgeMock.constructCount).toBe(0);
    expect(edgeMock.streamCount).toBe(0);
  });

  it("evicts the least-recently-used entry, not the least-recently-added", async () => {
    const voice = "en-GB-RyanNeural";
    const cap = SPEECH_CACHE_MAX_ENTRIES;

    for (let i = 0; i < cap; i += 1) {
      await synthesizeSpeech(`k-${i}`, { voice });
    }
    expect(edgeMock.constructCount).toBe(cap);

    // Read the least-recently-added entry (k-0): a hit marks it most-recently
    // used, so k-1 becomes the LRU. Reading must not re-synthesize.
    await synthesizeSpeech("k-0", { voice });
    expect(edgeMock.constructCount).toBe(cap);

    // Overflow the cap: the LRU (k-1) goes, the just-used k-0 stays.
    await synthesizeSpeech(`k-${cap}`, { voice });
    expect(edgeMock.constructCount).toBe(cap + 1);

    await synthesizeSpeech("k-0", { voice });
    expect(edgeMock.constructCount).toBe(cap + 1);

    await synthesizeSpeech("k-1", { voice });
    expect(edgeMock.constructCount).toBe(cap + 2);
  });

  it("wraps the cached buffer in a fresh Blob on every playback", async () => {
    const cached = await synthesizeSpeech("play me twice", { voice: "en-GB-RyanNeural" });

    const first = toSpeechBlob(cached);
    const second = toSpeechBlob(cached);

    expect(second).not.toBe(first);
    expect(first.type).toBe("audio/mpeg");
    expect(first.size).toBe(3);
    expect(second.size).toBe(3);
    // byteLength 0 would mean the buffer had been detached by a playback.
    expect(cached.byteLength).toBe(3);
    expect(await synthesizeSpeech("play me twice", { voice: "en-GB-RyanNeural" })).toBe(cached);
  });

  it("retries a stalled stream once on a fresh connection", async () => {
    vi.useFakeTimers();
    try {
      edgeMock.setStallOnce(true);

      const promise = synthesizeSpeech("stalls then recovers", { voice: "en-GB-RyanNeural" });
      // Let the stalled attempt's inactivity watchdog fire.
      await vi.advanceTimersByTimeAsync(SPEECH_STREAM_STALL_TIMEOUT_MS);
      const buffer = await promise;

      expect(buffer).toBeInstanceOf(ArrayBuffer);
      // First attempt stalled (connection 1), the retry succeeded (connection 2).
      expect(edgeMock.constructCount).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails after exactly one retry when every connection stalls", async () => {
    vi.useFakeTimers();
    try {
      edgeMock.setStallAlways(true);

      const promise = synthesizeSpeech("stalls forever", { voice: "en-GB-RyanNeural" });
      // Attach the rejection handler before advancing, so the failure is never
      // an unhandled rejection.
      const rejects = expect(promise).rejects.toThrow(/stalled/);
      // Let both attempts' inactivity watchdogs fire.
      await vi.advanceTimersByTimeAsync(SPEECH_STREAM_STALL_TIMEOUT_MS * 2 + 1);

      // The retry is bounded: one original connection plus exactly one retry,
      // and nothing beyond. Counted here, before awaiting the rejection, so an
      // unbounded retry reports a third connection rather than hanging.
      expect(edgeMock.constructCount).toBe(2);
      expect(edgeMock.streamCount).toBe(2);
      // ...and then the call fails, instead of looping on a socket that never
      // recovers — the exact hang this watchdog exists to prevent.
      await rejects;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not cache a rejected synthesis, so it can be retried", async () => {
    edgeMock.setReject(true);
    await expect(synthesizeSpeech("retry me", { voice: "en-GB-RyanNeural" })).rejects.toThrow();

    edgeMock.setReject(false);
    const buffer = await synthesizeSpeech("retry me", { voice: "en-GB-RyanNeural" });

    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(edgeMock.streamCount).toBe(2);
  });
});
