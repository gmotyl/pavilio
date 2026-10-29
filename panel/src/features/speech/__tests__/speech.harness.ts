/**
 * The speech host family's shared harness: the synthesis and socket stand-ins
 * the `useSpeechHost*` suites drive the real channel and the real player
 * through, the microtask ladder they settle on, and an inert-by-default
 * `GridSpeech` for the surfaces that only consume a host.
 *
 * `vi.mock` is hoisted, so this module cannot mock for its importers. It
 * exports the FACTORIES instead, and each suite keeps the one-liners, with this
 * module imported before the subject so the factories are bound by the time
 * the mocked modules load. The arrow is load-bearing: `vi.mock` is hoisted
 * above the import, so passing `synthMock` itself reads it too early.
 *
 *   import { synthMock, useWebSocketMock } from "./speech.harness";
 *   vi.mock("../synth", () => synthMock());
 *   vi.mock("../../realtime/useWebSocket", () => useWebSocketMock());
 *
 * This module must never import `../synth` or `../../realtime/useWebSocket`
 * itself (directly or through something that does): the factories would then
 * wait on the module they are building.
 */
import { act } from "@testing-library/react";
import * as React from "react";
import { vi } from "vitest";
import { prepare } from "../prepare";
import type { GridSpeech, SpeechUnit } from "../types";
import type { SpeechHost } from "../useSpeechHost";
import { emptyUtteranceQueue } from "../utteranceQueue";
import { createTieredSynth } from "./fakeTieredSynth";

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

interface SimpleSynthOptions {
  voice?: string;
  tier?: string;
}

/**
 * The plain synthesis stand-in. It keeps a **cache** keyed exactly as
 * `synth.ts` keys it (voice + text): warming is worth nothing unless the click
 * that follows finds the audio, so a stub that re-synthesized on every call
 * would report a warmed panel as ready while every click still paid for a
 * fresh synthesis.
 */
