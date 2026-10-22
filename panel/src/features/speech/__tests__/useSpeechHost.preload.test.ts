/**
 * What the host synthesizes ahead of a click, and what it must keep stable
 * while it plays: armed cells preloading whole answers (and keeping that
 * preload while other cells come and go), the scrubber's durations belonging
 * to an utterance, and the host object's identity across the playhead.
 */
import { act, render, renderHook, screen } from "@testing-library/react";
import { Activity, createElement, useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  drain,
  elements,
  emitUtterance,
  endCurrentUnit,
  endRun,
  played,
  requestedTexts,
  resetSpeechHarness,
  response,
  selectSynth,
  settle,
  synthMock,
  tieredSynth as synth,
  timesRequested,
  unitsOf,
  useWebSocketMock,
} from "./speech.harness";

vi.mock("../synth", () => synthMock());
vi.mock("../../realtime/useWebSocket", () => useWebSocketMock());

import { SpeechControlBar } from "../../terminal/SpeechControlBar";
import { prepare } from "../prepare";
import type { GridSpeech } from "../types";
import { useSpeechHost, type SpeechHost } from "../useSpeechHost";
import { voiceForSession } from "../../terminal/sessionVoice";
import { storeAnswerWaiting } from "./answerWaitingPort";

/**
 * jsdom has no media engine: `duration` is pinned to NaN, so a unit can never
 * report how long it is and `unitDurations` could never be populated at all.
 * Backed by a map instead, written by {@link loadDuration}.
 */
const unitLengths = new WeakMap<HTMLMediaElement, number>();
Object.defineProperty(HTMLMediaElement.prototype, "duration", {
  configurable: true,
  enumerable: true,
  get(this: HTMLMediaElement): number {
    return unitLengths.get(this) ?? NaN;
  },
});

const nativeSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src")!;
Object.defineProperty(HTMLMediaElement.prototype, "src", {
  configurable: true,
  enumerable: nativeSrc.enumerable,
  get(this: HTMLMediaElement): string {
    return nativeSrc.get!.call(this) as string;
  },
  set(this: HTMLMediaElement, value: string) {
    this.currentTime = 0;
    // A fresh source has no duration until it loads, exactly as in a browser.
    unitLengths.delete(this);
    nativeSrc.set!.call(this, value);
  },
});

/** The live host, captured from the component that mounts it. */
let host: GridSpeech;

function ScrubberHarness({ sessionId }: { sessionId: string }) {
  const speech = useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting });
  host = speech;
  return createElement(SpeechControlBar, {
    sessionId,
    speech,
    answerOpen: false,
    onToggleAnswer: () => {},
    // No terminal here, and nothing in this file clicks a launcher.
    send: () => true,
  });
}

beforeEach(resetSpeechHarness);

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

/**
 * Armed cells, seen from the host: the whole of an unheard answer is
 * synthesized up front, silently, on anytts' `preload` tier — behind the
 * playing run (`run`) and the unit-0 warms (`warm`), which the library ranks.
 * The host's part is the tier it asks on and the one signal per utterance it
 * calls the answer off with.
 *
 * The harness is `speech.harness.ts`, with the synthesis stand-in
 * switched to `fakeTieredSynth.ts`: requests queue at call time, each caller
 * aborts on its own signal, and a flight nobody holds is dropped.
 */
