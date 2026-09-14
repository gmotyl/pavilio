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
let isSpeechSynthesized: typeof import("../synth").isSpeechSynthesized;
let speechCacheState: typeof import("../synth").speechCacheState;
let subscribeSpeechCache: typeof import("../synth").subscribeSpeechCache;
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
  isSpeechSynthesized = mod.isSpeechSynthesized;
  speechCacheState = mod.speechCacheState;
  subscribeSpeechCache = mod.subscribeSpeechCache;
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

  /**
   * The scrubber's `ready` segment — "clicking this starts with no wait" — is
   * the only consumer, and it asks on every render of every bar. So the peek
   * has two obligations, and the LRU one has teeth: a peek that counted as a
   * *use* would re-insert the key at the most-recent end, reordering eviction
   * behind a question nobody asked the audio for, and could evict the very unit
   * about to play. The eviction test above uses `synthesizeSpeech` as the
   * toucher and so says nothing about the peek; these two do.
   */
  it("reports whether a text is already in the cache for that voice", async () => {
    const voice = "en-GB-RyanNeural";

    expect(isSpeechSynthesized("warm me", { voice })).toBe(false);

    await synthesizeSpeech("warm me", { voice });
    expect(isSpeechSynthesized("warm me", { voice })).toBe(true);

    // Keyed on voice+text exactly as the cache is, and answering costs nothing:
    // a miss must not start a synthesis of its own.
    expect(isSpeechSynthesized("warm me", { voice: "pl-PL-ZofiaNeural" })).toBe(false);
    expect(isSpeechSynthesized("something else", { voice })).toBe(false);
    expect(isSpeechSynthesized("", { voice })).toBe(false);
    expect(edgeMock.constructCount).toBe(1);
  });

  it("peeking does not mark an entry recently used", async () => {
    const voice = "en-GB-RyanNeural";
    const cap = SPEECH_CACHE_MAX_ENTRIES;

    for (let i = 0; i < cap; i += 1) {
      await synthesizeSpeech(`k-${i}`, { voice });
    }
    expect(edgeMock.constructCount).toBe(cap);

    // k-0 is the LRU. Peek at it — repeatedly, the way a re-rendering bar
    // does. A peek that touched the LRU would promote it, and k-1 would become
    // the eviction candidate in its place.
    expect(isSpeechSynthesized("k-0", { voice })).toBe(true);
    expect(isSpeechSynthesized("k-0", { voice })).toBe(true);
    expect(edgeMock.constructCount).toBe(cap);

    // Overflow by one: the entry that goes is still k-0.
    await synthesizeSpeech(`k-${cap}`, { voice });
    expect(edgeMock.constructCount).toBe(cap + 1);

    expect(isSpeechSynthesized("k-0", { voice })).toBe(false);
    expect(isSpeechSynthesized("k-1", { voice })).toBe(true);
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

describe("speechCacheState", () => {
  const voice = "en-GB-RyanNeural";

  /**
   * The split `isSpeechSynthesized` could not express. The cache stores the
   * in-flight promise on purpose — a prefetch racing a real request must dedupe
   * onto one synthesis — so "there is an entry" is true the moment the socket
   * opens. That is the right dedupe answer and the wrong readiness answer: the
   * scrubber reading it flips three units to ready in the tick the cascade
   * opens its window, and the ladder looks like a single step.
   */
  it("reports warming while a synthesis is in flight and ready once it lands", async () => {
    const inFlight = synthesizeSpeech("in flight", { voice });

    expect(speechCacheState("in flight", { voice })).toBe("warming");
    // ...while the dedupe-shaped answer is unchanged: an entry exists, so a
    // second caller must join this synthesis rather than start another.
    expect(isSpeechSynthesized("in flight", { voice })).toBe(true);

    await inFlight;

    expect(speechCacheState("in flight", { voice })).toBe("ready");
    expect(isSpeechSynthesized("in flight", { voice })).toBe(true);
    expect(edgeMock.constructCount).toBe(1);
  });

  it("reports cold for a text nothing has requested", async () => {
    expect(speechCacheState("never asked", { voice })).toBe("cold");
    expect(speechCacheState("", { voice })).toBe("cold");
    expect(speechCacheState("   \n ", { voice })).toBe("cold");

    await synthesizeSpeech("asked", { voice });

    // Keyed on voice+text exactly as the cache is, and asking costs nothing: a
    // miss must not start a synthesis of its own.
    expect(speechCacheState("asked", { voice })).toBe("ready");
    expect(speechCacheState("asked", { voice: "pl-PL-ZofiaNeural" })).toBe("cold");
    expect(edgeMock.constructCount).toBe(1);
  });

  it("a rejected synthesis goes back to cold, not stuck warming", async () => {
    edgeMock.setReject(true);

    const failing = synthesizeSpeech("boom", { voice });
    expect(speechCacheState("boom", { voice })).toBe("warming");
    await expect(failing).rejects.toThrow();

    // `storeInCache` evicts on rejection so a retry is possible; the peek has
    // to agree with that, or a failed unit sits red forever with nothing
    // fetching it.
    expect(speechCacheState("boom", { voice })).toBe("cold");
    expect(isSpeechSynthesized("boom", { voice })).toBe(false);
  });

  it("notifies subscribers when an entry is added, settles and is evicted", async () => {
    let watched = "watch me";
    let notifications = 0;
    const seen: Array<"cold" | "warming" | "ready"> = [];
    const unsubscribe = subscribeSpeechCache(() => {
      notifications += 1;
      seen.push(speechCacheState(watched, { voice }));
    });
    /** What the most recent notification told a reader. */
    const lastSeen = () => seen[seen.length - 1];

    try {
      const inFlight = synthesizeSpeech("watch me", { voice });
      expect(notifications).toBe(1);
      expect(lastSeen()).toBe("warming");

      await inFlight;
      expect(notifications).toBe(2);
      expect(lastSeen()).toBe("ready");

      // A cache hit changes nothing a reader can see, so it announces nothing:
      // a notification per read would re-render every open bar on every peek.
      await synthesizeSpeech("watch me", { voice });
      expect(notifications).toBe(2);

      // An eviction with no add beside it — the rejection path — so the count
      // pins that the eviction itself announces, not merely the add that
      // happened to accompany it.
      watched = "fails";
      edgeMock.setReject(true);
      await expect(synthesizeSpeech("fails", { voice })).rejects.toThrow();

      expect(notifications).toBe(4); // the add, then the eviction
      expect(lastSeen()).toBe("cold");
    } finally {
      unsubscribe();
    }
  });

  it("unsubscribing stops the notifications", async () => {
    let first = 0;
    const unsubscribe = subscribeSpeechCache(() => {
      first += 1;
    });

    await synthesizeSpeech("one", { voice });
    expect(first).toBeGreaterThan(0);

    const atUnsubscribe = first;
    unsubscribe();
    await synthesizeSpeech("two", { voice });
    expect(first).toBe(atUnsubscribe);

    // Unsubscribing twice is harmless, and takes no later listener with it.
    unsubscribe();
    let second = 0;
    const unsubscribeSecond = subscribeSpeechCache(() => {
      second += 1;
    });
    await synthesizeSpeech("three", { voice });

    expect(second).toBeGreaterThan(0);
    expect(first).toBe(atUnsubscribe);
    unsubscribeSecond();
  });

  /**
   * Same teeth as the `isSpeechSynthesized` version above, for the peek the
   * scrubber will actually call: it asks on every render of every bar, and a
   * peek that counted as a *use* would re-insert the key at the most-recent
   * end and could evict the very unit about to play.
   */
  it("peeking still does not mark an entry recently used", async () => {
    const cap = SPEECH_CACHE_MAX_ENTRIES;

    for (let i = 0; i < cap; i += 1) {
      await synthesizeSpeech(`k-${i}`, { voice });
    }
    expect(edgeMock.constructCount).toBe(cap);

    // k-0 is the LRU. Peek at it repeatedly, the way a re-rendering bar does.
    expect(speechCacheState("k-0", { voice })).toBe("ready");
    expect(speechCacheState("k-0", { voice })).toBe("ready");
    expect(edgeMock.constructCount).toBe(cap);

    // Overflow by one: the entry that goes is still k-0.
    await synthesizeSpeech(`k-${cap}`, { voice });
    expect(edgeMock.constructCount).toBe(cap + 1);

    expect(speechCacheState("k-0", { voice })).toBe("cold");
    expect(speechCacheState("k-1", { voice })).toBe("ready");
  });

  /**
   * A notification is a broadcast to every reader, and one bad reader must not
   * silence the others: a listener that throws would otherwise abort the `for`
   * and leave every subscriber after it holding a stale answer — a scrubber
   * stuck on `warming` for audio that is already in hand. The throw is
   * isolated and reported once, on `console.error`; the round continues.
   */
  it("a listener that throws does not stop the rest of the round", async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    let later = 0;
    const unsubscribeThrower = subscribeSpeechCache(() => {
      throw new Error("listener boom");
    });
    const unsubscribeLater = subscribeSpeechCache(() => {
      later += 1;
    });

    try {
      // The add notifies synchronously inside `synthesizeSpeech`, so an
      // un-isolated throw surfaces here as a rejected synthesis too.
      await expect(synthesizeSpeech("throwing round", { voice })).resolves.toBeInstanceOf(
        ArrayBuffer,
      );

      expect(later).toBe(2); // the add, then the settle
      expect(reported).toHaveBeenCalled();
    } finally {
      unsubscribeThrower();
      unsubscribeLater();
      reported.mockRestore();
    }
  });

  /**
   * React unsubscribes during a notification as a matter of course — a bar
   * unmounting, or `useSyncExternalStore` re-subscribing because its arguments
   * changed identity. Iterating the live `Set` lets one listener's unsubscribe
   * drop a *later* listener out of the round it was already part of, which is a
   * reader silently missing the update. Notifying from a snapshot fixes the
   * membership when the round begins: whoever was subscribed then hears it, and
   * the unsubscribe takes effect from the next round.
   */
  it("notifies every listener subscribed when the round began, even if one unsubscribes another", async () => {
    let dropSecond: () => void = () => {};
    let secondCalls = 0;

    const unsubscribeFirst = subscribeSpeechCache(() => {
      dropSecond();
    });
    const unsubscribeSecond = subscribeSpeechCache(() => {
      secondCalls += 1;
    });
    dropSecond = unsubscribeSecond;

    try {
      await synthesizeSpeech("snapshot me", { voice });

      // The add's round: the first listener unsubscribed the second while the
      // round was in flight, and the second still heard that round.
      expect(secondCalls).toBe(1);

      // ...and the unsubscribe really took, from the next round on.
      await synthesizeSpeech("snapshot me again", { voice });
      expect(secondCalls).toBe(1);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
    }
  });

  /**
   * The acceptance criterion is "added, settles *or is evicted*", and the
   * rejection path above covers only the eviction that has no add beside it.
   * This is the other one: an overflowing add evicts the LRU, and the two share
   * a single notification on purpose — one mutation, one notification, readers
   * re-peek. Sharing is only correct if the eviction has already happened when
   * that notification goes out. Moving the `notifyCacheListeners()` above the
   * eviction loop keeps the count identical and every other test green, and
   * leaves a bar drawing the dropped unit as `ready` until something else
   * happens to announce.
   */
  it("announces the LRU eviction inside the overflowing add's own notification", async () => {
    const cap = SPEECH_CACHE_MAX_ENTRIES;

    for (let i = 0; i < cap; i += 1) {
      await synthesizeSpeech(`k-${i}`, { voice });
    }
    expect(speechCacheState("k-0", { voice })).toBe("ready");

    // Subscribe only now, so the first thing this listener hears is the add
    // that overflows the cap.
    const seen: Array<"cold" | "warming" | "ready"> = [];
    const unsubscribe = subscribeSpeechCache(() => {
      seen.push(speechCacheState("k-0", { voice }));
    });

    try {
      await synthesizeSpeech(`k-${cap}`, { voice });

      expect(seen.length).toBeGreaterThan(0);
      expect(seen[0]).toBe("cold");
      expect(speechCacheState("k-0", { voice })).toBe("cold");
    } finally {
      unsubscribe();
    }
  });
});
