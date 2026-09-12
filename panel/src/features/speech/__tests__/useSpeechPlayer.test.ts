import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deferred, per-text control over the vendored synthesis client. The player
 * must never open the real edge-tts socket, and every test here needs to say
 * which unit synthesizes, which one fails, and which one never resolves at all
 * — "never resolves" is the only way to prove that a unit was not awaited.
 *
 * The fake also records the resolved voice of every request. `synth.ts` keeps a
 * private `DEFAULT_VOICE = "en-GB-RyanNeural"` inherited from motyl, so a
 * caller that omits the voice silently gets Ryan instead of the panel's Andrew
 * default; these recordings are what pin that the player always passes one.
 */
const synth = vi.hoisted(() => {
  type Mode = "resolve" | "reject" | "hang" | "defer";

  const modes = new Map<string, Mode>();
  /** Resolvers for the units held in "defer" mode, keyed by unit text. */
  const releases = new Map<string, () => void>();
  const buffers = new Map<string, ArrayBuffer>();
  const bufferText = new Map<ArrayBuffer, string>();
  const blobText = new Map<Blob, string>();
  /**
   * The real module's cache, keyed on voice + text exactly as `synth.ts` keys
   * it: a second caller is handed the promise the first one started — whether
   * it is still in flight or long since resolved — and a rejection is evicted
   * so a retry can reach the synthesizer again. A stub that re-synthesized on
   * every call would make the window's occupancy a fiction, since the ladder
   * materializing a unit the window already warmed would read here as a
   * connection production never opens.
   */
  let cache = new Map<string, { text: string; promise: Promise<ArrayBuffer>; done: boolean }>();
  let peakInFlight = 0;
  /**
   * Requests and playback starts in one ordered list. Two separate arrays
   * cannot say which came first, and "unit 1 was requested *while* unit 0 was
   * playing" is exactly an ordering claim.
   */
  let timeline: string[] = [];
  let requests: Array<{ text: string; voice: string | undefined }> = [];
  let prefetches: Array<{ text: string; voice: string | undefined }> = [];
  let blobbed: ArrayBuffer[] = [];

  function bufferFor(text: string): ArrayBuffer {
    const existing = buffers.get(text);
    if (existing) return existing;

    const buffer = new Uint8Array([text.length]).buffer;
    buffers.set(text, buffer);
    bufferText.set(buffer, text);
    return buffer;
  }

  /** The cache entries still waiting on the synthesizer, in request order. */
  function inFlightEntries(): Array<{ text: string; done: boolean }> {
    return [...cache.values()].filter((entry) => !entry.done);
  }

  /** What this unit's synthesis does, per the mode the test set for it. */
  function answer(text: string): Promise<ArrayBuffer> {
    const mode = modes.get(text) ?? "resolve";
    if (mode === "hang") return new Promise<ArrayBuffer>(() => {});
    if (mode === "defer") {
      return new Promise<ArrayBuffer>((resolve) => {
        releases.set(text, () => resolve(bufferFor(text)));
      });
    }
    if (mode === "reject") return Promise.reject(new Error(`synthesis failed: ${text}`));
    return Promise.resolve(bufferFor(text));
  }

  return {
    synthesizeSpeech: (text: string, options: { voice?: string } = {}): Promise<ArrayBuffer> => {
      const key = `${options.voice ?? ""}::${text}`;
      const cached = cache.get(key);
      // A hit is a *recorded* non-request: the caller is served what is already
      // there, which is exactly what "no second request is made" means.
      if (cached) return cached.promise;

      requests.push({ text, voice: options.voice });
      timeline.push(`synthesize:${text}`);

      const promise = answer(text);
      const entry = { text, promise, done: false };
      cache.set(key, entry);
      peakInFlight = Math.max(peakInFlight, inFlightEntries().length);
      // Registered before the caller's own continuation, so a unit has already
      // left the window by the time the player reacts to it landing — which is
      // what makes "at most three in flight" measurable at all.
      promise.then(
        () => {
          entry.done = true;
        },
        () => {
          entry.done = true;
          // Never cache a failure, as the real module does not: the retry the
          // ladder makes when it reaches the unit has to reach the synthesizer.
          if (cache.get(key) === entry) cache.delete(key);
        },
      );
      return promise;
    },
    prefetchSpeech: (text: string, options: { voice?: string } = {}): void => {
      prefetches.push({ text, voice: options.voice });
    },
    toSpeechBlob: (buffer: ArrayBuffer): Blob => {
      blobbed.push(buffer);
      const blob = new Blob([buffer], { type: "audio/mpeg" });
      blobText.set(blob, bufferText.get(buffer) ?? "unknown");
      return blob;
    },

    bufferFor,
    /** Lets the `createObjectURL` fake name its URL after the unit it carries. */
    textForBlob: (blob: Blob): string => blobText.get(blob) ?? "unknown",
    get requests() {
      return requests;
    },
    get prefetches() {
      return prefetches;
    },
    /** Every buffer handed to `toSpeechBlob`, in order. */
    get blobbed() {
      return blobbed;
    },
    /** The units whose synthesis has been asked for and has not answered. */
    get inFlight() {
      return inFlightEntries().map((entry) => entry.text);
    },
    /** The most that were ever in flight at one moment, across the test. */
    get peakInFlight() {
      return peakInFlight;
    },
    get timeline() {
      return timeline;
    },
    /** Lets the element spy drop playback into the same ordered list. */
    note: (event: string): void => {
      timeline.push(event);
    },
    failOn: (text: string) => modes.set(text, "reject"),
    hangOn: (text: string) => modes.set(text, "hang"),
    /**
     * Holds this unit's synthesis open until {@link release}. "hang" proves a
     * unit was never awaited; this one proves what the player reports *while*
     * it waits, and then that the wait ends.
     */
    deferOn: (text: string) => modes.set(text, "defer"),
    release: (text: string) => {
      const resolve = releases.get(text);
      if (!resolve) throw new Error(`no deferred synthesis is waiting for ${text}`);
      releases.delete(text);
      // A released unit synthesizes normally if it is ever asked for again.
      modes.delete(text);
      resolve();
    },
    reset: () => {
      modes.clear();
      releases.clear();
      cache = new Map();
      peakInFlight = 0;
      timeline = [];
      requests = [];
      prefetches = [];
      blobbed = [];
    },
  };
});

