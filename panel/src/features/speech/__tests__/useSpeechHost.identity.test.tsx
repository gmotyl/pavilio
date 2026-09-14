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
import { act, renderHook } from "@testing-library/react";
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
  isSpeechSynthesized: () => false,
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

import type { SpeechHost } from "../useSpeechHost";
import { useSpeechHost } from "../useSpeechHost";

const elements: HTMLMediaElement[] = [];

const unitLengths = new WeakMap<HTMLMediaElement, number>();
Object.defineProperty(HTMLMediaElement.prototype, "duration", {
  configurable: true,
  enumerable: true,
  get(this: HTMLMediaElement): number {
    return unitLengths.get(this) ?? NaN;
  },
});

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

/** The element reports a playback position, as `timeupdate` does. */
async function reportTime(seconds: number): Promise<void> {
  const element = currentElement();
  element.currentTime = seconds;
  await act(async () => {
    element.dispatchEvent(new Event("timeupdate"));
    await drain();
  });
}

async function loadDuration(seconds: number): Promise<void> {
  const element = currentElement();
  unitLengths.set(element, seconds);
  await act(async () => {
    element.dispatchEvent(new Event("loadedmetadata"));
    await drain();
  });
}

/** Which members of the host changed identity — the useful failure message. */
function changedKeys(before: SpeechHost, after: SpeechHost): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof SpeechHost>;
  return [...keys].filter((key) => !Object.is(before[key], after[key])).sort();
}

/** A response of `count` units, each comfortably inside the packing window. */
function response(count: number): string {
  return Array.from({ length: count }, (_, i) => {
    const head = `Paragraph ${String(i).padStart(2, "0")} `;
    return head + "x".repeat(238 - head.length) + ".";
  }).join("\n\n");
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

describe("the speech context outlives the playhead", () => {
  it("a timeupdate moves the progress store and leaves GridSpeech identical", async () => {
    const { result } = renderHook(() => useSpeechHost());

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
    const { result } = renderHook(() => useSpeechHost());

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