describe("useSpeechHost — armed cells preload whole answers", () => {
  beforeEach(() => selectSynth("tiered"));

  it("an armed cell's arriving answer is synthesized whole and stays silent", async () => {
    const markdown = response(5);
    const units = unitsOf(markdown);
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

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
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

    await cycle(() => result.current, "cell-a", 2); // autoplay
    await emitUtterance("cell-a", "u-1", markdown);

    expect([...new Set(requestedTexts())].sort()).toEqual([...units].sort());
    for (const unit of units) expect(timesRequested(unit)).toBe(1);
  });

  it("arming a cell preloads its held unheard answer", async () => {
    const markdown = response(4);
    const units = unitsOf(markdown);
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

    await emitUtterance("cell-a", "u-1", markdown);
    expect(requestedTexts()).toEqual([units[0]]);

    await cycle(() => result.current, "cell-a"); // armed

    expect(requestedTexts()).toEqual(units);
    expect(played).toEqual([]);
  });

  it("an off cell only warms unit 0", async () => {
    const markdown = response(4);
    const units = unitsOf(markdown);
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

    await emitUtterance("cell-a", "u-1", markdown);

    expect(result.current.speechModeOf("cell-a")).toBe("off");
    expect(requestedTexts()).toEqual([units[0]]);
  });

  it("heard answers are never preloaded", async () => {
    const markdown = response(4);
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

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

  it("unit 0 is warmed on the warm tier and armed units on the preload tier, each on its own signal", async () => {
    const markdown = response(4);
    const [first, ...rest] = unitsOf(markdown);
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

    await cycle(() => result.current, "cell-a"); // armed
    await emitUtterance("cell-a", "u-1", markdown);

    expect(synth.callsFor(first).map((call) => call.tier)).toEqual(["warm"]);
    for (const unit of rest) {
      expect(synth.callsFor(unit).map((call) => call.tier)).toEqual(["preload"]);
    }
    // One signal for the whole remainder, so one abort calls all of it off —
    // and another for unit 0's warm, which a disarm or a failed preload must
    // not take down with it.
    const warmSignal = synth.callsFor(first)[0].signal;
    const signal = synth.callsFor(rest[0])[0].signal;
    expect(warmSignal).toBeInstanceOf(AbortSignal);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(warmSignal).not.toBe(signal);
    expect(warmSignal?.aborted).toBe(false);
    expect(signal?.aborted).toBe(false);
    for (const unit of rest) expect(synth.callsFor(unit)[0].signal).toBe(signal);

    // Another utterance has its own.
    const other = unitsOf(response(2, "Bravo"));
    await emitUtterance("cell-b", "b-1", response(2, "Bravo"));
    expect(synth.callsFor(other[0])[0].tier).toBe("warm");
    expect(synth.callsFor(other[0])[0].signal).not.toBe(signal);
    expect(synth.callsFor(other[0])[0].signal).not.toBe(warmSignal);
  });

  it("a heard utterance's controller is aborted", async () => {
    const markdown = response(3);
    const units = unitsOf(markdown);
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

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
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

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
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

    await cycle(() => result.current, "cell-a"); // armed
    await emitUtterance("cell-a", "u-1", markdown);
    // anytts queues at call time: every unit is asked for at once.
    expect(requestedTexts()).toEqual(units);
    const signal = synth.callsFor(units[1])[0].signal;

    await cycle(() => result.current, "cell-a"); // autoplay: still armed
    expect(signal?.aborted).toBe(false);
    await cycle(() => result.current, "cell-a"); // off
    expect(result.current.speechModeOf("cell-a")).toBe("off");

    // Called off: the library holds nothing of the remainder any more, and
    // none of it is asked for again — not even at the next opportunity. Unit
    // 0's warm is not a preload: an off cell still warms it, so it survives.
    expect(signal?.aborted).toBe(true);
    expect(synth.callsFor(units[0])[0].signal?.aborted).toBe(false);
    expect(synth.heldTexts).toEqual([units[0]]);
    await emitUtterance("cell-b", "b-1", response(2, "Bravo"));
    for (const unit of units) expect(timesRequested(unit)).toBe(1);
    expect(played).toEqual([]);

    // Arming again picks the remainder up, on a fresh signal; unit 0 is still
    // the one warm already out.
    await cycle(() => result.current, "cell-a");
    expect(timesRequested(units[0])).toBe(1);
    for (const unit of units.slice(1)) {
      expect(timesRequested(unit)).toBe(2);
      const last = synth.callsFor(unit).at(-1);
      expect(last?.tier).toBe("preload");
      expect(last?.signal).not.toBe(signal);
      expect(last?.signal?.aborted).toBe(false);
    }
  });

  it("a disarm keeps unit 0's pending warm alive", async () => {
    const markdown = response(4);
    const units = holdAll(markdown);
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

    await cycle(() => result.current, "cell-a"); // armed
    await emitUtterance("cell-a", "u-1", markdown);
    const warm = synth.callsFor(units[0])[0].signal;
    expect(result.current.stateFor("cell-a")).toBe("preparing");

    await cycle(() => result.current, "cell-a", 2); // autoplay, then off
    expect(result.current.speechModeOf("cell-a")).toBe("off");

    // The warm is still out, and the cell is still red for it…
    expect(warm?.aborted).toBe(false);
    expect(synth.heldTexts).toEqual([units[0]]);
    expect(result.current.stateFor("cell-a")).toBe("preparing");

    // …until it lands, and only then is the cell ready — with unit 0 warm.
    await act(async () => {
      synth.release(units[0]);
      await drain();
    });
    expect(result.current.stateFor("cell-a")).toBe("ready");
    expect(synth.isSpeechSynthesized(units[0], { voice: synth.callsFor(units[0])[0].voice })).toBe(true);
    expect(timesRequested(units[0])).toBe(1);
  });

  it("a failed preload does not abort unit 0's warm", async () => {
    const markdown = response(4);
    const units = holdAll(markdown);
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

    await cycle(() => result.current, "cell-a"); // armed
    await emitUtterance("cell-a", "u-1", markdown);
    const warm = synth.callsFor(units[0])[0].signal;

    await act(async () => {
      synth.fail(units[1]);
      await drain();
    });
    // The remainder is called off; the warm is not.
    for (const unit of units.slice(2)) {
      expect(synth.callsFor(unit)[0].signal?.aborted).toBe(true);
    }
    expect(warm?.aborted).toBe(false);
    expect(synth.heldTexts).toEqual([units[0]]);
    expect(result.current.stateFor("cell-a")).toBe("preparing");

    await act(async () => {
      synth.release(units[0]);
      await drain();
    });
    expect(result.current.stateFor("cell-a")).toBe("ready");
    expect(synth.isSpeechSynthesized(units[0], { voice: synth.callsFor(units[0])[0].voice })).toBe(true);
  });

  it("a failed preload stops the rest of the pass and is retried on the next arrival", async () => {
    const markdown = response(5);
    const units = holdAll(markdown);
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

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
    // Only unit 0's warm is still out.
    expect(synth.heldTexts).toEqual([units[0]]);

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
    const { result } = renderHook(
      () => useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
      { reactStrictMode: true },
    );

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
    const { result, unmount } = renderHook(
      () => useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
      { wrapper: Wrapper },
    );

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

/**
 * Armed cells, seen from the host: the whole of an unheard answer is
 * synthesized up front, silently, on anytts' `preload` tier — behind the
 * playing run and the unit-0 warms, which the library ranks — and called off
 * through the utterance's one signal.
 *
 * The harness is `speech.harness.ts`, with the synthesis stand-in
 * switched to `fakeTieredSynth.ts`: requests queue at call time, texts can be
 * held open, each caller aborts on its own signal, and `clearCache` models the
 * LRU evicting results.
 */
describe("useSpeechHost — armed cell preload survives other cells", () => {
  beforeEach(() => selectSynth("tiered"));

  it("arming a second cell in another project does not stop the first cell's preload", async () => {
    const answerX = response(6, "Xray");
    const answerY = response(4, "Yankee");
    const x = unitsOf(answerX);
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

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
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

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
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

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
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

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
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

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
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

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
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

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
    // Unit 0's warm was never called off: a disarm leaves it running.
    expect(synth.heldTexts).toEqual(units);

    // Nor did they forget the fresh preloads: the next opportunity asks for
    // none of them again.
    await emitUtterance("cell-b", "b-1", response(2, "Bravo"));
    for (const unit of units.slice(1)) expect(synth.callsFor(unit)).toHaveLength(2);
  });
});

function currentElement(): HTMLMediaElement {
  const element = elements[elements.length - 1];
  if (!element) throw new Error("nothing is playing");
  return element;
}

/** The unit in the element reports its real length, as a browser does. */
async function loadDuration(seconds: number): Promise<void> {
  const element = currentElement();
  unitLengths.set(element, seconds);
  await act(async () => {
    element.dispatchEvent(new Event("loadedmetadata"));
    await drain();
  });
}

/**
 * One paragraph of exactly `chars` characters. Every length used here is over
 * 225, so no two of them can be packed into one unit (their sum clears the
 * 450-character ceiling) — one paragraph in, one unit out.
 */
function paragraph(chars: number, tag: string): string {
  const head = `Paragraph ${tag} `;
  return head + "x".repeat(chars - head.length - 1) + ".";
}

const sized = (tag: string, ...lengths: number[]): string =>
  lengths.map((chars, index) => paragraph(chars, `${tag}${index}`)).join("\n\n");

const charsOf = (text: string): number[] =>
  prepare(text, { language: "en" }).units.map((unit) => unit.chars);

/** The rendered width of a segment, as a number of percent. */
const widthOf = (index: number): number =>
  Number.parseFloat(screen.getByTestId(`speech-bar-segment-cell-a-${index}`).style.width);

const segmentAt = (index: number): string | null =>
  screen.getByTestId(`speech-bar-segment-cell-a-${index}`).getAttribute("data-segment");

/** Two answers: the one that gets measured, and the one that must not inherit. */
const MEASURED = sized("m", 240, 300);
const ARRIVING = sized("n", 240, 300, 240);

/** Plays the cell's current utterance right through, measuring both its units. */
async function playMeasuredThrough(): Promise<void> {
  await settle(() => host.onSpeak("cell-a"));
  await loadDuration(2);
  await endCurrentUnit();
  await loadDuration(20);
  await endCurrentUnit();
}

/**
 * Whose measurements the scrubber is allowed to draw.
 *
 * `unitDurations` is a map from unit INDEX to seconds, and an index means
 * nothing without the utterance it indexes into. Unit 0 of the answer that just
 * finished and unit 0 of the answer that just arrived are both "0", so a map
 * kept across the change paints the new answer with the old one's timings — and
 * `SpeechControlBar` reads `durations.has(index)` as "played", which makes the
 * first segment of an answer **nobody has heard** render as already spoken.
 * That is the one thing a scrubber must never get wrong.
 *
 * Both routes onto a never-played utterance are covered: an arrival taking the
 * cursor over, and the cursor coming back out of a `previous` replay. The bar
 * is the real one, mounted on the real host, because the symptom is what the
 * user sees rather than what the host returns.
 */
describe("the scrubber's durations belong to an utterance, not to a cell", () => {
  beforeEach(() => selectSynth("simple", "never"));

  it("the fixture answers split one unit per paragraph", () => {
    // The widths below are only meaningful if these are the char counts the
    // bar is actually seeded from.
    expect(charsOf(MEASURED)).toEqual([240, 300]);
    expect(charsOf(ARRIVING)).toEqual([240, 300, 240]);
  });

  it("a new answer does not inherit the finished answer's durations", async () => {
    render(createElement(ScrubberHarness, { sessionId: "cell-a" }));

    await emitUtterance("cell-a", "u-1", MEASURED);
    await playMeasuredThrough();

    // The finished answer keeps what it learned: it is still what the cursor
    // is on, and a bar that collapsed back to estimates the moment the audio
    // stopped would throw away the measurements.
    expect(host.stateFor("cell-a")).toBe("heard");
    expect([...host.unitDurationsFor("cell-a")]).toEqual([
      [0, 2],
      [1, 20],
    ]);

    // A different answer arrives and takes the cursor. Nobody has heard a word
    // of it, and nothing in it has ever been measured.
    await emitUtterance("cell-a", "u-2", ARRIVING);

    expect(host.stateFor("cell-a")).toBe("ready");
    expect(host.unitsFor("cell-a")).toHaveLength(3);
    expect([...host.unitDurationsFor("cell-a")]).toEqual([]);

    // The visible half. Nothing may claim to have been played…
    expect(segmentAt(0)).toBe("cold");
    expect(segmentAt(1)).toBe("cold");
    expect(segmentAt(2)).toBe("cold");
    // …and every width comes from `chars`: 240/300/240 of 780.
    expect(widthOf(0)).toBeCloseTo(30.8, 1);
    expect(widthOf(1)).toBeCloseTo(38.5, 1);
    expect(widthOf(2)).toBeCloseTo(30.8, 1);
  });

  it("coming back out of a previous replay does not carry its durations forward", async () => {
    render(createElement(ScrubberHarness, { sessionId: "cell-a" }));

    // Two answers, neither played: the newer is current, the older is history.
    await emitUtterance("cell-a", "u-1", MEASURED);
    await emitUtterance("cell-a", "u-2", ARRIVING);
    expect(host.queueFor("cell-a").previous.map((step) => step.id)).toEqual(["u-1"]);
    expect(host.queueFor("cell-a").current?.id).toBe("u-2");

    // Step back and play the older one right through. Its last unit ending
    // returns the cursor to the newest answer — onto the one nobody has
    // played. Stepping back is silent, so the play control is the second half
    // of "step back and play".
    await settle(() => host.onPrevious("cell-a"));
    await settle(() => host.onSpeak("cell-a"));
    await loadDuration(2);
    await endCurrentUnit();
    await loadDuration(20);
    await endCurrentUnit();

    expect(host.queueFor("cell-a").cursor).toBe(0);
    expect(host.unitsFor("cell-a")).toHaveLength(3);
    expect([...host.unitDurationsFor("cell-a")]).toEqual([]);

    expect(segmentAt(0)).toBe("cold");
    expect(widthOf(0)).toBeCloseTo(30.8, 1);
    expect(widthOf(1)).toBeCloseTo(38.5, 1);
    expect(widthOf(2)).toBeCloseTo(30.8, 1);
  });

  it("a barge-in onto the queued answer does not hand it the live run's durations", async () => {
    // The race the doc comment above `measuredUtteranceRef` argues away:
    // `playingUtteranceRef` is written eagerly inside the click, while the
    // effect that copies it into `measuredUtteranceRef` runs a pass later. If
    // the player's map survived into that pass, the new answer would be
    // painted with the old one's seconds.
    render(createElement(ScrubberHarness, { sessionId: "cell-a" }));

    await emitUtterance("cell-a", "u-1", MEASURED);
    await settle(() => host.onSpeak("cell-a"));
    await loadDuration(2);
    await endCurrentUnit();
    await loadDuration(20);

    // A live run, both of its units measured, and the next answer QUEUED
    // behind it — a live run is never cut short by an arrival.
    expect(host.stateFor("cell-a")).toBe("speaking");
    expect([...host.unitDurationsFor("cell-a")]).toEqual([
      [0, 2],
      [1, 20],
    ]);
    await emitUtterance("cell-a", "u-2", ARRIVING);
    expect(host.queueFor("cell-a").pending.map((u) => u.id)).toEqual(["u-2"]);

    // Every intermediate pass is recorded, not only the settled one: the
    // question is whether the player's map clears in the SAME React batch as
    // the new `play` or one render later, and only a mid-flight reading can
    // tell those apart. The listener fires from the very effect that mirrors
    // the map, so it sees each pair exactly as the bar would.
    const seen: Array<{ cursor: string | undefined; measured: number }> = [];
    const unsubscribe = host.subscribeProgress(() => {
      seen.push({
        cursor: host.queueFor("cell-a").current?.id,
        measured: host.unitDurationsFor("cell-a").size,
      });
    });

    // `next` moves onto the queued answer and the play control starts it,
    // superseding the live run mid-unit. Stepping is silent in both directions
    // now, so "barge in with next" is two calls — the same shape the replay
    // test above uses, and the run it produces is the same barge-in.
    await settle(() => host.onNext("cell-a"));
    await settle(() => host.onSpeak("cell-a"));
    unsubscribe();

    // `play` clears the map synchronously, inside the same call `speakUtterance`
    // makes right after writing `playingUtteranceRef` — so the two never
    // disagree, in any pass, not merely in the settled one.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((pass) => pass.cursor === "u-2" && pass.measured > 0)).toEqual([]);

    expect(host.queueFor("cell-a").current?.id).toBe("u-2");
    expect(host.unitsFor("cell-a")).toHaveLength(3);
    // Unit 0 is the one in the element, so it is `playing`; nothing BEHIND the
    // playhead has been heard, which is where an inherited map would show.
    expect(segmentAt(0)).toBe("playing");
    expect(segmentAt(1)).toBe("cold");
    expect(segmentAt(2)).toBe("cold");
    // And the widths are still the character estimate: 240/300/240 of 780.
    expect(widthOf(0)).toBeCloseTo(30.8, 1);
    expect(widthOf(1)).toBeCloseTo(38.5, 1);
    expect(widthOf(2)).toBeCloseTo(30.8, 1);
  });

  it("an arrival superseding a paused run does not hand the new answer its durations", async () => {
    // The third route onto a new utterance, and the one with the most passes
    // between the two halves: the arrival effect stops the held run (which
    // leaves `speakingSessionId` null while the player's map still stands),
    // the queue advances, and only then does autoplay call `play`.
    render(createElement(ScrubberHarness, { sessionId: "cell-a" }));

    await emitUtterance("cell-a", "u-1", MEASURED);
    // Armed, so the answer that lands next speaks by itself.
    await settle(() => {
      host.cycleSpeechMode("cell-a"); // armed
      host.cycleSpeechMode("cell-a"); // autoplay
    });
    await settle(() => host.onSpeak("cell-a"));
    await loadDuration(2);
    await endCurrentUnit();
    await loadDuration(20);
    await settle(() => host.onPause("cell-a"));

    expect(host.stateFor("cell-a")).toBe("paused");
    expect([...host.unitDurationsFor("cell-a")]).toEqual([
      [0, 2],
      [1, 20],
    ]);

    // "A paused cell does not hold the next answer hostage": the arrival
    // supersedes the held run and autoplay speaks it.
    await emitUtterance("cell-a", "u-2", ARRIVING);

    expect(host.queueFor("cell-a").current?.id).toBe("u-2");
    expect(host.stateFor("cell-a")).toBe("speaking");
    expect([...host.unitDurationsFor("cell-a")]).toEqual([]);
    expect(segmentAt(0)).toBe("playing");
    expect(segmentAt(1)).toBe("cold");
    expect(segmentAt(2)).toBe("cold");
    expect(widthOf(0)).toBeCloseTo(30.8, 1);
    expect(widthOf(1)).toBeCloseTo(38.5, 1);
    expect(widthOf(2)).toBeCloseTo(30.8, 1);
  });

  it("a replay of the measured answer keeps its own measurements", async () => {
    render(createElement(ScrubberHarness, { sessionId: "cell-a" }));

    await emitUtterance("cell-a", "u-1", MEASURED);
    await emitUtterance("cell-a", "u-2", ARRIVING);
    // Silent step, then play: the replay is what takes the measurements.
    await settle(() => host.onPrevious("cell-a"));
    await settle(() => host.onSpeak("cell-a"));
    await loadDuration(2);
    await endCurrentUnit();
    await loadDuration(20);

    // The cursor is on the utterance being measured, so the widths it learned
    // are exactly the ones it may keep: 2s and 20s of 22.
    expect(host.queueFor("cell-a").cursor).toBe(1);
    expect([...host.unitDurationsFor("cell-a")]).toEqual([
      [0, 2],
      [1, 20],
    ]);
    expect(widthOf(0)).toBeCloseTo(9.1, 1);
    expect(widthOf(1)).toBeCloseTo(90.9, 1);
  });
});

/** The element reports a playback position, as `timeupdate` does. */
async function reportTime(seconds: number): Promise<void> {
  const element = currentElement();
  element.currentTime = seconds;
  await act(async () => {
    element.dispatchEvent(new Event("timeupdate"));
    await drain();
  });
}

/** Which members of the host changed identity — the useful failure message. */
function changedKeys(before: SpeechHost, after: SpeechHost): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof SpeechHost>;
  return [...keys].filter((key) => !Object.is(before[key], after[key])).sort();
}

/**
 * The one assertion that makes the external store worth having.
 *
 * `player.progress` moves on every `timeupdate` — roughly 4 Hz — and one host
 * serves the whole panel. The playhead was moved out onto a `useSyncExternalStore`
 * so that a moving position would NOT re-render every cell in the grid; three
 * doc comments (`types.ts` on `subscribeProgress`, this hook's own, and
 * `SpeechControlBar`'s) say so in as many words.
 *
 * None of that holds unless the `GridSpeech` object itself stays put across a
 * `timeupdate`. It did not: `useSpeechPlayer` memoizes on `progress` and
 * `unitDurations`, so the player OBJECT changes identity at 4 Hz, and nine
 * callbacks here took the whole player as a dependency — which handed the churn
 * straight back through the `speech` prop that the store was meant to bypass.
 * Nothing in the suite asserted identity at all, so it regressed silently.
 * This file is the pin.
 */
describe("the speech context outlives the playhead", () => {
  beforeEach(() => selectSynth("simple", "never"));

  it("a timeupdate moves the progress store and leaves GridSpeech identical", async () => {
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

    await emitUtterance("cell-a", "u-1", response(3));
    await settle(() => result.current.onSpeak("cell-a"));
    await loadDuration(12);

    const before = result.current;
    expect(before.progressFor("cell-a")?.unitTime).toBe(0);

    await reportTime(3);

    // The playhead moved — read through the SAME object, which is the whole
    // point: a bar holds one `speech` prop and reads the position off the store.
    expect(before.progressFor("cell-a")?.unitTime).toBe(3);
    // …and the object every cell in the grid holds did not change, so no cell
    // but the speaking one re-rendered.
    expect(changedKeys(before, result.current)).toEqual([]);
    expect(result.current).toBe(before);

    // Four times a second, not once: a callback rebuilt on the second tick is
    // exactly as expensive as one rebuilt on the first.
    await reportTime(6);
    await reportTime(9);
    expect(before.progressFor("cell-a")?.unitTime).toBe(9);
    expect(result.current).toBe(before);
  });

  it("a unit reporting its real duration leaves GridSpeech identical too", async () => {
    const { result } = renderHook(() =>
      useSpeechHost({ voiceFor: voiceForSession, answerWaiting: storeAnswerWaiting }),
    );

    await emitUtterance("cell-a", "u-1", response(3));
    await settle(() => result.current.onSpeak("cell-a"));

    const before = result.current;
    expect([...before.unitDurationsFor("cell-a")]).toEqual([]);

    // `unitDurations` is the player's other 4 Hz-adjacent reading, and it sits
    // in the same memo. It is published through the same store for the same
    // reason, so it must not move the host either.
    await loadDuration(12);

    expect([...before.unitDurationsFor("cell-a")]).toEqual([[0, 12]]);
    expect(changedKeys(before, result.current)).toEqual([]);
    expect(result.current).toBe(before);
  });
});
