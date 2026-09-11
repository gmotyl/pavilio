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

  return {
    synthesizeSpeech: async (
      text: string,
      options: { voice?: string } = {},
    ): Promise<ArrayBuffer> => {
      requests.push({ text, voice: options.voice });

      const mode = modes.get(text) ?? "resolve";
      if (mode === "hang") return new Promise<ArrayBuffer>(() => {});
      if (mode === "defer") {
        return new Promise<ArrayBuffer>((resolve) => {
          releases.set(text, () => resolve(bufferFor(text)));
        });
      }
      if (mode === "reject") throw new Error(`synthesis failed: ${text}`);
      return bufferFor(text);
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
import { PREFETCH_AHEAD, useSpeechPlayer } from "../useSpeechPlayer";
import type { SpeechUnit } from "../types";
import { DEFAULT_SPEECH_VOICE, SPEECH_VOICE_STORAGE_KEY } from "../voices";

function units(...texts: string[]): SpeechUnit[] {
  return texts.map((text) => ({ text, chars: text.length }));
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
    played.push(this.getAttribute("src") ?? "");
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
    // local assignment with no network round-trip. Unit 2 is only warmed in the
    // synthesis cache — the ladder reaches PREFETCH_AHEAD units, no further.
    expect(PREFETCH_AHEAD).toBe(2);
    expect(played).toEqual(["blob:unit-0"]);
    expect(createdUrls).toEqual(["blob:unit-0", "blob:unit-1"]);
    expect(revokedUrls).toEqual([]);
    expect(synth.prefetches).toEqual([{ text: "unit-2", voice: DEFAULT_SPEECH_VOICE }]);

    await endCurrentUnit();

    // It played the URL that already existed rather than building a new one.
    expect(played).toEqual(["blob:unit-0", "blob:unit-1"]);
    expect(createdUrls).toEqual(["blob:unit-0", "blob:unit-1", "blob:unit-2"]);
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
});
