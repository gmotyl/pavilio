/**
 * Armed cells, seen from the host: the whole of an unheard answer is
 * synthesized up front, silently, through the same synthesis window the playing
 * run and the unit-0 warms use — and always behind them.
 *
 * The harness is `useSpeechHost.test.ts`'s: a cache-shaped synthesis stand-in
 * whose texts can be held open, a state-backed socket, and the real channel
 * and player. What it adds is a count of the syntheses held open at once, which
 * is what "in flight" means here: units that resolve on the spot never occupy
 * a slot long enough to be anyone's competition.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const synth = vi.hoisted(() => {
  const buffers = new Map<string, ArrayBuffer>();
  const bufferText = new Map<ArrayBuffer, string>();
  const blobText = new Map<Blob, string>();
  const cache = new Map<string, Promise<ArrayBuffer>>();
  /** Texts whose synthesis is held open until `release`/`fail` says otherwise. */
  const holds = new Set<string>();
  const waiting = new Map<string, { release: () => void; fail: (error: unknown) => void }>();
  let requests: Array<{ text: string; voice: string | undefined }> = [];
  /** The most syntheses ever held open at the same moment. */
  let peakHeld = 0;

  function bufferFor(text: string): ArrayBuffer {
    const existing = buffers.get(text);
    if (existing) return existing;

    const buffer = new Uint8Array([text.length % 255]).buffer;
    buffers.set(text, buffer);
    bufferText.set(buffer, text);
    return buffer;
  }

  function synthesizeSpeech(text: string, options: { voice?: string } = {}): Promise<ArrayBuffer> {
    const key = `${options.voice ?? ""}::${text}`;
    const cached = cache.get(key);
    if (cached) return cached;

    requests.push({ text, voice: options.voice });

    const promise = holds.has(text)
      ? new Promise<ArrayBuffer>((resolve, reject) => {
          waiting.set(text, {
            release: () => resolve(bufferFor(text)),
            fail: (error: unknown) => reject(error),
          });
          peakHeld = Math.max(peakHeld, waiting.size);
        })
      : Promise.resolve(bufferFor(text));

    cache.set(key, promise);
    // Never cache a failure, exactly as the real module does not: a retry has
    // to be able to reach the synthesizer again.
    void promise.catch(() => {
      if (cache.get(key) === promise) cache.delete(key);
    });
    return promise;
  }

  function settle(text: string, outcome: "release" | "fail"): void {
    const held = waiting.get(text);
    if (!held) throw new Error(`no synthesis is being held for ${text}`);
    waiting.delete(text);
    holds.delete(text);
    if (outcome === "release") held.release();
    else held.fail(new Error(`synthesis failed: ${text}`));
  }

  return {
    synthesizeSpeech,
    /** Exactly what the real one is: a fire-and-forget `synthesizeSpeech`. */
    prefetchSpeech: (text: string, options: { voice?: string } = {}): void => {
      void synthesizeSpeech(text, options).catch(() => {});
    },
    toSpeechBlob: (buffer: ArrayBuffer): Blob => {
      const blob = new Blob([buffer], { type: "audio/mpeg" });
      blobText.set(blob, bufferText.get(buffer) ?? "unknown");
      return blob;
    },
    textForBlob: (blob: Blob): string => blobText.get(blob) ?? "unknown",
    /** Holds this text's synthesis open, so "while it is warming" is observable. */
    hold: (text: string): void => {
      holds.add(text);
    },
    release: (text: string): void => settle(text, "release"),
    fail: (text: string): void => settle(text, "fail"),
    get requests() {
      return requests;
    },
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
    /** Forgets every synthesized result, so a re-request is visible. */
    clearCache: (): void => {
      cache.clear();
    },
    reset: (): void => {
      requests = [];
      peakHeld = 0;
      cache.clear();
      holds.clear();
      waiting.clear();
    },
  };
});

vi.mock("../synth", () => ({
  synthesizeSpeech: synth.synthesizeSpeech,
  prefetchSpeech: synth.prefetchSpeech,
  toSpeechBlob: synth.toSpeechBlob,
  SPEECH_AUDIO_MIME_TYPE: "audio/mpeg",
}));

/**
 * A state-backed socket stand-in: `emit` pushes a frame into every mounted
 * `useWebSocket`, so an arrival is a real React state update rather than a
 * module variable plus a manual rerender.
 */
