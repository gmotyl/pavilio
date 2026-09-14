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
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const synth = vi.hoisted(() => {
  const buffers = new Map<string, ArrayBuffer>();
  const bufferText = new Map<ArrayBuffer, string>();
  const blobText = new Map<Blob, string>();
  const cache = new Map<string, Promise<ArrayBuffer>>();

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
    const promise = Promise.resolve(bufferFor(text));
    cache.set(key, promise);
    return promise;
  }

  return {
    synthesizeSpeech,
    prefetchSpeech: (text: string, options: { voice?: string } = {}): void => {
      void synthesizeSpeech(text, options).catch(() => {});
    },
    toSpeechBlob: (buffer: ArrayBuffer): Blob => {
      const blob = new Blob([buffer], { type: "audio/mpeg" });
      blobText.set(blob, bufferText.get(buffer) ?? "unknown");
      return blob;
    },
    textForBlob: (blob: Blob): string => blobText.get(blob) ?? "unknown",
    reset: (): void => {
      cache.clear();
    },
  };
});

vi.mock("../synth", () => ({
  synthesizeSpeech: synth.synthesizeSpeech,
  prefetchSpeech: synth.prefetchSpeech,
  toSpeechBlob: synth.toSpeechBlob,
  // Every segment cold, so `data-segment` can only ever say "played" because a
  // duration was recorded for it — never because the cache happened to be warm
  // or still warming.
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  // A cache that never changes still has to be subscribable: the bar subscribes
  // on mount so a synthesis landing during a pause is not invisible.
  subscribeSpeechCache: () => () => {},
  SPEECH_AUDIO_MIME_TYPE: "audio/mpeg",
}));

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

import { SpeechControlBar } from "../../terminal/SpeechControlBar";
import { prepare } from "../prepare";
import type { GridSpeech } from "../types";
import { useSpeechHost } from "../useSpeechHost";

const elements: HTMLMediaElement[] = [];

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

function Harness({ sessionId }: { sessionId: string }) {
  const speech = useSpeechHost();
  host = speech;
  return <SpeechControlBar sessionId={sessionId} speech={speech} />;
}

async function drain(): Promise<void> {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
}

async function settle(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await drain();
  });
}

async function emitUtterance(sessionId: string, id: string, text: string): Promise<void> {
  await act(async () => {
    ws.emit({ type: "speech-utterance", id, sessionId, text, at: Date.now() });
    await drain();
  });
}

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

async function endCurrentUnit(): Promise<void> {
  const element = currentElement();
  await act(async () => {
    element.dispatchEvent(new Event("ended"));
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

const response = (tag: string, ...lengths: number[]): string =>
  lengths.map((chars, index) => paragraph(chars, `${tag}${index}`)).join("\n\n");

const charsOf = (text: string): number[] =>
  prepare(text, { language: "en" }).units.map((unit) => unit.chars);

/** The rendered width of a segment, as a number of percent. */
const widthOf = (index: number): number =>
  Number.parseFloat(screen.getByTestId(`speech-bar-segment-cell-a-${index}`).style.width);

const segmentAt = (index: number): string | null =>
  screen.getByTestId(`speech-bar-segment-cell-a-${index}`).getAttribute("data-segment");

/** Two answers: the one that gets measured, and the one that must not inherit. */
const MEASURED = response("m", 240, 300);
const ARRIVING = response("n", 240, 300, 240);

/** Plays the cell's current utterance right through, measuring both its units. */
async function playMeasuredThrough(): Promise<void> {
  await settle(() => host.onSpeak("cell-a"));
  await loadDuration(2);
  await endCurrentUnit();
  await loadDuration(20);
  await endCurrentUnit();
}

beforeEach(() => {
  synth.reset();
  elements.length = 0;
  ws.setters.clear();
  localStorage.clear();

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
    if (this.getAttribute("src")) elements.push(this);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

describe("the scrubber's durations belong to an utterance, not to a cell", () => {
  it("the fixture answers split one unit per paragraph", () => {
    // The widths below are only meaningful if these are the char counts the
    // bar is actually seeded from.
    expect(charsOf(MEASURED)).toEqual([240, 300]);
    expect(charsOf(ARRIVING)).toEqual([240, 300, 240]);
  });

  it("a new answer does not inherit the finished answer's durations", async () => {
    render(<Harness sessionId="cell-a" />);

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
    render(<Harness sessionId="cell-a" />);

    // Two answers, neither played: the newer is current, the older is history.
    await emitUtterance("cell-a", "u-1", MEASURED);
    await emitUtterance("cell-a", "u-2", ARRIVING);
    expect(host.queueFor("cell-a").previous?.id).toBe("u-1");
    expect(host.queueFor("cell-a").current?.id).toBe("u-2");

    // Step back and play the older one right through. Its last unit ending
    // returns the cursor to `current` — onto the answer nobody has played.
    await settle(() => host.onPrevious("cell-a"));
    await loadDuration(2);
    await endCurrentUnit();
    await loadDuration(20);
    await endCurrentUnit();

    expect(host.queueFor("cell-a").cursor).toBe("current");
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
    render(<Harness sessionId="cell-a" />);

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

    // `next` supersedes the live run mid-unit and plays the new answer.
    await settle(() => host.onNext("cell-a"));
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
    render(<Harness sessionId="cell-a" />);

    await emitUtterance("cell-a", "u-1", MEASURED);
    // Armed, so the answer that lands next speaks by itself.
    await settle(() => host.onArm("cell-a"));
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
    render(<Harness sessionId="cell-a" />);

    await emitUtterance("cell-a", "u-1", MEASURED);
    await emitUtterance("cell-a", "u-2", ARRIVING);
    await settle(() => host.onPrevious("cell-a"));
    await loadDuration(2);
    await endCurrentUnit();
    await loadDuration(20);

    // The cursor is on the utterance being measured, so the widths it learned
    // are exactly the ones it may keep: 2s and 20s of 22.
    expect(host.queueFor("cell-a").cursor).toBe("previous");
    expect([...host.unitDurationsFor("cell-a")]).toEqual([
      [0, 2],
      [1, 20],
    ]);
    expect(widthOf(0)).toBeCloseTo(9.1, 1);
    expect(widthOf(1)).toBeCloseTo(90.9, 1);
  });
});
