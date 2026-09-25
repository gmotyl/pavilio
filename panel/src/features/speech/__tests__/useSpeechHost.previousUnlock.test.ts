/**
 * The one thing a SILENT step back still owes: the autoplay permission.
 *
 * `onPrevious` makes no sound any more (`useSpeechHost.previousSilent` is the
 * pin on that), and it would read as dead weight that it still calls
 * `unlock()`. It is not. Deleting that line leaves every other speech and
 * terminal test green, and still loses a user their next answer.
 *
 * The chain is three facts that only bite together:
 *
 * 1. the armed cell is restored from `localStorage` at mount (DECISION 12), so
 *    a reloaded tab can be ARMED while no gesture has yet reached the audio
 *    element — armed and locked at the same time, which no click can produce;
 * 2. the autoplay effect does not merely DEFER an arrival in that state, it
 *    ABSORBS it: `autoplayedRef` is set to the utterance and the cell stays
 *    quiet about it ever after. Nothing replays an absorbed answer;
 * 3. `onNewestAnswer` — the cursor coming home when an arrival releases the
 *    pane's hold — deliberately carries no `unlock` of its own, because it is
 *    not a gesture and must not start audio.
 *
 * So for a user whose only interaction was skimming the backlog, the press
 * they made is the ONLY gesture in the whole sequence, and the next answer is
 * absorbed in silence without it. The browser hands the permission out from
 * inside a gesture handler and attaches it to the element for good; spending it
 * on a press that makes no sound costs nothing, because `unlock` is guarded to
 * run once per element and that once happens on a source-less element on
 * purpose.
 *
 * This file therefore asserts the LATER arrival speaks — not that `unlock` was
 * called, which would pin the line rather than the reason for it.
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

import { preferences } from "../../../preferences/declarations";
import { storageKey } from "../../../preferences/types";
import { prepare } from "../prepare";
import { useSpeechHost } from "../useSpeechHost";

/**
 * The armed cell names a LIVE SESSION, so it is `portable: false` and lives in
 * `localStorage` — which is exactly what lets a reloaded tab come up armed
 * with no gesture behind it.
 */
const ARMED_KEY = storageKey(preferences.speechArmedCell);

/** The `src` of every started playback, in order. An absorbed arrival adds none. */
const played: string[] = [];

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

beforeEach(() => {
  synth.reset();
  played.length = 0;
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
    const src = this.getAttribute("src");
    // `unlock()` plays a source-less element on purpose; that is not audio, and
    // this file's whole subject is whether audio started.
    if (src) played.push(src);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

describe("useSpeechHost — what a silent step back still unlocks", () => {
  it("stepping back unlocks audio, so a later arrival on the armed cell still speaks", async () => {
    // The tab comes up ARMED with no gesture behind it — the state only a
    // reload can produce, and the one this whole chain lives in.
    localStorage.setItem(ARMED_KEY, '"cell-a"');

    const { result } = renderHook(() => useSpeechHost());
    expect(result.current.armedSessionId).toBe("cell-a");

    // Two answers land on the armed-but-locked cell. Both are ABSORBED, not
    // queued: the effect records each as autoplayed and moves on, so nothing
    // in the app will ever come back for them.
    await emitUtterance("cell-a", "u-1", FIRST);
    await emitUtterance("cell-a", "u-2", SECOND);
    expect(played).toEqual([]);

    // The user's first and only interaction: a step back to read the older
    // answer. It makes no sound — and the press is where the browser's
    // autoplay permission is spent.
    await settle(() => result.current.onPrevious("cell-a"));
    expect(result.current.queueFor("cell-a").cursor).toBe(1);
    expect(played).toEqual([]);

    // A third answer arrives while they are still reading. The reducer keeps
    // the cursor on the utterance they are on, so this is silent too and
    // nothing has been absorbed yet.
    await emitUtterance("cell-a", "u-3", THIRD);
    expect(played).toEqual([]);

    // The pane's hold is released by that arrival and it brings the cursor
    // home. `onNewestAnswer` carries NO unlock of its own by design, so the
    // press above is the only gesture this tab has ever made.
    await settle(() => result.current.onNewestAnswer("cell-a"));

    // ...and the answer speaks. Without the `unlock()` in `onPrevious` the
    // cell is still locked here, the effect absorbs this arrival exactly as it
    // absorbed the first two, and the user hears nothing — ever.
    expect(played).toEqual([`blob:${unitsOf(THIRD)[0]}`]);
  });
});