function createSimpleSynth() {
  const buffers = new Map<string, ArrayBuffer>();
  const bufferText = new Map<ArrayBuffer, string>();
  const blobText = new Map<Blob, string>();
  const cache = new Map<string, Promise<ArrayBuffer>>();
  /** Texts whose synthesis is held open until `release`/`fail` says otherwise. */
  const holds = new Set<string>();
  const waiting = new Map<string, { release: () => void; fail: (error: unknown) => void }>();
  let requests: Array<{ text: string; voice: string | undefined; tier: string | undefined }> = [];

  function bufferFor(text: string): ArrayBuffer {
    const existing = buffers.get(text);
    if (existing) return existing;

    const buffer = new Uint8Array([text.length % 255]).buffer;
    buffers.set(text, buffer);
    bufferText.set(buffer, text);
    return buffer;
  }

  function synthesizeSpeech(text: string, options: SimpleSynthOptions = {}): Promise<ArrayBuffer> {
    const key = `${options.voice ?? ""}::${text}`;
    const cached = cache.get(key);
    if (cached) return cached;

    requests.push({ text, voice: options.voice, tier: options.tier });

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

  function finish(text: string, outcome: "release" | "fail", error?: unknown): void {
    const held = waiting.get(text);
    if (!held) throw new Error(`no synthesis is being held for ${text}`);
    waiting.delete(text);
    holds.delete(text);
    if (outcome === "release") held.release();
    else held.fail(error ?? new Error(`synthesis failed: ${text}`));
  }

  return {
    synthesizeSpeech,
    /** Exactly what the real one is: a fire-and-forget `synthesizeSpeech`. */
    prefetchSpeech: (text: string, options: SimpleSynthOptions = {}): void => {
      void synthesizeSpeech(text, options).catch(() => {});
    },
    toSpeechBlob: (buffer: ArrayBuffer): Blob => {
      const blob = new Blob([buffer], { type: "audio/mpeg" });
      blobText.set(blob, bufferText.get(buffer) ?? "unknown");
      return blob;
    },
    /** The real one's peek: cached or in flight. */
    isSpeechSynthesized: (text: string, options: SimpleSynthOptions = {}): boolean =>
      cache.has(`${options.voice ?? ""}::${text}`),
    textForBlob: (blob: Blob): string => blobText.get(blob) ?? "unknown",
    /** Holds this text's synthesis open, so "while it is warming" is observable. */
    hold: (text: string): void => {
      holds.add(text);
    },
    release: (text: string): void => finish(text, "release"),
    /** Rejects the held synthesis — with `error` when given, as anytts rejects with a `TtsError`. */
    fail: (text: string, error?: unknown): void => finish(text, "fail", error),
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
}

/** The plain stand-in — the default every suite starts each test on. */
export const synth = createSimpleSynth();

/**
 * The stand-in shaped like the anytts instance behind `../synth` (tiers,
 * per-caller abort, joined flights) — see `fakeTieredSynth.ts`. A suite about
 * tiers switches to it with `selectSynth("tiered")`.
 */
export const tieredSynth = createTieredSynth();

/**
 * What `isSpeechSynthesized` (and with it `speechCacheState`) answers:
 * `always` — nothing is ever evicted; `never` — every segment cold, so a
 * "played" segment can only come from a recorded duration; `peek` — the active
 * stand-in's own cache.
 */
export type SynthesizedAnswer = "always" | "never" | "peek";

let active: "simple" | "tiered" = "simple";
let synthesized: SynthesizedAnswer = "always";

/** Picks the stand-in `../synth` delegates to for the rest of the test. */
export function selectSynth(kind: "simple" | "tiered", answer?: SynthesizedAnswer): void {
  active = kind;
  synthesized = answer ?? (kind === "tiered" ? "peek" : "always");
}

const current = () => (active === "tiered" ? tieredSynth : synth);

function peek(text: string, options: { voice?: string } = {}): boolean {
  if (synthesized === "always") return true;
  if (synthesized === "never") return false;
  return current().isSpeechSynthesized(text, options);
}

/** The `vi.mock("../synth", …)` factory. Delegates to the active stand-in. */
export const synthMock = () => ({
  synthesizeSpeech: (text: string, options?: Parameters<typeof tieredSynth.synthesizeSpeech>[1]) =>
    current().synthesizeSpeech(text, options),
  prefetchSpeech: (text: string, options?: Parameters<typeof tieredSynth.prefetchSpeech>[1]) =>
    current().prefetchSpeech(text, options),
  toSpeechBlob: (buffer: ArrayBuffer): Blob => current().toSpeechBlob(buffer),
  isSpeechSynthesized: peek,
  speechCacheState: (text: string, options?: { voice?: string }) =>
    peek(text, options) ? "ready" : "cold",
  // A cache that never changes still has to be subscribable: the bar subscribes
  // on mount so a synthesis landing during a pause is not invisible.
  subscribeSpeechCache: () => () => {},
  SPEECH_AUDIO_MIME_TYPE: "audio/mpeg",
});

/**
 * The page audio cache's stand-ins, for `vi.mock("../pageCache", () =>
 * pageCacheMock())`. By default the cache is empty and unreachable-safe: every
 * `pageAudio` is a miss that the active synthesizer answers (so a page run
 * reads exactly as it did before the cache), the list and the prune resolve
 * with nothing, and no unit is on disk. Each is a spy, so a suite can assert
 * what the host asked for — or that an answer asked for nothing.
 */
export const pageCache = {
  pageAudio: vi.fn(
    (_docKey: string, unit: SpeechUnit, options?: Parameters<typeof tieredSynth.synthesizeSpeech>[1]) =>
      current().synthesizeSpeech(unit.text, options),
  ),
  loadPageList: vi.fn(async (_docKey: string): Promise<void> => {}),
  prunePage: vi.fn(async (_docKey: string, _units: readonly SpeechUnit[]): Promise<void> => {}),
  pageUnitState: vi.fn((_docKey: string, _unit: SpeechUnit): "warming" | "ready" | undefined => undefined),
  pageCachedShare: vi.fn((_docKey: string, _units: readonly SpeechUnit[]) => ({ cached: 0, bytes: 0 })),
  subscribePageCache: vi.fn((_listener: () => void) => () => {}),
  clearPage: vi.fn(async (_docKey: string): Promise<void> => {}),
  cacheTotals: vi.fn(async () => ({ pages: 0, units: 0, bytes: 0 })),
  wipeCache: vi.fn(async () => ({ pages: 0, units: 0, bytes: 0 })),
};

/** The `vi.mock("../pageCache", …)` factory. Delegates to {@link pageCache}. */
export const pageCacheMock = () => ({
  pageAudio: (...args: Parameters<typeof pageCache.pageAudio>) => pageCache.pageAudio(...args),
  loadPageList: (...args: Parameters<typeof pageCache.loadPageList>) => pageCache.loadPageList(...args),
  prunePage: (...args: Parameters<typeof pageCache.prunePage>) => pageCache.prunePage(...args),
  pageUnitState: (...args: Parameters<typeof pageCache.pageUnitState>) => pageCache.pageUnitState(...args),
  pageCachedShare: (...args: Parameters<typeof pageCache.pageCachedShare>) =>
    pageCache.pageCachedShare(...args),
  subscribePageCache: (...args: Parameters<typeof pageCache.subscribePageCache>) =>
    pageCache.subscribePageCache(...args),
  clearPage: (...args: Parameters<typeof pageCache.clearPage>) => pageCache.clearPage(...args),
  cacheTotals: () => pageCache.cacheTotals(),
  wipeCache: () => pageCache.wipeCache(),
});

/** Every page cache call any test made, so "never touched" is one assertion. */
export const pageCacheCalls = (): number =>
  Object.values(pageCache).reduce((sum, spy) => sum + spy.mock.calls.length, 0);

/** The texts that reached the active synthesizer, in order. */
export const requestedTexts = (): string[] => current().requests.map((request) => request.text);
export const timesRequested = (text: string): number =>
  requestedTexts().filter((requested) => requested === text).length;

// ---------------------------------------------------------------------------
// Socket
// ---------------------------------------------------------------------------

/**
 * A state-backed socket stand-in: `emit` pushes a frame into every mounted
 * `useWebSocket`, so an arrival is a real React state update rather than a
 * module variable plus a manual rerender.
 */
export const ws = {
  setters: new Set<(message: Record<string, unknown> | null) => void>(),
  emit(message: Record<string, unknown>): void {
    for (const set of ws.setters) set(message);
  },
};

/** The `vi.mock("../../realtime/useWebSocket", …)` factory. */
export const useWebSocketMock = () => ({
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
});

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------

/**
 * Drains the microtask ladder the host and player run on — synthesis resolves,
 * the object URL is built, the next unit's load starts — without a real-timer
 * sleep. Bounded, so a step that never happens fails an assertion instead of
 * hanging the suite.
 */
export async function drain(): Promise<void> {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
}

/** Runs a host (or player) callback and lets everything it started settle. */
export async function settle(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await drain();
  });
}

