/**
 * Armed cells, seen from the host: the whole of an unheard answer is
 * synthesized up front, silently, on anytts' `preload` tier — behind the
 * playing run (`run`) and the unit-0 warms (`warm`), which the library ranks.
 * The host's part is the tier it asks on and the one signal per utterance it
 * calls the answer off with.
 *
 * The harness is `useSpeechHost.test.ts`'s, with the synthesis stand-in
 * swapped for `fakeTieredSynth.ts`: requests queue at call time, each caller
 * aborts on its own signal, and a flight nobody holds is dropped.
 */
import { act, renderHook } from "@testing-library/react";
import { Activity, createElement, useState, type ReactNode } from "react";
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

  it("unit 0 is warmed on the warm tier and armed units on the preload tier, with the utterance's signal", async () => {
    const markdown = response(4);
    const [first, ...rest] = unitsOf(markdown);
    const { result } = renderHook(() => useSpeechHost());

    await cycle(() => result.current, "cell-a"); // armed
    await emitUtterance("cell-a", "u-1", markdown);

    expect(synth.callsFor(first).map((call) => call.tier)).toEqual(["warm"]);
    for (const unit of rest) {
      expect(synth.callsFor(unit).map((call) => call.tier)).toEqual(["preload"]);
    }
    // One signal for the whole utterance: one abort calls all of it off.
    const signal = synth.callsFor(first)[0].signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    for (const unit of rest) expect(synth.callsFor(unit)[0].signal).toBe(signal);

    // Another utterance has its own.
    const other = unitsOf(response(2, "Bravo"));
    await emitUtterance("cell-b", "b-1", response(2, "Bravo"));
    expect(synth.callsFor(other[0])[0].tier).toBe("warm");
    expect(synth.callsFor(other[0])[0].signal).not.toBe(signal);
  });

  it("a heard utterance's controller is aborted", async () => {
    const markdown = response(3);
    const units = unitsOf(markdown);
    const { result } = renderHook(() => useSpeechHost());

    await cycle(() => result.current, "cell-a"); // armed
    await emitUtterance("cell-a", "u-1", markdown);
    const signal = synth.callsFor(units[1])[0].signal;
    expect(signal?.aborted).toBe(false);

    await settle(() => result.current.onSpeak("cell-a"));
    await endRun();
    expect(result.current.stateFor("cell-a")).toBe("heard");

    expect(signal?.aborted).toBe(true);
    // And nothing of it is asked for again at the next opportunity.
    synth.clearCache();
    const before = synth.requests.length;
    await emitUtterance("cell-b", "b-1", response(2, "Bravo"));
    expect(synth.requests.slice(before).filter((request) => units.includes(request.text))).toEqual([]);
  });

  it("an utterance evicted from the queue has its controller aborted", async () => {
    const words = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"];
    const firstUnitOf = (word: string): string => unitsOf(response(3, word))[0];
    const { result } = renderHook(() => useSpeechHost());

    // u-1 speaks and is never let finish, so everything after it queues.
    await emitUtterance("cell-a", "u-1", response(3, words[0]));
    await settle(() => result.current.onSpeak("cell-a"));
    expect(result.current.stateFor("cell-a")).toBe("speaking");

    // u-2 is what the transport reaches next: warmed, on its own signal.
    await emitUtterance("cell-a", "u-2", response(3, words[1]));
    const signal = synth.callsFor(firstUnitOf(words[1]))[0].signal;
    expect(signal?.aborted).toBe(false);

    // Five more behind it push u-2 out past MAX_PENDING.
    for (let i = 2; i < words.length; i += 1) {
      await emitUtterance("cell-a", `u-${i + 1}`, response(3, words[i]));
    }
    const queue = result.current.queueFor("cell-a");
    expect(queue.pending.map((utterance) => utterance.id)).not.toContain("u-2");

    expect(signal?.aborted).toBe(true);
    // The utterance now next in line is warmed, and still wanted.
    const nextSignal = synth.callsFor(firstUnitOf(words[2]))[0].signal;
    expect(nextSignal?.aborted).toBe(false);
  });

  it("disarming aborts the cell's pending preloads", async () => {
    const markdown = response(5);
    const units = holdAll(markdown);
    const { result } = renderHook(() => useSpeechHost());

    await cycle(() => result.current, "cell-a"); // armed
    await emitUtterance("cell-a", "u-1", markdown);
    // anytts queues at call time: every unit is asked for at once.
    expect(requestedTexts()).toEqual(units);
    const signal = synth.callsFor(units[1])[0].signal;

    await cycle(() => result.current, "cell-a"); // autoplay: still armed
    expect(signal?.aborted).toBe(false);
    await cycle(() => result.current, "cell-a"); // off
    expect(result.current.speechModeOf("cell-a")).toBe("off");

    // Called off: the library holds nothing for it any more, and nothing of it
    // is asked for again — not even at the next opportunity.
    expect(signal?.aborted).toBe(true);
    expect(synth.held).toBe(0);
    await emitUtterance("cell-b", "b-1", response(2, "Bravo"));
    for (const unit of units) expect(timesRequested(unit)).toBe(1);
    expect(played).toEqual([]);

    // Arming again picks the remainder up, on a fresh signal.
    await cycle(() => result.current, "cell-a");
    for (const unit of units.slice(1)) {
      expect(timesRequested(unit)).toBe(2);
      const last = synth.callsFor(unit).at(-1);
      expect(last?.tier).toBe("preload");
      expect(last?.signal).not.toBe(signal);
      expect(last?.signal?.aborted).toBe(false);
    }
  });

  it("a failed preload stops the rest of the pass and is retried on the next arrival", async () => {
    const markdown = response(5);
    const units = holdAll(markdown);
    const { result } = renderHook(() => useSpeechHost());

    await cycle(() => result.current, "cell-a"); // armed
    await emitUtterance("cell-a", "u-1", markdown);
    expect(requestedTexts()).toEqual(units);

    // Unit 1 fails: the units still queued behind it are called off.
    await act(async () => {
      synth.fail(units[1]);
      await drain();
    });
    for (const unit of units.slice(2)) {
      expect(synth.callsFor(unit)[0].signal?.aborted).toBe(true);
    }
    expect(synth.held).toBe(0);

    // An arrival elsewhere is the next opportunity: the failed unit is asked
    // for again, once.
    await emitUtterance("cell-b", "b-1", response(2, "Bravo"));
    expect(timesRequested(units[1])).toBe(2);
  });

  it("the host survives React's development double-mount", async () => {
    const markdown = response(5);
    const units = holdAll(markdown);
    // StrictMode mounts, unmounts and remounts the host on the same state, so
    // the cleanup that aborts on the way out must not leave it dead.
    const { result } = renderHook(() => useSpeechHost(), { reactStrictMode: true });

    await cycle(() => result.current, "cell-a"); // armed
    await emitUtterance("cell-a", "u-1", markdown);
    expect(requestedTexts()).toEqual(units);
    for (const unit of units) expect(synth.callsFor(unit)[0].signal?.aborted).toBe(false);
  });

  it("unmount aborts every controller; remount warms again", async () => {
    const markdown = response(4);
    const units = holdAll(markdown);
    // `<Activity>` hidden-then-visible runs the host's effect cleanups and then
    // its setups on the SAME instance — what React's development double-mount
    // does, but with an utterance already in hand.
    let setMode: (mode: "visible" | "hidden") => void = () => {};
    function Wrapper({ children }: { children: ReactNode }) {
      const [mode, set] = useState<"visible" | "hidden">("visible");
      setMode = set;
      return createElement(Activity, { mode, children });
    }
    const { result, unmount } = renderHook(() => useSpeechHost(), { wrapper: Wrapper });

    await cycle(() => result.current, "cell-a"); // armed
    await emitUtterance("cell-a", "u-1", markdown);
    const first = synth.callsFor(units[0])[0].signal;
    expect(first?.aborted).toBe(false);

    await settle(() => setMode("hidden"));
    expect(first?.aborted).toBe(true);
    expect(synth.held).toBe(0);

    await settle(() => setMode("visible"));
    const warm = synth.callsFor(units[0]).at(-1);
    expect(warm?.tier).toBe("warm");
    expect(warm?.signal).not.toBe(first);
    expect(warm?.signal?.aborted).toBe(false);
    for (const unit of units) expect(timesRequested(unit)).toBe(2);
    expect(result.current.stateFor("cell-a")).toBe("preparing");

    unmount();
    for (const unit of units) expect(synth.callsFor(unit).at(-1)?.signal?.aborted).toBe(true);
    expect(synth.held).toBe(0);
  });
});
