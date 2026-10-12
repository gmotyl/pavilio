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

describe("useSpeechHost — armed cell preload survives other cells", () => {
  it("arming a second cell in another project does not stop the first cell's preload", async () => {
    const answerX = response(6, "Xray");
    const answerY = response(4, "Yankee");
    const x = unitsOf(answerX);
    const { result } = renderHook(() => useSpeechHost());

    await cycle(() => result.current, "cell-x");
    await emitUtterance("cell-x", "x-1", answerX);
    // Y arrives and is armed afterwards.
    await emitUtterance("cell-y", "y-1", answerY);
    await cycle(() => result.current, "cell-y");

    // Everything resolves at once (no holds): every unit of X must be requested.
    for (const unit of x) expect(timesRequested(unit)).toBe(1);

    // A Play on X needs no new synthesis.
    const before = synth.requests.length;
    await settle(() => result.current.onSpeak("cell-x"));
    await endRun();
    expect(synth.requests.length).toBe(before);
    expect(played).toEqual(x.map((unit) => `blob:${unit}`));
  });

  it("arming Y while X's units are held in flight still ends with all of X requested", async () => {
    const answerX = response(6, "Xray");
    const answerY = response(4, "Yankee");
    const x = holdAll(answerX);
    const y = holdAll(answerY);
    const { result } = renderHook(() => useSpeechHost());

    await cycle(() => result.current, "cell-x");
    await emitUtterance("cell-x", "x-1", answerX);
    await emitUtterance("cell-y", "y-1", answerY);
    await cycle(() => result.current, "cell-y");

    for (let i = 0; i < 30 && synth.held > 0; i += 1) {
      await release(synth.heldTexts[0]);
    }
    for (const unit of x) expect(timesRequested(unit)).toBe(1);
    for (const unit of y) expect(timesRequested(unit)).toBe(1);
  });

  it("a failed preload unit is retried on the next opportunity", async () => {
    const markdown = response(5);
    const units = holdAll(markdown);
    const { result } = renderHook(() => useSpeechHost());

    await cycle(() => result.current, "cell-a");
    await emitUtterance("cell-a", "u-1", markdown);
    await act(async () => {
      synth.fail(units[1]);
      await drain();
    });
    await release(units[0]);
    expect(timesRequested(units[2])).toBe(0);

    // Next opportunity: another arrival anywhere (a different cell).
    await emitUtterance("cell-b", "b-1", response(2, "Later"));
    expect(timesRequested(units[1])).toBe(2);
    expect(timesRequested(units[2])).toBeGreaterThanOrEqual(1);
  });

  it("preloads never delay the playing run's next unit", async () => {
    const answerX = response(6, "Xray");
    const answerP = response(5, "Papa");
    const x = holdAll(answerX);
    const p = unitsOf(answerP);
    synth.hold(p[2]);
    const { result } = renderHook(() => useSpeechHost());

    await cycle(() => result.current, "cell-x");
    await emitUtterance("cell-x", "x-1", answerX);
    await emitUtterance("cell-p", "p-1", answerP);
    await settle(() => result.current.onSpeak("cell-p"));
    // Free a slot: it must go to P's run (p[2..]) ahead of X's queued preloads.
    await release(x[0]);
    expect(requestedTexts()).toContain(p[2]);
    const idxP = requestedTexts().indexOf(p[2]);
    const idxX = requestedTexts().indexOf(x[2]);
    expect(idxX === -1 || idxP < idxX).toBe(true);
  });
});