/** Broadcasts one `speech-utterance` frame and lets the host react to it. */
export async function emitUtterance(
  sessionId: string,
  id: string,
  text: string,
  at: number = Date.now(),
): Promise<void> {
  await act(async () => {
    ws.emit({ type: "speech-utterance", id, sessionId, text, at });
    await drain();
  });
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** The `src` of every started playback, in order. Warming must never add one. */
export const played: string[] = [];
/** The element each playback was started on, so a unit's `ended` can be fired. */
export const elements: HTMLMediaElement[] = [];
/** One entry per `unlock()` — a play on the source-less element. */
export const unlocks: number[] = [];

/** Ends the unit that is currently playing, as the browser's `ended` would. */
export async function endCurrentUnit(): Promise<void> {
  const element = elements[elements.length - 1];
  if (!element) throw new Error("nothing is playing");
  await act(async () => {
    element.dispatchEvent(new Event("ended"));
    await drain();
  });
}

/** Ends every unit of the run that is playing, up to a bound. */
export async function endRun(max = 40): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    if (!played.length) return;
    const before = played.length;
    await endCurrentUnit();
    if (played.length === before) return;
  }
}

/**
 * The per-test reset for a host suite: both stand-ins emptied and the plain one
 * active, no socket subscribers, nothing played, an empty `/latest`, object
 * URLs that name their text, and an element whose `play` records its `src`.
 */