const ws = vi.hoisted(() => {
  const setters = new Set<(message: Record<string, unknown> | null) => void>();
  return {
    setters,
    emit(message: Record<string, unknown>): void {
      for (const set of setters) set(message);
    },
  };
});

vi.mock("../../realtime/useWebSocket", async () => {
  const React = await import("react");
  return {
    useWebSocket: () => {
      const [lastMessage, setLastMessage] = React.useState<Record<string, unknown> | null>(null);
      React.useEffect(() => {
        ws.setters.add(setLastMessage);
        return () => {
          ws.setters.delete(setLastMessage);
        };
      }, []);
      return { lastMessage };
    },
  };
});

import { prepare } from "../prepare";
import { useSpeechHost, type SpeechHost } from "../useSpeechHost";
import { nextSlot, SPECULATIVE_SLOTS, SYNTHESIS_WINDOW_SIZE } from "../synthesisWindow";

/** The `src` of every started playback, in order. Warming must never add one. */
const played: string[] = [];
/** The element each playback was started on, so a unit's `ended` can be fired. */
const elements: HTMLMediaElement[] = [];

/** Drains the microtask ladder the host and player run on. */
async function drain(): Promise<void> {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
}

/** Broadcasts one `speech-utterance` frame and lets the host react to it. */
async function emitUtterance(sessionId: string, id: string, text: string): Promise<void> {
  await act(async () => {
    ws.emit({ type: "speech-utterance", id, sessionId, text, at: Date.now() });
    await drain();
  });
}

/** Runs a host callback and lets everything it started settle. */
async function settle(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await drain();
  });
}

/** Ends the unit that is currently playing, as the browser's `ended` would. */
async function endCurrentUnit(): Promise<void> {
  const element = elements[elements.length - 1];
  if (!element) throw new Error("nothing is playing");
  await act(async () => {
    element.dispatchEvent(new Event("ended"));
    await drain();
  });
}

/** Ends every unit of the run that is playing, up to a bound. */
async function endRun(max = 40): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    if (!played.length) return;
    const before = played.length;
    await endCurrentUnit();
    if (played.length === before) return;
  }
}

const requestedTexts = (): string[] => synth.requests.map((request) => request.text);
const timesRequested = (text: string): number =>
  requestedTexts().filter((requested) => requested === text).length;

/**
 * A response of `count` units: every paragraph is one sentence over the
 * 200-char packing floor and under the 450-char ceiling, so it is neither
 * merged with its neighbour nor cut in half.
 */
function response(count: number, word = "Paragraph"): string {
  return Array.from({ length: count }, (_, i) => {
    const head = `${word} ${String(i).padStart(2, "0")} `;
    return head + "x".repeat(238 - head.length) + ".";
  }).join("\n\n");
}

/** What `prepare` will make of a response — the texts synthesis will be asked for. */
const unitsOf = (text: string): string[] =>
  prepare(text, { language: "en" }).units.map((unit) => unit.text);

beforeEach(() => {
  synth.reset();
  played.length = 0;
  elements.length = 0;
  ws.setters.clear();

  global.fetch = vi.fn(
    async () => ({ ok: true, json: async () => ({ utterances: [] }) }) as Response,
  ) as unknown as typeof fetch;

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) => `blob:${synth.textForBlob(blob)}`,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => {},
  });

  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    const src = this.getAttribute("src");
    // `unlock()` plays a source-less element on purpose; that is not audio.
    if (src) {
      played.push(src);
      elements.push(this);
    }
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

/** Holds every unit of `text` open, so its synthesis is observably in flight. */
function holdAll(text: string): string[] {
  const units = unitsOf(text);
  for (const unit of units) synth.hold(unit);
  return units;
}

/** Releases one held synthesis and lets the window hand its slot on. */
async function release(text: string): Promise<void> {
  await act(async () => {
    synth.release(text);
    await drain();
  });
}

/** Cycles a cell's speech mode `times` clicks forward. */
async function cycle(host: () => SpeechHost, sessionId: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) await settle(() => host().cycleSpeechMode(sessionId));
}

