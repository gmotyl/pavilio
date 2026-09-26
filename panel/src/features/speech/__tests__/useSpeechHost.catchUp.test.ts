/**
 * A recovered answer is SHOWN, never spoken — and it must not disturb the one
 * the user is already listening to.
 *
 * The channel calls `recordAutoplayed` for every utterance a catch-up takes up,
 * so an armed cell does not start talking on a return that raised no gesture
 * (ADR 0017). But a catch-up does not necessarily land under the cursor: a
 * speaking or paused cell queues it behind the live run, and a cursor parked in
 * the history stays on the answer the listener stepped back to. The record is
 * therefore about an utterance the autoplay effect is NOT watching, while the
 * effect's guard is about the one under the cursor — so a record that can only
 * remember one utterance answers the wrong question and the armed cell speaks.
 *
 * Both failures are silent in every other suite: the channel's own tests cannot
 * see `autoplayedRef`, and the host's cannot raise a catch-up. This file is the
 * only place the two meet.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Utterance } from "../types";

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

/**
 * The neutral reconnect frame is subscribed to directly rather than read off
 * `lastMessage` — see the channel — so this stands in for that subscription,
 * which would otherwise open a socket.
 */
const { realtimeListeners } = vi.hoisted(() => ({
  realtimeListeners: new Set<(frame: Record<string, unknown>) => void>(),
}));
vi.mock("../../realtime/channel", async () => {
  const actual =
    await vi.importActual<typeof import("../../realtime/channel")>("../../realtime/channel");
  return {
    ...actual,
    subscribeRealtime: (listener: (frame: Record<string, unknown>) => void) => {
      realtimeListeners.add(listener);
      return () => {
        realtimeListeners.delete(listener);
      };
    },
  };
});

import { REALTIME_RECONNECT_FRAME } from "../../realtime/channel";
import { prepare } from "../prepare";
import { useSpeechHost } from "../useSpeechHost";
import { utteranceUnderCursor } from "../utteranceQueue";

/** The `src` of every started playback, in order. A restart adds one. */
const played: string[] = [];
const elements: HTMLMediaElement[] = [];

async function drain(): Promise<void> {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
}

/**
 * The server's clock, monotonic across both arrival paths, so "newer" is a
 * fact about `at` rather than about the order the test happened to write.
 */
let clock = 1_000;
const nextAt = (): number => {
  clock += 1_000;
  return clock;
};

async function emitUtterance(sessionId: string, id: string, text: string): Promise<void> {
  await act(async () => {
    ws.emit({ type: "speech-utterance", id, sessionId, text, at: nextAt() });
    await drain();
  });
}

function serveLatest(utterances: Utterance[]): void {
  global.fetch = vi.fn(
    async () => ({ ok: true, json: async () => ({ utterances }) }) as Response,
  ) as unknown as typeof fetch;
}

/**
 * A return: the socket comes back, the channel re-asks `/latest` and the panel
 * server hands back the one answer it retained for the session.
 */
async function caughtUp(sessionId: string, id: string, text: string): Promise<void> {
  serveLatest([{ id, sessionId, text, at: nextAt() }]);
  await act(async () => {
    for (const listener of [...realtimeListeners]) listener({ ...REALTIME_RECONNECT_FRAME });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // A further macrotask plus a drain, so the fetch, its `json()`, the commit
  // effect and everything the autoplay effect starts have all settled.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await drain();
  });
}

async function settle(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await drain();
  });
}

async function endCurrentUnit(): Promise<void> {
  const element = elements[elements.length - 1];
  if (!element) throw new Error("nothing is playing");
  await act(async () => {
    element.dispatchEvent(new Event("ended"));
    await drain();
  });
}

function response(count: number, word = "Paragraph"): string {
  return Array.from({ length: count }, (_, i) => {
    const head = `${word} ${String(i).padStart(2, "0")} `;
    return head + "x".repeat(238 - head.length) + ".";
  }).join("\n\n");
}

