/**
 * Warming, seen from the host.
 *
 * The host is where the channel's arrivals meet the player's voice and cache,
 * so it is the only place that can say whether a cell's first unit is *in hand*
 * — and that is what the control's colour means. These tests drive the real
 * channel and the real player through `useSpeechHost` and assert on two things
 * only: which texts were handed to synthesis, and what the host reports about
 * each session while they are in flight.
 *
 * The synthesis stand-in keeps a **cache** keyed exactly as `synth.ts` keys it
 * (voice + text). Warming is worth nothing unless the click that follows finds
 * the audio, so a stub that re-synthesized on every call would report a warmed
 * panel as ready while every click still paid for a fresh synthesis.
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
    reset: (): void => {
      requests = [];
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
import { useSpeechHost } from "../useSpeechHost";
import { DEFAULT_SPEECH_VOICE } from "../voices";

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
 * A response of `count` units, comfortably inside the budget: every paragraph
 * is one sentence over the 200-char packing floor and under the 450-char
 * ceiling, so it is neither merged with its neighbour nor cut in half.
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

describe("useSpeechHost warming", () => {
  it("warms the first unit of an unarmed cell on arrival", async () => {
    const units = unitsOf(response(3));
    const { result } = renderHook(() => useSpeechHost());

    await emitUtterance("cell-a", "u-1", response(3));

    expect(result.current.armedSessionId).toBeNull();
    expect(requestedTexts()).toEqual([units[0]]);
    // The voice the click will use. Warming with any other one is a synthesis
    // nobody ever plays, because the cache keys on voice + text.
    expect(synth.requests[0]?.voice).toBe(DEFAULT_SPEECH_VOICE);
  });

  it("warming makes no sound, even with the element unlocked", async () => {
    const { result } = renderHook(() => useSpeechHost());

    // Arming cell-a spends a gesture on the element, so nothing after this is
    // kept silent merely by the browser's autoplay lock.
    await settle(() => result.current.onArm("cell-a"));
    await emitUtterance("cell-b", "u-1", response(3));

    expect(requestedTexts()).toEqual([unitsOf(response(3))[0]]);
    expect(played).toEqual([]);
  });

  it("does not synthesize beyond the first unit before playback", async () => {
    const units = unitsOf(response(4));
    renderHook(() => useSpeechHost());

    await emitUtterance("cell-a", "u-1", response(4));

    expect(requestedTexts()).toEqual([units[0]]);
    for (const later of units.slice(1)) expect(requestedTexts()).not.toContain(later);
  });

  it("reports preparing while the first unit warms, then ready", async () => {
    const units = unitsOf(response(3));
    synth.hold(units[0]);
    const { result } = renderHook(() => useSpeechHost());

    await emitUtterance("cell-a", "u-1", response(3));
    expect(result.current.preparingSessionIds.has("cell-a")).toBe(true);

    await settle(() => synth.release(units[0]));
    expect(result.current.preparingSessionIds.has("cell-a")).toBe(false);
  });

  it("a click on a ready cell starts without synthesizing that unit again", async () => {
    const units = unitsOf(response(3));
    const { result } = renderHook(() => useSpeechHost());

    await emitUtterance("cell-a", "u-1", response(3));
    expect(result.current.preparingSessionIds.has("cell-a")).toBe(false);

    await settle(() => result.current.onSpeak("cell-a"));

    expect(played).toEqual([`blob:${units[0]}`]);
    expect(timesRequested(units[0])).toBe(1);
  });

  it("a failed warm still leaves the cell clickable", async () => {
    const units = unitsOf(response(2));
    synth.hold(units[0]);
    const { result } = renderHook(() => useSpeechHost());

    await emitUtterance("cell-a", "u-1", response(2));
    expect(result.current.preparingSessionIds.has("cell-a")).toBe(true);

    // A warm that fails must never strand the cell red: it is reported ready,
    // and the click that follows simply pays for the synthesis itself.
    await settle(() => synth.fail(units[0]));
    expect(result.current.preparingSessionIds.has("cell-a")).toBe(false);

    await settle(() => result.current.onSpeak("cell-a"));
    expect(timesRequested(units[0])).toBe(2);
    expect(played).toEqual([`blob:${units[0]}`]);
  });

  it("a newer utterance re-warms and reports preparing in between", async () => {
    const first = unitsOf(response(2))[0];
    const second = unitsOf(response(2, "Newer"))[0];
    const { result } = renderHook(() => useSpeechHost());

    await emitUtterance("cell-a", "u-1", response(2));
    expect(result.current.preparingSessionIds.has("cell-a")).toBe(false);

    synth.hold(second);
    await emitUtterance("cell-a", "u-2", response(2, "Newer"));
    expect(result.current.preparingSessionIds.has("cell-a")).toBe(true);

    await settle(() => synth.release(second));
    expect(result.current.preparingSessionIds.has("cell-a")).toBe(false);
    expect(requestedTexts()).toEqual([first, second]);
  });

  it("a stale warm cannot report a re-warming cell ready", async () => {
    const first = unitsOf(response(2))[0];
    const second = unitsOf(response(2, "Newer"))[0];
    synth.hold(first);
    synth.hold(second);
    const { result } = renderHook(() => useSpeechHost());

    await emitUtterance("cell-a", "u-1", response(2));
    await emitUtterance("cell-a", "u-2", response(2, "Newer"));
    expect(result.current.preparingSessionIds.has("cell-a")).toBe(true);

    // The abandoned warm finishing says nothing about the cell: what the click
    // would play is the NEWER utterance's first unit, still in flight.
    await settle(() => synth.release(first));
    expect(result.current.preparingSessionIds.has("cell-a")).toBe(true);

    await settle(() => synth.release(second));
    expect(result.current.preparingSessionIds.has("cell-a")).toBe(false);
  });

  it("an armed cell autoplays without a double synthesis", async () => {
    const units = unitsOf(response(3));
    const { result } = renderHook(() => useSpeechHost());

    await settle(() => result.current.onArm("cell-a"));
    await emitUtterance("cell-a", "u-1", response(3));

    expect(played).toEqual([`blob:${units[0]}`]);
    expect(timesRequested(units[0])).toBe(1);
  });
});

/**
 * `heard` means one thing and one thing only: the FINAL unit of the utterance
 * played to its end. Every other ending — a barge-in, the budget cut, a
 * deliberate stop — leaves the cell green, because something in it has still
 * not been listened to. `play()` resolves identically for all of them, so these
 * are the tests that catch an `await play(); markHeard()`.
 */
