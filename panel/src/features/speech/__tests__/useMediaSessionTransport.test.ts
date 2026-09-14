/**
 * The OS transport — hardware media keys, the lock screen, the notification
 * shade — driving the panel's one playback.
 *
 * Two halves, deliberately.
 *
 * The first mounts the hook against a **stub target** and asserts the wiring:
 * which actions are bound, what each one calls, and that `playbackState`
 * follows the run. The stub is a spy bag, so these are cheap and exact.
 *
 * The second mounts the hook against the **real `useSpeechHost`** for the one
 * criterion a stub cannot honestly pin: *pause acts on the speaking cell, not
 * the focused one*. "Focused" is not an input this hook has — that is the whole
 * design — so asserting it against a stub would be asserting that a parameter
 * the hook never receives was not used. Against the real host, with a real
 * focused element and a real second cell holding a real unheard utterance, the
 * claim has something to be false about.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

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

import type { MediaSessionTransportTarget } from "../useMediaSessionTransport";
import { useMediaSessionTransport, TRANSPORT_SEEK_SECONDS } from "../useMediaSessionTransport";
import { useSpeechHost } from "../useSpeechHost";

/**
 * The stand-in for `navigator.mediaSession`, which jsdom does not implement.
 *
 * Deliberately dumb: it records handlers under whatever action name it is
 * given and holds `playbackState` as a plain writable property. It cannot
 * vouch for an action name — a real browser throws `NotSupportedError` on one
 * it does not know, and this does not — so {@link fire} refuses to invoke an
 * action nothing was bound for, and the binding test asserts the exact set of
 * names. A typo'd `"seekBackward"` would therefore fail twice over rather than
 * pass vacuously.
 */
interface FakeMediaSession {
  playbackState: MediaSessionPlaybackState;
  setActionHandler: (action: MediaSessionAction, handler: (() => void) | null) => void;
}

let handlers = new Map<string, (() => void) | null>();

function installMediaSession(): FakeMediaSession {
  handlers = new Map();
  const session: FakeMediaSession = {
    playbackState: "none",
    setActionHandler(action, handler) {
      handlers.set(action, handler);
    },
  };
  Object.defineProperty(navigator, "mediaSession", { configurable: true, value: session });
  return session;
}

/**
 * A browser that knows only *some* of the five actions.
 *
 * Real ones behave this way: `setActionHandler` throws `NotSupportedError` for
 * an action the engine has no transport button for, rather than quietly
 * ignoring it. The one shape that matters is the asymmetry — `play` and
 * `pause` are universal, the other three are not.
 */
function installPartialMediaSession(supported: readonly MediaSessionAction[]): FakeMediaSession {
  handlers = new Map();
  const session: FakeMediaSession = {
    playbackState: "none",
    setActionHandler(action, handler) {
      if (!supported.includes(action)) {
        throw new DOMException(`unsupported action: ${action}`, "NotSupportedError");
      }
      handlers.set(action, handler);
    },
  };
  Object.defineProperty(navigator, "mediaSession", { configurable: true, value: session });
  return session;
}

/** A browser — or a non-secure context — with no Media Session API at all. */
function removeMediaSession(): void {
  Object.defineProperty(navigator, "mediaSession", { configurable: true, value: undefined });
}

/** What the OS does when a media key is pressed. */
function fire(action: MediaSessionAction): void {
  const handler = handlers.get(action);
  if (!handler) throw new Error(`no handler is bound for the "${action}" action`);
  handler();
}

const boundActions = (): string[] =>
  [...handlers.entries()]
    .filter(([, handler]) => handler !== null)
    .map(([action]) => action)
    .sort();

/**
 * A target whose callbacks are spies — typed as spies, so `toHaveBeenCalledWith`
 * is checked against each one's real signature rather than against `any[]`.
 */
interface StubTarget extends MediaSessionTransportTarget {
  onSpeak: Mock<(sessionId: string) => void>;
  onPause: Mock<(sessionId: string) => void>;
  onResume: Mock<(sessionId: string) => void>;
  onNext: Mock<(sessionId: string) => void>;
  onPrevious: Mock<(sessionId: string) => void>;
  onSeekBackward: Mock<(seconds: number) => void>;
}

function stubTarget(
  run: {
    speakingSessionId?: string | null;
    pausedSessionId?: string | null;
    armedSessionId?: string | null;
  } = {},
): StubTarget {
  return {
    speakingSessionId: run.speakingSessionId ?? null,
    pausedSessionId: run.pausedSessionId ?? null,
    armedSessionId: run.armedSessionId ?? null,
    onSpeak: vi.fn<(sessionId: string) => void>(),
    onPause: vi.fn<(sessionId: string) => void>(),
    onResume: vi.fn<(sessionId: string) => void>(),
    onNext: vi.fn<(sessionId: string) => void>(),
    onPrevious: vi.fn<(sessionId: string) => void>(),
    onSeekBackward: vi.fn<(seconds: number) => void>(),
  };
}