const unitsOf = (text: string): string[] =>
  prepare(text, { language: "en" }).units.map((unit) => unit.text);

const FIRST = response(2, "First");
const SECOND = response(2, "Second");
const THIRD = response(2, "Third");
const RECOVERED = response(2, "Recovered");

beforeEach(() => {
  synth.reset();
  played.length = 0;
  elements.length = 0;
  ws.setters.clear();
  realtimeListeners.clear();
  localStorage.clear();
  clock = 1_000;
  serveLatest([]);

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
    // `unlock()` plays a source-less element on purpose; that is not audio, and
    // whether audio started is this file's whole subject.
    if (src) {
      played.push(src);
      elements.push(this);
    }
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

describe("useSpeechHost — a catch-up disturbs nothing the listener is on", () => {
  it("does not restart the run the user is listening to", async () => {
    const first = unitsOf(FIRST);
    const { result } = renderHook(() => useSpeechHost());

    await settle(() => result.current.onArm("cell-a"));
    await emitUtterance("cell-a", "u-1", FIRST);
    expect(played).toEqual([`blob:${first[0]}`]);
    expect(result.current.stateFor("cell-a")).toBe("speaking");

    // An `online` lands in the middle of the run. The recovered answer is not
    // the one under the cursor, so recording it against a record that holds one
    // utterance loses the live run's own — and the effect, which re-runs on
    // every arrival, then starts u-1 again from unit 0.
    await caughtUp("cell-a", "u-2", SECOND);

    expect(played).toEqual([`blob:${first[0]}`]);
    const queue = result.current.queueFor("cell-a");
    expect(queue.current?.id).toBe("u-1");
    expect(queue.pending.map((waiting) => waiting.id)).toEqual(["u-2"]);
    expect(result.current.stateFor("cell-a")).toBe("speaking");
  });

  it("leaves a cursor parked in the history where the listener put it", async () => {
    const { result } = renderHook(() => useSpeechHost());

    await emitUtterance("cell-a", "u-1", FIRST);
    await emitUtterance("cell-a", "u-2", SECOND);
    await emitUtterance("cell-a", "u-3", THIRD);
    await settle(() => result.current.onArm("cell-a"));
    played.length = 0;

    // The skim: back onto u-2, silently, which is what `onPrevious`'s own
    // record buys. A catch-up that overwrites that record undoes it.
    await settle(() => result.current.onPrevious("cell-a"));
    expect(utteranceUnderCursor(result.current.queueFor("cell-a"))?.id).toBe("u-2");
    expect(played).toEqual([]);

    await caughtUp("cell-a", "u-4", RECOVERED);

    expect(played).toEqual([]);
    const queue = result.current.queueFor("cell-a");
    expect(queue.current?.id).toBe("u-4");
    // The cursor followed its own answer down the list rather than moving.
    expect(utteranceUnderCursor(queue)?.id).toBe("u-2");
  });

  it("a recovered answer reached by the transport is still not spoken", async () => {
    const first = unitsOf(FIRST);
    const { result } = renderHook(() => useSpeechHost());

    await settle(() => result.current.onArm("cell-a"));
    await emitUtterance("cell-a", "u-1", FIRST);
    await caughtUp("cell-a", "u-2", SECOND);

    // The run plays out and the queue advances onto the recovered answer. The
    // armed cell auto-advances into a LIVE arrival — the user was there for the
    // broadcast — but a recovered one is shown and waits for the play control,
    // which is the whole of ADR 0017's audio clause.
    await endCurrentUnit();
    await endCurrentUnit();

    expect(result.current.queueFor("cell-a").current?.id).toBe("u-2");
    expect(played).toEqual([`blob:${first[0]}`, `blob:${first[1]}`]);
    expect(result.current.stateFor("cell-a")).toBe("ready");
  });
});