describe("useSpeechHost — heard is the end of the last unit", () => {
  it("heard is reached only when the last unit ends", async () => {
    const markdown = response(2);
    const units = unitsOf(markdown);
    // Fixture guard: two units, both inside the budget, so a run that plays
    // them both is a natural end with no remainder.
    expect(prepare(markdown, { language: "en" }).spokenUnits).toBe(2);
    const { result } = renderHook(() => useSpeechHost());

    await emitUtterance("cell-a", "u-1", markdown);
    await settle(() => result.current.onSpeak("cell-a"));
    expect(result.current.stateFor("cell-a")).toBe("speaking");

    // The first unit ending is not the end of the utterance.
    await endCurrentUnit();
    expect(result.current.stateFor("cell-a")).not.toBe("heard");
    expect(played).toEqual([`blob:${units[0]}`, `blob:${units[1]}`]);

    await endCurrentUnit();
    expect(result.current.stateFor("cell-a")).toBe("heard");
  });

  it("a barge-in leaves the interrupted cell ready, not heard", async () => {
    const { result } = renderHook(() => useSpeechHost());

    await emitUtterance("cell-a", "u-1", response(2));
    await emitUtterance("cell-b", "u-2", response(2, "Other"));

    await settle(() => result.current.onSpeak("cell-a"));
    expect(result.current.stateFor("cell-a")).toBe("speaking");

    await settle(() => result.current.onSpeak("cell-b"));

    expect(result.current.stateFor("cell-a")).toBe("ready");
    expect(result.current.stateFor("cell-b")).toBe("speaking");
  });

  it("a budget stop leaves the cell ready", async () => {
    const markdown = response(8);
    const prepared = prepare(markdown, { language: "en" });
    // Fixture guard: without a remainder there is no budget stop to observe.
    expect(prepared.spokenUnits).toBeGreaterThan(0);
    expect(prepared.spokenUnits).toBeLessThan(prepared.units.length);
    const { result } = renderHook(() => useSpeechHost());

    await emitUtterance("cell-a", "u-1", markdown);
    await settle(() => result.current.onSpeak("cell-a"));
    await endRun();

    // The budget cut is not the end of the response, so the cell keeps
    // inviting the click that continues it.
    expect(result.current.stateFor("cell-a")).toBe("ready");
  });

  it("a user stop leaves the cell ready, not heard", async () => {
    const { result } = renderHook(() => useSpeechHost());

    await emitUtterance("cell-a", "u-1", response(3));
    await settle(() => result.current.onSpeak("cell-a"));
    expect(result.current.stateFor("cell-a")).toBe("speaking");

    // The amendment's correction: a run the user cut short was NOT listened
    // to, so it lands exactly where a barge-in lands rather than in `heard`.
    await settle(() => result.current.onStop("cell-a"));

    expect(result.current.stateFor("cell-a")).toBe("ready");
  });
});
