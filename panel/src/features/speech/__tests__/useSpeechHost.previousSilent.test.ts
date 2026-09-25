/**
 * Stepping back is navigation, not playback.
 *
 * `onPrevious` used to move the cursor and then speak what it had moved onto,
 * which made the backward control the one transport press you could not use to
 * *look* at something. Greg's case is skimming: walk back through the answers
 * a cell is holding, read them, and hear the one that turns out to matter. A
 * press that starts audio makes that impossible — every step talks over the
 * last one, and the only way to read an older answer quietly was not to reach
 * it at all.
 *
 * So the press now moves the cursor and stops. The play control is how the
 * answer under the cursor is heard, which is exactly what it already did.
 *
 * The asymmetry with `onNext` is deliberate and is pinned here as well:
 * forward is the way *into* what is waiting and the gesture that releases the
 * pane's hold, so it is a different intent from stepping back to re-read. A
 * change that silenced both would pass every test in this file but one.
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

import {
  __resetAnswerWaitingForTests,
  holdAnswer,
  isAnswerHeld,
} from "../../terminal/answerWaiting";
import { prepare } from "../prepare";
import { useSpeechHost } from "../useSpeechHost";
import { utteranceUnderCursor } from "../utteranceQueue";

/** The `src` of every started playback, in order. A silent press adds none. */
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

/** A response of `count` units, each comfortably inside the packing window. */
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

/**
 * Three answers in one cell, none of them played: u-3 under the cursor, u-2 and
 * u-1 the two steps of history behind it. Deep enough that a press which
 * replayed `previous[0]` twice would show, rather than coincidentally agreeing
 * with a one-slot history.
 */
async function threeAnswers(sessionId: string): Promise<void> {
  await emitUtterance(sessionId, "u-1", FIRST);
  await emitUtterance(sessionId, "u-2", SECOND);
  await emitUtterance(sessionId, "u-3", THIRD);
  played.length = 0;
}

beforeEach(() => {
  synth.reset();
  played.length = 0;
  elements.length = 0;
  ws.setters.clear();
  localStorage.clear();
  __resetAnswerWaitingForTests();

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
    // `unlock()` plays a source-less element on purpose; that is not audio, and
    // this test file's whole subject is whether audio started.
    if (src) {
      played.push(src);
      elements.push(this);
    }
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

describe("useSpeechHost — stepping back navigates without playing", () => {
  it("previous moves the cursor", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    expect(result.current.queueFor("cell-a").cursor).toBe(1);
    expect(utteranceUnderCursor(result.current.queueFor("cell-a"))?.id).toBe("u-2");

    // And the second press walks the list rather than re-reading `previous[0]`.
    await settle(() => result.current.onPrevious("cell-a"));
    expect(result.current.queueFor("cell-a").cursor).toBe(2);
    expect(utteranceUnderCursor(result.current.queueFor("cell-a"))?.id).toBe("u-1");
  });

  it("previous speaks nothing", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    await settle(() => result.current.onPrevious("cell-a"));

    // Not "did not speak the wrong answer" — did not speak at all. The whole
    // point of the skim is that the backlog stays quiet while it is walked.
    expect(played).toEqual([]);
    expect(result.current.speakingSessionId).toBeNull();
  });

  it("previous speaks nothing on the ARMED cell either", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    // Arming is the state Greg actually listens in, and it is the one route by
    // which a press with no `speakUtterance` in it can still make a sound: the
    // autoplay effect watches the utterance UNDER THE CURSOR, so a backward
    // step changes what it sees and it starts that answer on its own. A
    // `onPrevious` that merely dropped its own speak call would pass every
    // other test here and still talk over the skim.
    await settle(() => result.current.onArm("cell-a"));
    played.length = 0;

    await settle(() => result.current.onPrevious("cell-a"));

    expect(result.current.queueFor("cell-a").cursor).toBe(1);
    expect(played).toEqual([]);
  });

  it("previous does not record the answer as played", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));

    // `heard` is what the unplayed count is derived from, so a silent step has
    // to leave it exactly where it was — landing on an answer is not listening
    // to it, and a skim that decremented the count would hide the very answers
    // it was looking for.
    expect([...result.current.heardFor("cell-a")]).toEqual([]);
    expect(result.current.stateFor("cell-a")).toBe("ready");
  });

  it("previous at the oldest answer moves nothing and speaks nothing", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    await settle(() => result.current.onPrevious("cell-a"));
    expect(result.current.queueFor("cell-a").cursor).toBe(2);

    // The oldest answer the cell holds: the press is refused rather than
    // falling off the front of the list, and a refused press is still silent.
    await settle(() => result.current.onPrevious("cell-a"));
    expect(result.current.queueFor("cell-a").cursor).toBe(2);
    expect(utteranceUnderCursor(result.current.queueFor("cell-a"))?.id).toBe("u-1");
    expect(played).toEqual([]);
  });

  it("play after stepping back speaks the answer under the cursor", async () => {
    const second = unitsOf(SECOND);
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    expect(played).toEqual([]);

    // The play control is the half of the skim that makes a sound, and it
    // speaks what the cursor is on — from its first unit, because stepping
    // onto a whole answer never lands in the middle of one.
    await settle(() => result.current.onSpeak("cell-a"));
    expect(played).toEqual([`blob:${second[0]}`]);
  });

  it("next still speaks", async () => {
    const second = unitsOf(SECOND);
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    await settle(() => result.current.onPrevious("cell-a"));
    await settle(() => result.current.onPrevious("cell-a"));
    expect(played).toEqual([]);

    // Deliberately asymmetric. Forward is the way into what is waiting and the
    // gesture that releases the pane's hold, so it keeps its playback: it comes
    // back onto u-2 and starts it.
    await settle(() => result.current.onNext("cell-a"));
    expect(result.current.queueFor("cell-a").cursor).toBe(1);
    expect(played).toEqual([`blob:${second[0]}`]);
  });

  it("stepping back while busy still holds the body", async () => {
    const { result } = renderHook(() => useSpeechHost());
    await threeAnswers("cell-a");

    // The hold is taken by the BAR, right before it calls `onPrevious` — it is
    // a claim on the pane's body, not on playback, so silencing the press must
    // not touch it. This is the guard against "fixed" meaning "the answer
    // flashes up and the wave takes it back".
    holdAnswer("cell-a");
    await settle(() => result.current.onPrevious("cell-a"));

    expect(isAnswerHeld("cell-a")).toBe(true);
  });
});
