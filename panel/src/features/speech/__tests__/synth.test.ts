import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake `edge-tts-universal/browser` Communicate that counts instantiations and
// stream() invocations, so we can assert the synthesis cache prevents rework.
const edgeMock = vi.hoisted(() => {
  let constructCount = 0;
  let streamCount = 0;
  let shouldReject = false;
  let stallOnce = false;

  class FakeCommunicate {
    text: string;
    options: unknown;

    constructor(text: string, options: unknown) {
      this.text = text;
      this.options = options;
      constructCount += 1;
    }

    async *stream() {
      streamCount += 1;
      if (shouldReject) throw new Error("synthesis boom");
      if (stallOnce) {
        stallOnce = false;
        yield { type: "audio", data: new Uint8Array([1, 2, 3]) };
        // A WebSocket that neither sends the next frame nor closes — the
        // real-world "stalled stream" failure this mock stands in for.
        await new Promise(() => {});
        return;
      }
      yield { type: "audio", data: new Uint8Array([1, 2, 3]) };
    }
  }

  return {
    FakeCommunicate,
    get constructCount() {
      return constructCount;
    },
    get streamCount() {
      return streamCount;
    },
    setReject: (value: boolean) => {
      shouldReject = value;
    },
    setStallOnce: (value: boolean) => {
      stallOnce = value;
    },
    reset: () => {
      constructCount = 0;
      streamCount = 0;
      shouldReject = false;
      stallOnce = false;
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
  });

  it("keys on voice so a different voice re-synthesizes", async () => {
    await synthesizeSpeech("same text", { voice: "en-GB-RyanNeural" });
    await synthesizeSpeech("same text", { voice: "pl-PL-ZofiaNeural" });

    expect(edgeMock.constructCount).toBe(2);
    expect(edgeMock.streamCount).toBe(2);
  });

  it("prefetchSpeech warms the cache so a later synthesizeSpeech does not re-synthesize", async () => {
    prefetchSpeech("warm me", { voice: "en-GB-RyanNeural" });
    const buffer = await synthesizeSpeech("warm me", { voice: "en-GB-RyanNeural" });

    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(edgeMock.constructCount).toBe(1);
    expect(edgeMock.streamCount).toBe(1);
  });

  it("prefetchSpeech with empty or whitespace text does nothing", async () => {
    prefetchSpeech("", { voice: "en-GB-RyanNeural" });
    prefetchSpeech("   \n  ", { voice: "en-GB-RyanNeural" });
    await Promise.resolve();

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

  it("does not cache a rejected synthesis, so it can be retried", async () => {
    edgeMock.setReject(true);
    await expect(synthesizeSpeech("retry me", { voice: "en-GB-RyanNeural" })).rejects.toThrow();

    edgeMock.setReject(false);
    const buffer = await synthesizeSpeech("retry me", { voice: "en-GB-RyanNeural" });

    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(edgeMock.streamCount).toBe(2);
  });
});