vi.mock("../synth", () => ({
  synthesizeSpeech: synth.synthesizeSpeech,
  prefetchSpeech: synth.prefetchSpeech,
  toSpeechBlob: synth.toSpeechBlob,
  SPEECH_AUDIO_MIME_TYPE: "audio/mpeg",
}));

import type { SpeechPlaybackError, SpeechPlayer } from "../useSpeechPlayer";
import { SYNTHESIS_CONCURRENCY, useSpeechPlayer } from "../useSpeechPlayer";
import type { SpeechUnit } from "../types";
import { DEFAULT_SPEECH_VOICE, SPEECH_VOICE_STORAGE_KEY } from "../voices";

function units(...texts: string[]): SpeechUnit[] {
  return texts.map((text) => ({ text, chars: text.length }));
}

/** `count` units named `unit-0` … `unit-<count-1>`, in playback order. */
function manyUnits(count: number): SpeechUnit[] {
  return units(...Array.from({ length: count }, (_, index) => `unit-${index}`));
}

/** The units synthesis was actually asked for, in the order it was asked. */
function requested(): string[] {
  return synth.requests.map((request) => request.text);
}

/** Every `<audio>` element the player drove, in the order it drove them. */
const elements: HTMLMediaElement[] = [];
/** The `src` each `play()` was called on — the playback order, observable. */
const played: string[] = [];
const createdUrls: string[] = [];
const revokedUrls: string[] = [];
const paused = vi.fn();
/** Swapped per test: a browser that accepts the start, or one that refuses it. */
let playResult: () => Promise<void>;

// jsdom stores `currentTime` as a plain value and never rewinds it, so an
// element whose `src` was reassigned is indistinguishable from one that was
// held across a pause — and "resume does not restart the unit" would then be
// unfalsifiable. A real browser loads the new source and rewinds to zero; the
// stand-in is taught to do the same. Patched once, at module scope: the
// per-test `vi.restoreAllMocks()` only unwinds spies, and re-wrapping this in
// `beforeEach` would stack one wrapper per test.
const nativeSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src")!;
Object.defineProperty(HTMLMediaElement.prototype, "src", {
  configurable: true,
  enumerable: nativeSrc.enumerable,
  get(this: HTMLMediaElement): string {
    return nativeSrc.get!.call(this) as string;
  },
  set(this: HTMLMediaElement, value: string) {
    this.currentTime = 0;
    nativeSrc.set!.call(this, value);
  },
});

/**
 * The player's steps are all microtasks — synthesis resolves, the object URL is
 * built, the next unit's load starts — so draining the microtask queue advances
 * it without a real-timer sleep. Bounded, so a step that never happens fails an
 * assertion instead of hanging the suite.
 */
async function drain(): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    await Promise.resolve();
  }
}

/** Starts playback and lets it get as far as it can without a unit ending. */
async function startPlay(
  player: SpeechPlayer,
  sessionId: string,
  speechUnits: SpeechUnit[],
  fromUnit?: number,
): Promise<void> {
  await act(async () => {
    // Floating on purpose: `play` only settles when playback finishes, and
    // these tests assert on the state it reaches mid-utterance.
    void player.play(sessionId, speechUnits, fromUnit);
    await drain();
  });
}

/** Fires `ended` on the element that is playing, as the browser would. */
async function endCurrentUnit(): Promise<void> {
  const element = elements[elements.length - 1];
  if (!element) throw new Error("nothing is playing");

  await act(async () => {
    element.dispatchEvent(new Event("ended"));
    await drain();
  });
}

/** Runs a synchronous player call and lets the run settle around it. */
async function settle(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await drain();
  });
}

/** The element the player is currently driving. */
function currentElement(): HTMLMediaElement {
  const element = elements[elements.length - 1];
  if (!element) throw new Error("nothing is playing");
  return element;
}