describe("useMediaSessionTransport", () => {
  let session: FakeMediaSession;

  beforeEach(() => {
    session = installMediaSession();
  });

  afterEach(() => {
    removeMediaSession();
  });

  it("binds all five action handlers on mount", () => {
    const target = stubTarget({ speakingSessionId: "cell-a" });
    const { unmount } = renderHook(() => useMediaSessionTransport(target));

    expect(boundActions()).toEqual([
      "nexttrack",
      "pause",
      "play",
      "previoustrack",
      "seekbackward",
    ]);
    expect(session.playbackState).toBe("playing");

    // And releases them: the handlers are document-global state, so a host that
    // unmounts while leaving them bound keeps the OS talking to a dead closure.
    unmount();
    expect(boundActions()).toEqual([]);
    // `playbackState` is that same document-global state and has to go with
    // them. Left on "playing", the OS goes on offering a pause button for a
    // playback nothing is driving, and the next host to mount inherits a
    // document that claims the panel is already talking.
    expect(session.playbackState).toBe("none");
  });

  it("playbackState tracks the run", () => {
    const { rerender } = renderHook(({ target }) => useMediaSessionTransport(target), {
      initialProps: { target: stubTarget() },
    });

    expect(session.playbackState).toBe("none");

    rerender({ target: stubTarget({ speakingSessionId: "cell-a" }) });
    expect(session.playbackState).toBe("playing");

    // A paused run is STILL the player's speaking session — it suspends the
    // element rather than ending the ladder — so "paused" has to outrank
    // "playing" here exactly as it does in the cell's own state.
    rerender({ target: stubTarget({ speakingSessionId: "cell-a", pausedSessionId: "cell-a" }) });
    expect(session.playbackState).toBe("paused");

    rerender({ target: stubTarget() });
    expect(session.playbackState).toBe("none");
  });

  it("play with nothing active starts the armed cell", () => {
    const target = stubTarget({ armedSessionId: "cell-b" });
    renderHook(() => useMediaSessionTransport(target));

    fire("play");

    expect(target.onSpeak).toHaveBeenCalledWith("cell-b");
    expect(target.onResume).not.toHaveBeenCalled();
  });

  it("play resumes a held run rather than restarting the armed cell", () => {
    const target = stubTarget({
      speakingSessionId: "cell-a",
      pausedSessionId: "cell-a",
      armedSessionId: "cell-b",
    });
    renderHook(() => useMediaSessionTransport(target));

    fire("play");

    expect(target.onResume).toHaveBeenCalledWith("cell-a");
    expect(target.onSpeak).not.toHaveBeenCalled();
  });

  it("next and previous walk the playing cell's queue", () => {
    // The armed cell is a different one on purpose: the run wins.
    const target = stubTarget({ speakingSessionId: "cell-a", armedSessionId: "cell-b" });
    renderHook(() => useMediaSessionTransport(target));

    fire("nexttrack");
    fire("previoustrack");

    expect(target.onNext).toHaveBeenCalledWith("cell-a");
    expect(target.onPrevious).toHaveBeenCalledWith("cell-a");
    expect(target.onNext).not.toHaveBeenCalledWith("cell-b");
    expect(target.onPrevious).not.toHaveBeenCalledWith("cell-b");
  });

  it("next and previous fall back to the armed cell with nothing playing", () => {
    const target = stubTarget({ armedSessionId: "cell-b" });
    renderHook(() => useMediaSessionTransport(target));

    fire("nexttrack");

    expect(target.onNext).toHaveBeenCalledWith("cell-b");
  });

  it("seekbackward moves back ten seconds", () => {
    const target = stubTarget({ speakingSessionId: "cell-a" });
    renderHook(() => useMediaSessionTransport(target));

    fire("seekbackward");

    expect(TRANSPORT_SEEK_SECONDS).toBe(10);
    expect(target.onSeekBackward).toHaveBeenCalledWith(10);
  });

  it("reads the target as it is when the key is pressed, not as it was at mount", () => {
    // The handlers are bound once, so they must not close over the first
    // render's target — the run they are meant to act on had not started yet.
    const { rerender } = renderHook(({ target }) => useMediaSessionTransport(target), {
      initialProps: { target: stubTarget() },
    });

    const playing = stubTarget({ speakingSessionId: "cell-a" });
    rerender({ target: playing });
    fire("pause");

    expect(playing.onPause).toHaveBeenCalledWith("cell-a");

    // `pause` reads the ref inline, but `transportTarget()` — behind next,
    // previous and nothing else — holds a second read of its own. Pinning one
    // says nothing about the other, and a `transportTarget` closed over the
    // mount-time target would answer `null` here while every other test in
    // this file stayed green.
    fire("nexttrack");

    expect(playing.onNext).toHaveBeenCalledWith("cell-a");
  });

  it("keeps the actions a browser does support when it rejects the others", () => {
    // Chromium binds all five. Others throw `NotSupportedError` for the ones
    // they have no transport button for — and an exception out of the binding
    // effect is not a lost media key, it is the render throwing and taking the
    // whole `SpeechHostProvider` down. The try/catch is the difference between
    // "seekbackward does nothing here" and "this browser has no speech host".
    const partial = installPartialMediaSession(["play", "pause"]);
    const target = stubTarget({
      speakingSessionId: "cell-a",
      pausedSessionId: "cell-a",
      armedSessionId: "cell-b",
    });

    const { unmount } = renderHook(() => useMediaSessionTransport(target));

    // The three it refused are simply absent; the two it knows are bound.
    expect(boundActions()).toEqual(["pause", "play"]);
    expect(partial.playbackState).toBe("paused");

    // And they are live, not merely present: a handler that survived the throw
    // but closed over nothing would satisfy the assertion above.
    fire("pause");
    fire("play");

    expect(target.onPause).toHaveBeenCalledWith("cell-a");
    expect(target.onResume).toHaveBeenCalledWith("cell-a");

    // Teardown re-enters the same throwing setter, once per action, and must
    // not escape there either — an unmount that throws is a React error
    // boundary away from the same outage.
    expect(() => unmount()).not.toThrow();
    expect(boundActions()).toEqual([]);
    expect(partial.playbackState).toBe("none");
  });

  it("is inert where mediaSession is unavailable", () => {
    removeMediaSession();
    const target = stubTarget({ speakingSessionId: "cell-a" });

    const { unmount } = renderHook(() => useMediaSessionTransport(target));

    // Nothing bound, nothing thrown, nothing called — and the teardown that
    // clears the handlers must not reach for the missing object either.
    expect(boundActions()).toEqual([]);
    expect(() => unmount()).not.toThrow();
    expect(target.onPause).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ */
/* The real host                                                             */
/* ------------------------------------------------------------------------ */

const elements: HTMLMediaElement[] = [];
/** The `src` of every unit the player actually started, in order. */
const played: string[] = [];
/** The `src` of every unit the player suspended, in order. */
const pausedSrcs: string[] = [];

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

/** A response of `count` units, each comfortably inside the packing window. */
function response(count: number): string {
  return Array.from({ length: count }, (_, i) => {
    const head = `Paragraph ${String(i).padStart(2, "0")} `;
    return head + "x".repeat(238 - head.length) + ".";
  }).join("\n\n");
}

describe("the transport acts on the playback, never on the focused cell", () => {
  let session: FakeMediaSession;

  beforeEach(() => {
    synth.reset();
    elements.length = 0;
    played.length = 0;
    pausedSrcs.length = 0;
    ws.setters.clear();
    localStorage.clear();
    document.body.innerHTML = "";
    session = installMediaSession();

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
      // The unlock trick plays a source-less element on purpose; it is not a
      // unit starting, so it does not belong in the playback order.
      if (src) {
        elements.push(this);
        played.push(src);
      }
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      const src = this.getAttribute("src");
      // The unlock trick pauses the source-less element it just played, for the
      // same reason the play spy skips it: neither is a unit.
      if (src) pausedSrcs.push(src);
    });
  });

  // The media-element spies are deliberately NOT restored between tests here.
  // The player's unlock defers a `pause()` onto the element, and restoring the
  // prototype out from under it lands that call on jsdom's unimplemented one —
  // console noise from a behaviour that is not under test. `useSpeechHost`'s
  // own suites leave them installed for the same reason; each test file gets a
  // fresh module registry, so nothing escapes this one.
  afterEach(() => {
    removeMediaSession();
  });

  it("pause acts on the speaking cell, not the focused one", async () => {
    const { result } = renderHook(() => {
      const host = useSpeechHost();
      useMediaSessionTransport(host);
      return host;
    });

    // Two cells, each holding an unheard answer. Cell B is the armed one, so if
    // the transport were reading anything but the run it would have somewhere
    // plausible to go wrong.
    await emitUtterance("cell-a", "u-a", response(3));
    await emitUtterance("cell-b", "u-b", response(3));
    await settle(() => result.current.onArm("cell-b"));

    await settle(() => result.current.onSpeak("cell-a"));

    expect(result.current.stateFor("cell-a")).toBe("speaking");
    expect(session.playbackState).toBe("playing");
    expect(played).toEqual(["blob:Paragraph 00 " + "x".repeat(238 - 13) + "."]);
    const playedBefore = [...played];

    // The user clicks into cell B while cell A is still talking. Focus is real:
    // it is the document's, which is the only "focused cell" the browser has.
    const cellB = document.createElement("button");
    cellB.setAttribute("data-testid", "cell-b");
    document.body.append(cellB);
    cellB.focus();
    expect(document.activeElement).toBe(cellB);

    await settle(() => fire("pause"));

    // A is held…
    expect(pausedSrcs).toEqual(playedBefore);
    expect(result.current.stateFor("cell-a")).toBe("paused");
    expect(session.playbackState).toBe("paused");
    // …and B, focused and armed and holding an answer nobody has heard, did not
    // make a sound. Nothing new was started at all.
    expect(played).toEqual(playedBefore);
    expect(result.current.stateFor("cell-b")).toBe("ready");

    // And the play that follows goes back to A, for the same reason.
    await settle(() => fire("play"));

    expect(result.current.stateFor("cell-a")).toBe("speaking");
    expect(result.current.stateFor("cell-b")).toBe("ready");
    expect(session.playbackState).toBe("playing");
  });
});