describe("useSpeechHost — armed cells preload whole answers", () => {
  it("an armed cell's arriving answer is synthesized whole and stays silent", async () => {
    const markdown = response(5);
    const units = unitsOf(markdown);
    const { result } = renderHook(() => useSpeechHost());

    await cycle(() => result.current, "cell-a"); // armed
    expect(result.current.speechModeOf("cell-a")).toBe("armed");

    await emitUtterance("cell-a", "u-1", markdown);

    expect([...requestedTexts()].sort()).toEqual([...units].sort());
    // Synthesized is not spoken: an armed cell still waits for its click.
    expect(played).toEqual([]);
    expect(result.current.stateFor("cell-a")).toBe("ready");

    // And the click that follows finds every unit in hand.
    await settle(() => result.current.onSpeak("cell-a"));
    await endRun();
    expect(played).toEqual(units.map((unit) => `blob:${unit}`));
    for (const unit of units) expect(timesRequested(unit)).toBe(1);
  });

  it("an autoplay cell's arriving answer is synthesized whole too", async () => {
    const markdown = response(4);
    const units = unitsOf(markdown);
    const { result } = renderHook(() => useSpeechHost());

    await cycle(() => result.current, "cell-a", 2); // autoplay
    await emitUtterance("cell-a", "u-1", markdown);

    expect([...new Set(requestedTexts())].sort()).toEqual([...units].sort());
    for (const unit of units) expect(timesRequested(unit)).toBe(1);
  });

  it("arming a cell preloads its held unheard answer", async () => {
    const markdown = response(4);
    const units = unitsOf(markdown);
    const { result } = renderHook(() => useSpeechHost());

    await emitUtterance("cell-a", "u-1", markdown);
    expect(requestedTexts()).toEqual([units[0]]);

    await cycle(() => result.current, "cell-a"); // armed

    expect(requestedTexts()).toEqual(units);
    expect(played).toEqual([]);
  });

  it("an off cell only warms unit 0", async () => {
    const markdown = response(4);
    const units = unitsOf(markdown);
    const { result } = renderHook(() => useSpeechHost());

    await emitUtterance("cell-a", "u-1", markdown);

    expect(result.current.speechModeOf("cell-a")).toBe("off");
    expect(requestedTexts()).toEqual([units[0]]);
  });

  it("heard answers are never preloaded", async () => {
    const markdown = response(4);
    const { result } = renderHook(() => useSpeechHost());

    await emitUtterance("cell-a", "u-1", markdown);
    await settle(() => result.current.onSpeak("cell-a"));
    await endRun();
    expect(result.current.stateFor("cell-a")).toBe("heard");

    // Forget the audio, so a preload of the heard answer would have to reach
    // the synthesizer again — and be seen doing it.
    synth.clearCache();
    const before = synth.requests.length;

    await cycle(() => result.current, "cell-a"); // armed

    expect(result.current.speechModeOf("cell-a")).toBe("armed");
    expect(synth.requests.length).toBe(before);
  });

  it("the playing run outranks unit-0 warms, which outrank preloads", async () => {
    const answerB = response(5, "Bravo");
    const answerC = response(3, "Charlie");
    const answerA = response(5, "Alpha");
    const b = holdAll(answerB);
    const c = unitsOf(answerC);
    synth.hold(c[0]);
    const a = unitsOf(answerA);
    synth.hold(a[2]);
    synth.hold(a[3]);
    const { result } = renderHook(() => useSpeechHost());

    // Cell B armed: its unit 0 warms and its unit 1 preloads — the two slots
    // speculation may hold — and B2..B4 queue as preloads.
    await cycle(() => result.current, "cell-b");
    await emitUtterance("cell-b", "b-1", answerB);
    expect(requestedTexts()).toEqual([b[0], b[1]]);

    // Cell C (off) arrives: its unit-0 warm queues, ahead of B's preloads.
    await emitUtterance("cell-c", "c-1", answerC);
    expect(requestedTexts()).toEqual([b[0], b[1]]);

    // Cell A (off) arrives and is played. The listener's own unit is never
    // queued; A's cascade takes the one slot left in the window.
    await emitUtterance("cell-a", "a-1", answerA);
    await settle(() => result.current.onSpeak("cell-a"));
    expect(played).toEqual([`blob:${a[0]}`]);
    expect(requestedTexts()).toEqual([b[0], b[1], a[0], a[1], a[2]]);

    // A freed slot goes to the run's next unit, not to C's older warm.
    await release(b[0]);
    expect(requestedTexts().slice(5)).toEqual([a[3]]);

    // …and again; A4 lands at once, and with the run's remainder all handed
    // out the slot falls to C's warm — still not to a preload.
    await release(b[1]);
    expect(requestedTexts().slice(5)).toEqual([a[3], a[4], c[0]]);

    // Only once the warms are through does a preload get a slot.
    await release(a[2]);
    expect(requestedTexts().slice(5)).toEqual([a[3], a[4], c[0], b[2]]);
    expect(synth.peakHeld).toBeLessThanOrEqual(SYNTHESIS_WINDOW_SIZE);
  });

  it("preloads respect the synthesis window", async () => {
    const answers = ["Alpha", "Bravo", "Charlie"].map((word) => response(4, word));
    for (const answer of answers) holdAll(answer);
    const answerX = response(6, "Xray");
    const x = unitsOf(answerX);
    for (const unit of x.slice(2)) synth.hold(unit);
    const { result } = renderHook(() => useSpeechHost());

    for (let i = 0; i < answers.length; i += 1) {
      await cycle(() => result.current, `cell-${i}`);
      await emitUtterance(`cell-${i}`, `u-${i}`, answers[i]);
    }
    // Twelve units wanted; speculation holds no more than its share.
    expect(synth.held).toBeLessThanOrEqual(SYNTHESIS_WINDOW_SIZE);

    // A run joins: still no more than the window, preloads included.
    await emitUtterance("cell-x", "x-1", answerX);
    await settle(() => result.current.onSpeak("cell-x"));
    expect(synth.held).toBe(SYNTHESIS_WINDOW_SIZE);

    // Drain everything, oldest first; the bound holds throughout.
    for (let i = 0; i < 60 && synth.held > 0; i += 1) {
      await release(synth.heldTexts[0]);
      expect(synth.held).toBeLessThanOrEqual(SYNTHESIS_WINDOW_SIZE);
    }
    expect(synth.held).toBe(0);
    expect(synth.peakHeld).toBeLessThanOrEqual(SYNTHESIS_WINDOW_SIZE);
    // And every unit of every armed answer did get its turn.
    for (const answer of answers) {
      for (const unit of unitsOf(answer)) expect(requestedTexts()).toContain(unit);
    }
  });

  it("disarming stops scheduling further preload units", async () => {
    const markdown = response(5);
    const units = holdAll(markdown);
    const { result } = renderHook(() => useSpeechHost());

    await cycle(() => result.current, "cell-a"); // armed
    await emitUtterance("cell-a", "u-1", markdown);
    expect(requestedTexts()).toEqual([units[0], units[1]]);

    await cycle(() => result.current, "cell-a", 2); // autoplay, then off
    expect(result.current.speechModeOf("cell-a")).toBe("off");

    // What was in flight finishes; nothing after it is started.
    await release(units[0]);
    await release(units[1]);
    expect(requestedTexts()).toEqual([units[0], units[1]]);
    expect(played).toEqual([]);

    // Arming again picks up where it stopped.
    await cycle(() => result.current, "cell-a");
    expect(requestedTexts()).toEqual(units.slice(0, 4));
  });
});

describe("nextSlot — the window's priority rule", () => {
  const none = { run: 0, warm: 0, preload: 0 };

  it("hands a free slot to the run, then a warm, then a preload", () => {
    const all = { run: 1, warm: 1, preload: 1 };
    expect(nextSlot(none, all)).toBe("run");
    expect(nextSlot(none, { ...all, run: 0 })).toBe("warm");
    expect(nextSlot(none, { run: 0, warm: 0, preload: 1 })).toBe("preload");
    expect(nextSlot(none, none)).toBeNull();
  });

  it("never lets out more than the window, nor speculation more than its share", () => {
    expect(nextSlot({ run: 1, warm: 1, preload: 1 }, { run: 1, warm: 1, preload: 1 })).toBeNull();
    // Speculation full: only the run may take the last slot.
    const speculating = { run: 0, warm: 1, preload: SPECULATIVE_SLOTS - 1 };
    expect(nextSlot(speculating, { run: 0, warm: 1, preload: 1 })).toBeNull();
    expect(nextSlot(speculating, { run: 1, warm: 1, preload: 1 })).toBe("run");
  });
});