beforeEach(() => {
  synth.reset();
  elements.length = 0;
  played.length = 0;
  createdUrls.length = 0;
  revokedUrls.length = 0;
  paused.mockClear();
  playResult = () => Promise.resolve();

  // jsdom implements neither of these, so they are defined rather than spied.
  // Naming each URL after its unit makes the playback order readable.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      const url = `blob:${synth.textForBlob(blob)}`;
      createdUrls.push(url);
      return url;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: (url: string) => {
      revokedUrls.push(url);
    },
  });

  // jsdom's HTMLMediaElement has no playback engine: `play()` throws
  // "not implemented" and nothing ever fires `ended`. Both are driven by hand.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    elements.push(this);
    const src = this.getAttribute("src") ?? "";
    played.push(src);
    synth.note(`play:${src}`);
    return playResult();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    paused(this.getAttribute("src"));
  });
});

describe("useSpeechPlayer", () => {
  it("starts after synthesizing only the first unit", async () => {
    // Unit 1 never resolves. If the player awaited anything beyond unit 0,
    // playback could not have started at all.
    synth.hangOn("unit-1");
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1", "unit-2"));

    expect(played).toEqual(["blob:unit-0"]);
    expect(createdUrls).toEqual(["blob:unit-0"]);
    expect(result.current.speakingSessionId).toBe("cell-a");
    expect(onError).not.toHaveBeenCalled();

    // The buffer that reached the element came through `toSpeechBlob` — the
    // helper that copies it — not a hand-rolled `new Blob([buffer])`, which
    // would detach the cached buffer on the second playback.
    expect(synth.blobbed).toEqual([synth.bufferFor("unit-0")]);

    // Every request carries an explicit voice: an omitted one silently becomes
    // synth.ts's private Ryan default.
    expect(synth.requests.map((request) => request.voice)).toEqual([
      DEFAULT_SPEECH_VOICE,
      DEFAULT_SPEECH_VOICE,
    ]);
  });

  it("has the next unit's object URL ready before the current unit ends", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1", "unit-2"));

    // Mid-unit-0: unit 1's URL already exists, so the swap on `ended` is a
    // local assignment with no network round-trip. Unit 2 is warmed in the
    // synthesis cache only — warming never builds a URL, because a URL nobody
    // plays is a leak.
    expect(played).toEqual(["blob:unit-0"]);
    expect(createdUrls).toEqual(["blob:unit-0", "blob:unit-1"]);
    expect(revokedUrls).toEqual([]);
    expect(requested()).toEqual(["unit-0", "unit-1", "unit-2"]);
    // Warming goes through `synthesizeSpeech`, not the fire-and-forget
    // `prefetchSpeech`: the promise is what refills the window, and a warm
    // nobody can observe finishing cannot bound anything.
    expect(synth.prefetches).toEqual([]);

    await endCurrentUnit();

    // It played the URL that already existed rather than building a new one,
    // and the unit it materialized was served by the warm already in flight.
    expect(played).toEqual(["blob:unit-0", "blob:unit-1"]);
    expect(createdUrls).toEqual(["blob:unit-0", "blob:unit-1", "blob:unit-2"]);
    expect(requested()).toEqual(["unit-0", "unit-1", "unit-2"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("requests the second unit while the first is playing", async () => {
    // Deferred, so unit 1 is provably still *in flight* — not merely requested
    // and long since finished — at the moment unit 0 reaches the element.
    synth.deferOn("unit-1");
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", manyUnits(4));

    expect(played).toEqual(["blob:unit-0"]);
    // An ordering claim, not a presence one: the request was issued *before*
    // playback started, so unit 1 synthesizes under unit 0 rather than after
    // it. A ladder re-entered only once the playing unit resolves would put
    // these two the other way round.
    expect(synth.timeline.indexOf("synthesize:unit-1")).toBeGreaterThanOrEqual(0);
    expect(synth.timeline.indexOf("synthesize:unit-1")).toBeLessThan(
      synth.timeline.indexOf("play:blob:unit-0"),
    );
    expect(synth.inFlight).toContain("unit-1");
    expect(onError).not.toHaveBeenCalled();
  });

  it("requests the remainder once the second unit lands", async () => {
    // Six units and not one `ended`: unit 0 is still speaking throughout. The
    // whole remainder must therefore be under way on the strength of unit 1
    // landing alone — waiting for playback is the head start unit 0, which is
    // deliberately tiny, cannot give.
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", manyUnits(6));

    expect(played).toEqual(["blob:unit-0"]);
    expect(requested()).toEqual([
      "unit-0",
      "unit-1",
      "unit-2",
      "unit-3",
      "unit-4",
      "unit-5",
    ]);
    // Warming with any other voice is a synthesis nobody ever plays: the cache
    // keys on voice + text, so the click would pay for the unit all over again.
    expect(new Set(synth.requests.map((request) => request.voice))).toEqual(
      new Set([DEFAULT_SPEECH_VOICE]),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("cascades from the next unit that lands when one fails", async () => {
    // Unit 1's synthesis fails. The cascade hangs off a unit actually in hand,
    // so a failure defers it by one unit rather than abandoning it: unit 2
    // lands and warms the whole remainder. One flaky socket must not cost the
    // answer its warming — three consecutive failures are what stop a run.
    synth.failOn("unit-1");
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", manyUnits(6));

    // Nothing beyond the failed unit yet: there is no loaded unit to cascade
    // from, and the ladder does not reach unit 2 until unit 0 has been spoken.
    expect(requested()).toEqual(["unit-0", "unit-1"]);
    expect(played).toEqual(["blob:unit-0"]);

    await endCurrentUnit();

    // Unit 1 is skipped, unit 2 plays — and warming resumes behind it all the
    // way to the last unit, exactly as an unbroken run would have warmed from
    // unit 2 onwards.
    expect(played).toEqual(["blob:unit-0", "blob:unit-2"]);
    expect(requested()).toEqual([
      "unit-0",
      "unit-1",
      "unit-2",
      "unit-3",
      "unit-4",
      "unit-5",
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps at most the window's worth of syntheses in flight", async () => {
    // Everything from unit 2 on is held open, so the window cannot drain:
    // whatever is in flight when the dust settles *is* the window.
    for (let index = 2; index < 9; index += 1) synth.deferOn(`unit-${index}`);
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", manyUnits(9));

    expect(SYNTHESIS_CONCURRENCY).toBe(3);
    // Seven units are still unwarmed and every one of them would resolve on
    // its own connection. Three sockets, not seven.
    expect(synth.inFlight).toEqual(["unit-2", "unit-3", "unit-4"]);
    expect(synth.peakInFlight).toBe(SYNTHESIS_CONCURRENCY);
    expect(requested()).toEqual(["unit-0", "unit-1", "unit-2", "unit-3", "unit-4"]);
    expect(played).toEqual(["blob:unit-0"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("refills the window as each synthesis completes", async () => {
    for (let index = 2; index < 9; index += 1) synth.deferOn(`unit-${index}`);
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", manyUnits(9));
    expect(synth.inFlight).toEqual(["unit-2", "unit-3", "unit-4"]);

    // One lands mid-window. A batch of three followed by a wait for all three
    // would leave two in flight here; a rolling window starts unit 5 at once.
    await settle(() => synth.release("unit-3"));
    expect(synth.inFlight).toEqual(["unit-2", "unit-4", "unit-5"]);

    await settle(() => {
      synth.release("unit-2");
      synth.release("unit-4");
    });
    expect(synth.inFlight).toEqual(["unit-5", "unit-6", "unit-7"]);

    // And it runs to the end of the run rather than to a fixed distance: the
    // last unit is reached with playback still sitting on unit 0.
    await settle(() => {
      synth.release("unit-5");
      synth.release("unit-6");
      synth.release("unit-7");
    });
    expect(synth.inFlight).toEqual(["unit-8"]);
    expect(requested()).toHaveLength(9);
    // Never once did a fourth connection open.
    expect(synth.peakInFlight).toBe(SYNTHESIS_CONCURRENCY);
    expect(played).toEqual(["blob:unit-0"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("stops warming the moment the run loses the element", async () => {
    // The window is what makes an abandoned run expensive: every slot it still
    // holds refills itself when its request settles, so a run that was stopped
    // or barged in on would go on opening sockets for its whole remaining tail
    // — against the run that replaced it. Nothing else in the player notices,
    // because warming touches neither the element nor any object URL.
    for (let index = 2; index < 9; index += 1) synth.deferOn(`unit-${index}`);
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", manyUnits(9));
    expect(synth.inFlight).toEqual(["unit-2", "unit-3", "unit-4"]);

    await settle(() => result.current.stop());
    const before = requested().length;

    // A slot comes free *after* the stop. On a live run this is exactly what
    // starts unit 5; on a run that is over it must start nothing at all.
    await settle(() => synth.release("unit-3"));

    expect(requested()).toHaveLength(before);
    expect(requested()).not.toContain("unit-5");

    // And it stays stopped as the rest of the tail settles, rather than merely
    // skipping the one refill.
    await settle(() => {
      synth.release("unit-2");
      synth.release("unit-4");
    });
    expect(requested()).toHaveLength(before);
    expect(onError).not.toHaveBeenCalled();
  });

  it("synthesizes nothing beyond the run's slice", async () => {
    // A subrange play: the slice is the bound at both ends. Warming the whole
    // array would synthesize units this run will never speak.
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", manyUnits(6), 2);

    expect(played).toEqual(["blob:unit-2"]);
    expect(requested()).toEqual(["unit-2", "unit-3", "unit-4", "unit-5"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps playing when a unit far ahead stalls", async () => {
    // Unit 4's synthesis never answers — the 15 s stall timeout, or a socket
    // that simply died. It sits three units ahead of the listener and holds one
    // window slot for good; the other two must carry the rest of the run past
    // it, and playback must not notice at all.
    synth.hangOn("unit-4");
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", manyUnits(8));

    expect(synth.inFlight).toEqual(["unit-4"]);
    expect(requested()).toEqual([
      "unit-0",
      "unit-1",
      "unit-2",
      "unit-3",
      "unit-4",
      "unit-5",
      "unit-6",
      "unit-7",
    ]);

    // The player awaits only the unit it is about to play, so the units before
    // the stall speak in order and on time.
    await endCurrentUnit();
    await endCurrentUnit();
    await endCurrentUnit();

    expect(played).toEqual(["blob:unit-0", "blob:unit-1", "blob:unit-2", "blob:unit-3"]);
    expect(result.current.speakingSessionId).toBe("cell-a");
    expect(result.current.waitingForSynthesis).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("stops the speaking session when another session starts", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1", "unit-2", "unit-3"));
    expect(result.current.speakingSessionId).toBe("cell-a");

    await startPlay(result.current, "cell-b", units("other-0", "other-1"));

    expect(paused).toHaveBeenCalled();
    expect(result.current.speakingSessionId).toBe("cell-b");
    expect(played).toEqual(["blob:unit-0", "blob:other-0"]);
    // Barge-in happens mid-unit, so cell-a's built URLs — the one that was
    // playing and the one waiting for the swap — are revoked, not leaked.
    expect(new Set(revokedUrls)).toEqual(new Set(["blob:unit-0", "blob:unit-1"]));

    // The abandoned run must not wake up and resume when `ended` fires.
    await endCurrentUnit();
    expect(played).toEqual(["blob:unit-0", "blob:other-0", "blob:other-1"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("skips a unit that fails to synthesize", async () => {
    // THREE failures, none of them consecutive. A counter that merely
    // accumulated would stop the run on unit 5; only a counter that a success
    // resets lets the utterance finish.
    synth.failOn("unit-1");
    synth.failOn("unit-3");
    synth.failOn("unit-5");
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(
      result.current,
      "cell-a",
      units("unit-0", "unit-1", "unit-2", "unit-3", "unit-4", "unit-5", "unit-6"),
    );
    expect(played).toEqual(["blob:unit-0"]);

    await endCurrentUnit();
    expect(played).toEqual(["blob:unit-0", "blob:unit-2"]);

    await endCurrentUnit();
    expect(played).toEqual(["blob:unit-0", "blob:unit-2", "blob:unit-4"]);

    await endCurrentUnit();
    expect(played).toEqual(["blob:unit-0", "blob:unit-2", "blob:unit-4", "blob:unit-6"]);

    await endCurrentUnit();
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.speakingSessionId).toBeNull();
  });

  it("stops and reports after three consecutive failures", async () => {
    synth.failOn("unit-0");
    synth.failOn("unit-1");
    synth.failOn("unit-2");
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(
      result.current,
      "cell-a",
      units("unit-0", "unit-1", "unit-2", "unit-3", "unit-4"),
    );

    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0][0] as SpeechPlaybackError;
    expect(error.kind).toBe("synthesis");
    expect(error.sessionId).toBe("cell-a");

    // Playback stopped: nothing ever played, and units 3 and 4 were never even
    // requested, although both would have synthesized fine.
    expect(played).toEqual([]);
    expect(synth.requests.map((request) => request.text)).toEqual([
      "unit-0",
      "unit-1",
      "unit-2",
    ]);
    expect(result.current.speakingSessionId).toBeNull();
  });

  it("reports a one-unit utterance whose only unit fails", async () => {
    // The short-answer hole: one unit means one failure, and
    // MAX_CONSECUTIVE_UNIT_FAILURES is three — so the ladder ends, the run
    // resolves, and without the played-nothing check this is silence with no
    // report at all, which the cell then reads as a finished answer.
    synth.failOn("only-unit");
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("only-unit"));

    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0][0] as SpeechPlaybackError;
    expect(error.kind).toBe("synthesis");
    expect(error.sessionId).toBe("cell-a");
    // Zero is what tells the host the user heard nothing.
    expect(error.playedUnits).toBe(0);
    expect(played).toEqual([]);
    expect(result.current.speakingSessionId).toBeNull();
  });

  it("reports a two-unit utterance whose units both fail", async () => {
    // Two failures is still one short of the ladder's three.
    synth.failOn("unit-0");
    synth.failOn("unit-1");
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1"));

    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0][0] as SpeechPlaybackError;
    expect(error.kind).toBe("synthesis");
    expect(error.playedUnits).toBe(0);
    // Both were attempted before the run gave up — one failure is a skip.
    expect(synth.requests.map((request) => request.text)).toEqual(["unit-0", "unit-1"]);
    expect(played).toEqual([]);
  });

  it("does not report a run whose units all played", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1"));
    await endCurrentUnit();
    await endCurrentUnit();

    // The played-nothing check must not fire on the ordinary ending, which
    // leaves the ladder exactly the same way: `pending === null`.
    expect(played).toEqual(["blob:unit-0", "blob:unit-1"]);
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.speakingSessionId).toBeNull();
  });

  it("counts the units a failing run managed to play", async () => {
    // Unit 0 speaks, then the synthesizer goes down for the rest: the ladder's
    // three-consecutive rule stops it, and the count is what keeps the host's
    // `unheard` fallback off a run the user did partly hear.
    synth.failOn("unit-1");
    synth.failOn("unit-2");
    synth.failOn("unit-3");
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1", "unit-2", "unit-3"));
    expect(played).toEqual(["blob:unit-0"]);

    await endCurrentUnit();

    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0][0] as SpeechPlaybackError;
    expect(error.kind).toBe("synthesis");
    expect(error.playedUnits).toBe(1);
  });

  it("resumes at fromUnit", async () => {
    localStorage.setItem(SPEECH_VOICE_STORAGE_KEY, "en-US-EmmaMultilingualNeural");
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1", "unit-2", "unit-3"), 2);

    // Nothing before the cut is synthesized, let alone spoken.
    expect(played).toEqual(["blob:unit-2"]);
    expect(synth.requests.map((request) => request.text)).toEqual(["unit-2", "unit-3"]);
    // The picked voice reaches synthesis, rather than the module's own default.
    expect(synth.requests.map((request) => request.voice)).toEqual([
      "en-US-EmmaMultilingualNeural",
      "en-US-EmmaMultilingualNeural",
    ]);

    await endCurrentUnit();
    expect(played).toEqual(["blob:unit-2", "blob:unit-3"]);
  });

  it("reports a refused start instead of failing silently", async () => {
    // What a browser does when nothing has been unlocked by a user gesture.
    const refusal = Object.assign(new Error("play() needs a user gesture"), {
      name: "NotAllowedError",
    });
    playResult = () => Promise.reject(refusal);
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    expect(result.current.unlocked).toBe(false);
    await startPlay(result.current, "cell-a", units("unit-0", "unit-1"));

    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0][0] as SpeechPlaybackError;
    expect(error.kind).toBe("refused");
    expect(error.sessionId).toBe("cell-a");
    expect(error.cause).toBe(refusal);

    expect(result.current.speakingSessionId).toBeNull();
    // Nothing is left holding a URL behind the refusal.
    expect(new Set(revokedUrls)).toEqual(new Set(createdUrls));

    // The remedy: a gesture unlocks the element for later programmatic plays.
    await act(async () => {
      result.current.unlock();
      await drain();
    });
    expect(result.current.unlocked).toBe(true);
  });

  it("revokes object URLs", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1"));
    expect(revokedUrls).toEqual([]);

    await endCurrentUnit();
    expect(revokedUrls).toEqual(["blob:unit-0"]);

    await endCurrentUnit();
    expect(createdUrls).toEqual(["blob:unit-0", "blob:unit-1"]);
    expect(revokedUrls).toEqual(["blob:unit-0", "blob:unit-1"]);
    expect(result.current.speakingSessionId).toBeNull();

    // A natural `ended` is the easy case: `stop()` mid-unit has to revoke the
    // playing URL and the one prefetched for the swap as well.
    await startPlay(result.current, "cell-b", units("other-0", "other-1", "other-2"));
    await act(async () => {
      result.current.stop();
      await drain();
    });

    expect(result.current.speakingSessionId).toBeNull();
    // other-2 was only warmed in the cache, so it never became a URL at all.
    expect(createdUrls).toEqual([
      "blob:unit-0",
      "blob:unit-1",
      "blob:other-0",
      "blob:other-1",
    ]);
    expect(new Set(revokedUrls)).toEqual(new Set(createdUrls));
  });

  it("revokes a URL that finishes loading after the run was barged in on", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    // The two plays' synchronous prefixes run back to back, so cell-a's unit is
    // still mid-synthesis when cell-b tears its run down. Its URL is therefore
    // created *after* the run's URL set was drained, which is the one case that
    // set cannot clean up: only the in-flight check inside `loadUnit` frees it.
    // Left unfreed, every barge-in landing during a synthesis leaks one blob for
    // the lifetime of the tab.
    await act(async () => {
      void result.current.play("cell-a", units("abandoned-0", "abandoned-1"));
      void result.current.play("cell-b", units("winner-0", "winner-1"));
      await drain();
    });

    // The abandoned unit did get as far as having a URL built for it...
    expect(createdUrls).toContain("blob:abandoned-0");
    // ...it just never played, and was handed back to the browser regardless.
    expect(played).toEqual(["blob:winner-0"]);
    expect(revokedUrls).toContain("blob:abandoned-0");
    expect(result.current.speakingSessionId).toBe("cell-b");
    expect(onError).not.toHaveBeenCalled();
  });

  it("stops speaking and revokes every URL on unmount", async () => {
    const onError = vi.fn();
    const { result, unmount } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1", "unit-2"));
    expect(createdUrls).toEqual(["blob:unit-0", "blob:unit-1"]);
    expect(revokedUrls).toEqual([]);

    const element = elements[elements.length - 1];
    const pausedBefore = paused.mock.calls.length;

    // Navigating away mid-utterance. The element is never in the document, so
    // nothing tears it down for us: without the unmount teardown the browser
    // keeps talking and every built URL outlives the hook.
    await act(async () => {
      unmount();
      await drain();
    });

    expect(paused.mock.calls.length).toBeGreaterThan(pausedBefore);
    expect(element.getAttribute("src")).toBeNull();
    expect(new Set(revokedUrls)).toEqual(new Set(createdUrls));

    // An `ended` still in flight when the hook went away must not resume the
    // ladder: nothing further plays, and nothing further is even synthesized.
    await act(async () => {
      element.dispatchEvent(new Event("ended"));
      await drain();
    });
    expect(played).toEqual(["blob:unit-0"]);
    expect(createdUrls).toEqual(["blob:unit-0", "blob:unit-1"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("drives one audio element for the whole player", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1"));
    await startPlay(result.current, "cell-b", units("other-0", "other-1"));
    await act(async () => {
      result.current.unlock();
      await drain();
    });

    // Design §4: one element for the whole panel, so barge-in is an index reset
    // rather than a negotiation between elements — and so the autoplay
    // permission a gesture grants stays attached to the element the later
    // programmatic plays use, which a per-play element would discard each time.
    expect(elements.length).toBeGreaterThan(1);
    expect(new Set(elements).size).toBe(1);
    // The gesture's own `play()` lands on the element cell-b is mid-way
    // through, src and all — there is nowhere else for it to land.
    expect(played).toEqual(["blob:unit-0", "blob:other-0", "blob:other-0"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("pause holds the element without tearing the run down", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1", "unit-2"));
    const element = currentElement();
    const pausesBefore = paused.mock.calls.length;

    await settle(() => result.current.pause());

    expect(paused.mock.calls.length).toBeGreaterThan(pausesBefore);
    expect(result.current.pausedSessionId).toBe("cell-a");
    // A pause is not a stop: the run keeps its session, its element and its
    // ladder, because the user is going to come back to it.
    expect(result.current.speakingSessionId).toBe("cell-a");
    expect(element.getAttribute("src")).toBe("blob:unit-0");
    expect(createdUrls).toEqual(["blob:unit-0", "blob:unit-1"]);
    expect(revokedUrls).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("resume continues from the retained position, not the start of the unit", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1"));
    const element = currentElement();
    // Two seconds into unit 0 — the position the listener expects back.
    element.currentTime = 12.5;

    await settle(() => result.current.pause());
    const createdAtPause = [...createdUrls];
    const requestedAtPause = synth.requests.map((request) => request.text);

    await settle(() => result.current.resume());

    expect(result.current.pausedSessionId).toBeNull();
    expect(result.current.speakingSessionId).toBe("cell-a");
    // The element was told to play again on the source it was already holding.
    expect(played).toEqual(["blob:unit-0", "blob:unit-0"]);
    // Nothing reassigned `src`, which is what would have rewound it to zero.
    // Going through `play(sessionId, units, fromUnit)` would have done exactly
    // that — and re-synthesized and rebuilt the URL on the way.
    expect(element.currentTime).toBe(12.5);
    expect(createdUrls).toEqual(createdAtPause);
    expect(synth.requests.map((request) => request.text)).toEqual(requestedAtPause);
    expect(revokedUrls).toEqual([]);

    // And the ladder is still the same ladder: the next unit follows normally.
    await endCurrentUnit();
    expect(played).toEqual(["blob:unit-0", "blob:unit-0", "blob:unit-1"]);
    expect(revokedUrls).toEqual(["blob:unit-0"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("a unit that ends while paused does not advance the ladder", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1", "unit-2"));
    await settle(() => result.current.pause());

    // The element reaches the end of the unit under the pause. Advancing now
    // would start the next unit speaking while the user holds the run.
    await endCurrentUnit();

    expect(played).toEqual(["blob:unit-0"]);
    expect(result.current.pausedSessionId).toBe("cell-a");
    expect(revokedUrls).toEqual([]);

    await settle(() => result.current.resume());

    expect(played).toEqual(["blob:unit-0", "blob:unit-1"]);
    expect(result.current.pausedSessionId).toBeNull();
    expect(revokedUrls).toEqual(["blob:unit-0"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports waiting while the first unit synthesizes", async () => {
    synth.deferOn("unit-0");
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1"));

    // The run exists and is blocked on edge-tts: this is the red the control
    // shows before a single sound is made.
    expect(result.current.speakingSessionId).toBe("cell-a");
    expect(result.current.waitingForSynthesis).toBe(true);
    expect(played).toEqual([]);

    await settle(() => synth.release("unit-0"));

    // Handed to the element, so the wait is over.
    expect(played).toEqual(["blob:unit-0"]);
    expect(result.current.waitingForSynthesis).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports waiting again on a mid-response underrun", async () => {
    synth.deferOn("unit-1");
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1", "unit-2"));

    // Unit 0 is speaking and unit 1 is still in flight: nothing is *blocked*
    // yet, because the listener is hearing something.
    expect(result.current.waitingForSynthesis).toBe(false);

    await endCurrentUnit();

    // Now the ladder has run dry mid-response — the same flag, the same red.
    expect(result.current.waitingForSynthesis).toBe(true);
    expect(result.current.speakingSessionId).toBe("cell-a");
    expect(played).toEqual(["blob:unit-0"]);

    await settle(() => synth.release("unit-1"));

    expect(played).toEqual(["blob:unit-0", "blob:unit-1"]);
    expect(result.current.waitingForSynthesis).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("stop from paused tears down like stop from playing", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1", "unit-2"));
    const element = currentElement();
    await settle(() => result.current.pause());

    await settle(() => result.current.stop());

    expect(result.current.pausedSessionId).toBeNull();
    expect(result.current.speakingSessionId).toBeNull();
    expect(result.current.waitingForSynthesis).toBe(false);
    expect(element.getAttribute("src")).toBeNull();
    expect(new Set(revokedUrls)).toEqual(new Set(createdUrls));

    // The held unit must not wake the ladder after the teardown either.
    await settle(() => element.dispatchEvent(new Event("ended")));
    expect(played).toEqual(["blob:unit-0"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("a new play discards another session's paused position", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1"));
    await settle(() => result.current.pause());
    expect(result.current.pausedSessionId).toBe("cell-a");

    await startPlay(result.current, "cell-b", units("other-0", "other-1"));

    // One element, so cell-a's suspended position cannot be kept: the run is
    // abandoned exactly as a playing one would be.
    expect(result.current.pausedSessionId).toBeNull();
    expect(result.current.speakingSessionId).toBe("cell-b");
    expect(played).toEqual(["blob:unit-0", "blob:other-0"]);
    expect(new Set(revokedUrls)).toEqual(new Set(["blob:unit-0", "blob:unit-1"]));

    // And nothing can resurrect it: `resume` has nothing paused to resume.
    await settle(() => result.current.resume());
    expect(played).toEqual(["blob:unit-0", "blob:other-0"]);
    expect(result.current.speakingSessionId).toBe("cell-b");
    expect(onError).not.toHaveBeenCalled();
  });

  it("clears waiting before reporting a systemic failure", async () => {
    synth.failOn("unit-0");
    synth.failOn("unit-1");
    synth.failOn("unit-2");
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(
      result.current,
      "cell-a",
      units("unit-0", "unit-1", "unit-2", "unit-3"),
    );

    // The run is dead. Red means "more is still coming", so a run that has
    // given up must never be left presenting as one that is still waiting.
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as SpeechPlaybackError).kind).toBe("synthesis");
    expect(result.current.waitingForSynthesis).toBe(false);
    expect(result.current.speakingSessionId).toBeNull();
    expect(result.current.pausedSessionId).toBeNull();
  });

  it("clears waiting when a blocked run is stopped", async () => {
    // The failure path above clears the flag on its way past the await, so it
    // cannot see this one: a run stopped *while* it is still blocked never
    // reaches that line. Red is never terminal, so the teardown has to clear it
    // itself or the cell stays red with nothing behind it.
    synth.deferOn("unit-0");
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1"));
    expect(result.current.waitingForSynthesis).toBe(true);

    await settle(() => result.current.stop());

    expect(result.current.waitingForSynthesis).toBe(false);
    expect(result.current.speakingSessionId).toBeNull();

    // The abandoned synthesis landing afterwards changes nothing.
    await settle(() => synth.release("unit-0"));
    expect(result.current.waitingForSynthesis).toBe(false);
    expect(played).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps a unit that arrives during a pause silent until resume", async () => {
    synth.deferOn("unit-1");
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    await startPlay(result.current, "cell-a", units("unit-0", "unit-1", "unit-2"));
    await endCurrentUnit();
    expect(result.current.waitingForSynthesis).toBe(true);

    // Pausing a run that is blocked on synthesis is allowed — the control keeps
    // its pause icon while it is red — so the unit lands while the run is held.
    await settle(() => result.current.pause());
    await settle(() => synth.release("unit-1"));

    expect(result.current.pausedSessionId).toBe("cell-a");
    expect(played).toEqual(["blob:unit-0"]);

    await settle(() => result.current.resume());

    expect(played).toEqual(["blob:unit-0", "blob:unit-1"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("unlocking for a click does not pause the play that click starts", async () => {
    // The sequence a user actually performs: pause one cell, navigate to
    // another project, click that project's cell. `useSpeechHost.onSpeak`
    // spends the gesture with `unlock()` and then plays — and `unlock()` was
    // written for a virgin element, which has no source and whose `play()`
    // therefore fails harmlessly.
    //
    // A paused run breaks that assumption: the element is still holding the
    // paused audio, so `unlock()`'s `play()` SUCCEEDS and schedules a deferred
    // `element.pause()`. By the time that lands the element belongs to the new
    // session — and pausing it there is silent, with no `ended` and no error,
    // so the run simply hangs.
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechPlayer({ onError }));

    // Both clicks go through the host's order: spend the gesture, then play.
    await settle(() => result.current.unlock());
    await startPlay(result.current, "cell-a", units("unit-0", "unit-1"));
    await settle(() => result.current.pause());
    expect(result.current.pausedSessionId).toBe("cell-a");

    await settle(() => result.current.unlock());
    await startPlay(result.current, "cell-b", units("other-0", "other-1"));
    // Give the deferred pause every chance to land before asserting it did not.
    await settle(async () => {
      await drain();
    });

    // The new session's audio must never be paused by the gesture that started
    // it. Tearing down cell-a's run may pause cell-a's source; cell-b's is the
    // one that has to survive.
    expect(paused.mock.calls.map((call) => call[0])).not.toContain("blob:other-0");
    // `""` is the first unlock's probe on the still-source-less element — the
    // gesture being spent, which is the whole point of it. The second unlock
    // adds nothing here: that is the fix. Without it this reads
    // `["", "blob:unit-0", "blob:unit-0", "blob:other-0"]`, the middle entry
    // being cell-a's paused unit audibly restarting.
    expect(played).toEqual(["", "blob:unit-0", "blob:other-0"]);
    expect(result.current.speakingSessionId).toBe("cell-b");
    expect(onError).not.toHaveBeenCalled();
  });
});
