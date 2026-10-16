/**
 * Armed cells, seen from the host: the whole of an unheard answer is
 * synthesized up front, silently, on anytts' `preload` tier — behind the
 * playing run and the unit-0 warms, which the library ranks — and called off
 * through the utterance's one signal.
 *
 * The harness is `useSpeechHost.test.ts`'s, with the synthesis stand-in
 * swapped for `fakeTieredSynth.ts`: requests queue at call time, texts can be
 * held open, each caller aborts on its own signal, and `clearCache` models the
 * LRU evicting results.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const synth = await vi.hoisted(async () => {
  const { createTieredSynth } = await import("./fakeTieredSynth");
  return createTieredSynth();
});

vi.mock("../synth", () => ({
  synthesizeSpeech: synth.synthesizeSpeech,
  prefetchSpeech: synth.prefetchSpeech,
  toSpeechBlob: synth.toSpeechBlob,
  isSpeechSynthesized: synth.isSpeechSynthesized,
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

/** Releases one held synthesis and lets everything waiting on it settle. */
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
    // Everything after it was already queued with the library, and is called off.
    expect(synth.callsFor(units[2])[0].signal?.aborted).toBe(true);

    // Next opportunity: another arrival anywhere (a different cell).
    await emitUtterance("cell-b", "b-1", response(2, "Later"));
    expect(timesRequested(units[1])).toBe(2);
    expect(timesRequested(units[2])).toBeGreaterThanOrEqual(1);
  });

  it("evicted preloaded units are requested again at the next opportunity", async () => {
    const answerX = response(6, "Xray");
    const answerY = response(4, "Yankee");
    const x = unitsOf(answerX);
    const { result } = renderHook(() => useSpeechHost());

    await cycle(() => result.current, "cell-x");
    await emitUtterance("cell-x", "x-1", answerX);
    for (const unit of x) expect(timesRequested(unit)).toBe(1);

    // Y's syntheses push X's entries out of the 200-entry LRU (modelled by clearing the cache).
    synth.clearCache();
    await emitUtterance("cell-y", "y-1", answerY);
    await cycle(() => result.current, "cell-y");

    // X's units 1.. must be back in the cache before Play.
    for (const unit of x.slice(1)) expect(timesRequested(unit)).toBeGreaterThanOrEqual(2);
  });

  it("preloads never delay the playing run's next unit", async () => {
    // The ranking itself is anytts' scheduler; what the host and player owe it
    // is the tier each request is made on.
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

    for (const unit of x.slice(1)) {
      expect(synth.callsFor(unit).map((call) => call.tier)).toEqual(["preload"]);
    }
    // P's remainder goes out on the run tier, the top of the library's ranking.
    for (const unit of p.slice(2)) {
      expect(synth.callsFor(unit).map((call) => call.tier)).toContain("run");
    }
  });

  it("an evicted unit is requested again when its cache state is cold", async () => {
    const answerX = response(6, "Xray");
    const x = unitsOf(answerX);
    // x[2] stays in flight: warming, not cold, so it must not be asked again.
    synth.hold(x[2]);
    const { result } = renderHook(() => useSpeechHost());

    await cycle(() => result.current, "cell-x");
    await emitUtterance("cell-x", "x-1", answerX);
    for (const unit of x) expect(timesRequested(unit)).toBe(1);
    const signal = synth.callsFor(x[1])[0].signal;

    // The LRU pushes every landed result out.
    synth.clearCache();
    await emitUtterance("cell-y", "y-1", response(2, "Yankee"));

    for (const unit of [x[1], ...x.slice(3)]) {
      expect(timesRequested(unit)).toBe(2);
      const last = synth.callsFor(unit).at(-1);
      expect(last?.tier).toBe("preload");
      expect(last?.signal).toBe(signal);
    }
    expect(synth.callsFor(x[2])).toHaveLength(1);
  });

  it("an aborted preload is not a failed preload", async () => {
    const markdown = response(5);
    const units = holdAll(markdown);
    const { result } = renderHook(() => useSpeechHost());

    await cycle(() => result.current, "cell-a"); // armed
    await emitUtterance("cell-a", "u-1", markdown);
    const signal = synth.callsFor(units[1])[0].signal;

    // Disarm and arm again inside one task: the aborted preloads' rejections
    // land only after the fresh preloads are out. Counted as failures, they
    // would call off the utterance again — the fresh preloads with it.
    act(() => result.current.cycleSpeechMode("cell-a")); // autoplay
    act(() => result.current.cycleSpeechMode("cell-a")); // off
    act(() => result.current.cycleSpeechMode("cell-a")); // armed
    await act(async () => {
      await drain();
    });

    expect(signal?.aborted).toBe(true);
    for (const unit of units.slice(1)) {
      const last = synth.callsFor(unit).at(-1);
      expect(last?.signal).not.toBe(signal);
      expect(last?.signal?.aborted).toBe(false);
    }
    expect(synth.heldTexts).toEqual(units.slice(1));

    // Nor did they forget the fresh preloads: the next opportunity asks for
    // none of them again.
    await emitUtterance("cell-b", "b-1", response(2, "Bravo"));
    for (const unit of units.slice(1)) expect(synth.callsFor(unit)).toHaveLength(2);
  });
});