export function resetSpeechHarness(): void {
  synth.reset();
  tieredSynth.reset();
  selectSynth("simple");
  played.length = 0;
  elements.length = 0;
  unlocks.length = 0;
  ws.setters.clear();
  localStorage.clear();
  // Back to each spy's default: an empty cache whose every unit is a miss.
  for (const spy of Object.values(pageCache)) spy.mockReset();

  global.fetch = vi.fn(
    async () => ({ ok: true, json: async () => ({ utterances: [] }) }) as Response,
  ) as unknown as typeof fetch;

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) =>
      `blob:${active === "tiered" ? tieredSynth.textForBlob(blob) : synth.textForBlob(blob)}`,
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
    // `unlock()` plays a source-less element on purpose; that is not audio, so
    // it is counted apart rather than ignored.
    if (src) {
      played.push(src);
      elements.push(this);
    } else {
      unlocks.push(1);
    }
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/**
 * A response of `count` units: every paragraph is one sentence over the
 * 200-char packing floor and under the 450-char ceiling, so it is neither
 * merged with its neighbour nor cut in half.
 */
export function response(count: number, word = "Paragraph"): string {
  return Array.from({ length: count }, (_, i) => {
    const head = `${word} ${String(i).padStart(2, "0")} `;
    return head + "x".repeat(238 - head.length) + ".";
  }).join("\n\n");
}

/** What `prepare` will make of a response — the texts synthesis will be asked for. */
export const unitsOf = (text: string): string[] =>
  prepare(text, { language: "en" }).units.map((unit) => unit.text);

// ---------------------------------------------------------------------------
// A host for consumers
// ---------------------------------------------------------------------------

/** Snapshots read through `useSyncExternalStore` must be referentially stable
 *  between notifications, so the "nothing here" ones are shared constants. */
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();

/**
 * A host for the surfaces that consume one: every reading empty, every action a
 * `vi.fn()` a test can assert on. A suite that needs a live reading passes it
 * in `overrides`; it does not redefine the helper. Typed as a `SpeechHost`, so
 * it serves both the grid (`GridSpeech`) and a mocked `useSpeechHost`.
 */
export function makeSpeech(overrides: Partial<SpeechHost> = {}): SpeechHost {
  const host: SpeechHost = {
    stateFor: () => "empty",
    queueFor: () => emptyUtteranceQueue,
    heardFor: () => NOTHING_HEARD,
    unitsFor: () => NO_UNITS,
    subscribeProgress: () => () => {},
    progressFor: () => null,
    unitDurationsFor: () => NO_DURATIONS,
    speechModeOf: () => "off",
    onSpeak: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onNewestAnswer: vi.fn(),
    cycleSpeechMode: vi.fn(),
    onJumpToUnit: vi.fn(),
    onSeekWithinUnit: vi.fn(),
    speakingSessionId: null,
    pausedSessionId: null,
    autoplaySessionIds: [],
    oldestUnheardArrival: () => null,
    lastSpokenSessionId: null,
    onSeekBackward: vi.fn(),
    preparingSessionIds: new Set<string>(),
    speakDocument: vi.fn(),
    stopDocument: vi.fn(),
  };
  return { ...host, ...overrides } satisfies GridSpeech;
}
