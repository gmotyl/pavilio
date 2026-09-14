/**
 * Jumping to a unit, seen from the host.
 *
 * `SpeechPlayer.jumpToUnit` is deliberately a **no-op for a cell that has never
 * spoken in this tab**: the player learns a session's units from `play`, and
 * nothing else ever teaches it. That is correct for the player and useless for
 * the scrubber, whose segments exist from the moment an utterance ARRIVES —
 * before any click, and therefore before the player has ever heard of the cell.
 * A segment that silently does nothing is the worst outcome there is, so the
 * host routes a jump through its own speak path, which knows the utterance, its
 * prepared units and the run bookkeeping. These two tests are what keep it
 * there.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const synth = vi.hoisted(() => {
  const buffers = new Map<string, ArrayBuffer>();
  const bufferText = new Map<ArrayBuffer, string>();
  const blobText = new Map<Blob, string>();
  const cache = new Map<string, Promise<ArrayBuffer>>();
  let requests: string[] = [];

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
    requests.push(text);
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
    get requests() {
      return requests;
    },
    reset: (): void => {
      requests = [];
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

import { prepare } from "../prepare";
import { useSpeechHost } from "../useSpeechHost";

/** The `src` of every started playback, in order. */
const played: string[] = [];
const elements: HTMLMediaElement[] = [];

async function drain(): Promise<void> {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
}

async function emitUtterance(sessionId: string, id: string, text: string): Promise<void> {
  await act(async () => {
    ws.emit({ type: "speech-utterance", id, sessionId, text, at: Date.now() });
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

/** A response of `count` units, each comfortably inside the packing window. */
function response(count: number): string {
  return Array.from({ length: count }, (_, i) => {
    const head = `Paragraph ${String(i).padStart(2, "0")} `;
    return head + "x".repeat(238 - head.length) + ".";
  }).join("\n\n");
}

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
    if (src) {
      played.push(src);
      elements.push(this);
    }
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

describe("useSpeechHost jumps", () => {
  it("a segment click on a cell that has never spoken starts it at that unit", async () => {
    const units = unitsOf(response(4));
    const { result } = renderHook(() => useSpeechHost());

    // Arrived and warmed, never played: `player.jumpToUnit` would return here
    // without a sound, because `unitsRef` only ever learns from `play`.
    await emitUtterance("cell-a", "u-1", response(4));
    expect(played).toEqual([]);

    await settle(() => result.current.onJumpToUnit("cell-a", 2));

    expect(played).toEqual([`blob:${units[2]}`]);
  });

  it("jumping inside a live run does not mark the cell heard", async () => {
    const units = unitsOf(response(4));
    const { result } = renderHook(() => useSpeechHost());

    await emitUtterance("cell-a", "u-1", response(4));
    await settle(() => result.current.onSpeak("cell-a"));
    expect(played).toEqual([`blob:${units[0]}`]);

    // The run the jump supersedes never reached its last unit, so the cell must
    // not land on `heard` — the trap `speakUtterance`'s stamp exists to avoid.
    await settle(() => result.current.onJumpToUnit("cell-a", 3));
    expect(played[played.length - 1]).toBe(`blob:${units[3]}`);

    // Asserted only once the cell has LEFT `speaking`. `stateFor` ranks a live
    // run above the heard flag, so a bar routed straight at `player.jumpToUnit`
    // — which reaches `play` behind the host's back, leaves the superseded run
    // stamped `pending` and therefore marks the cell HEARD — still reads
    // `speaking` at this point and passes anyway. Stopping takes the mask off:
    // a deliberate stop is `ready`, so anything else here is a stamp that
    // should never have been made.
    await settle(() => result.current.onStop("cell-a"));
    expect(result.current.stateFor("cell-a")).toBe("ready");

    // And the run a jump starts is a real one: its last unit ending is what
    // marks the cell heard.
    await settle(() => result.current.onJumpToUnit("cell-a", 3));
    await endCurrentUnit();
    expect(result.current.stateFor("cell-a")).toBe("heard");
  });
});
