import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Per-cell speech modes: `off → armed → autoplay → off`, one entry per
 * session, persisted per browser. The channel is rendered for real; its live
 * inputs — the socket and the realtime subscription — are stubbed the way
 * `useUtteranceChannel.test.ts` stubs them, so nothing here opens a socket.
 */
vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));
vi.mock("../../realtime/channel", async () => {
  const actual =
    await vi.importActual<typeof import("../../realtime/channel")>("../../realtime/channel");
  return { ...actual, subscribeRealtime: () => () => {} };
});

const { useUtteranceChannel } = await import("../useUtteranceChannel");
const { nextSpeechMode } = await import("../voices");
const { preferences } = await import("../../../preferences/declarations");
const { storageKey } = await import("../../../preferences/types");
const { __resetPreferenceStoreForTests } = await import("../../../preferences/store");

const MODES_KEY = storageKey(preferences.speechModes);
const LEGACY_KEY = storageKey(preferences.speechArmedCell);

const options = () => ({
  speakingSessionId: null,
  pausedSessionId: null,
  waitingForSynthesis: false,
  preparingSessionIds: new Set<string>(),
  recordAutoplayed: () => {},
});

async function renderChannel() {
  const rendered = renderHook(() => useUtteranceChannel(options()));
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
}

beforeEach(() => {
  global.fetch = vi.fn(
    async () => ({ ok: true, json: async () => ({ utterances: [] }) }) as Response,
  ) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("speech modes", () => {
  it("nextSpeechMode cycles off, armed, autoplay, off", () => {
    expect(nextSpeechMode("off")).toBe("armed");
    expect(nextSpeechMode("armed")).toBe("autoplay");
    expect(nextSpeechMode("autoplay")).toBe("off");
  });

  it("cycling a session three times goes armed, autoplay, off", async () => {
    const { result } = await renderChannel();
    const seen: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        result.current.cycleSpeechMode("cell-a");
      });
      seen.push(result.current.speechModeOf("cell-a"));
    }
    expect(seen).toEqual(["armed", "autoplay", "off"]);
  });

  it("two sessions can both be in autoplay", async () => {
    const { result } = await renderChannel();
    for (const id of ["cell-a", "cell-b"]) {
      await act(async () => {
        result.current.cycleSpeechMode(id);
        result.current.cycleSpeechMode(id);
      });
    }
    expect(result.current.speechModeOf("cell-a")).toBe("autoplay");
    expect(result.current.speechModeOf("cell-b")).toBe("autoplay");
    expect(result.current.autoplaySessionIds).toEqual(["cell-a", "cell-b"]);
  });

  it("speech modes survive a reload", async () => {
    const { result, unmount } = await renderChannel();
    await act(async () => {
      result.current.cycleSpeechMode("cell-a");
      result.current.cycleSpeechMode("cell-b");
      result.current.cycleSpeechMode("cell-b");
    });
    unmount();
    __resetPreferenceStoreForTests();

    const { result: reloaded } = await renderChannel();
    expect(reloaded.current.speechModeOf("cell-a")).toBe("armed");
    expect(reloaded.current.speechModeOf("cell-b")).toBe("autoplay");
    // Machine-local, like the armed id it replaces: a record of LIVE session ids.
    expect(JSON.parse(localStorage.getItem(MODES_KEY) ?? "null")).toEqual({
      "cell-a": "armed",
      "cell-b": "autoplay",
    });
  });

  it("a legacy armed session restores as autoplay", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify("cell-old"));
    const { result, unmount } = await renderChannel();
    expect(result.current.speechModeOf("cell-old")).toBe("autoplay");

    // The first write moves the record onto the new key; from then on the
    // legacy value is never consulted, even if something writes it again.
    await act(async () => {
      result.current.cycleSpeechMode("cell-new");
    });
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    localStorage.setItem(LEGACY_KEY, JSON.stringify("cell-stale"));
    unmount();
    __resetPreferenceStoreForTests();

    const { result: reloaded } = await renderChannel();
    expect(reloaded.current.speechModeOf("cell-old")).toBe("autoplay");
    expect(reloaded.current.speechModeOf("cell-new")).toBe("armed");
    expect(reloaded.current.speechModeOf("cell-stale")).toBe("off");
  });

  it("cycling to off deletes the stored entry", async () => {
    const { result } = await renderChannel();
    await act(async () => {
      result.current.cycleSpeechMode("cell-a");
      result.current.cycleSpeechMode("cell-b");
    });
    await act(async () => {
      result.current.cycleSpeechMode("cell-a");
      result.current.cycleSpeechMode("cell-a");
    });
    const stored = JSON.parse(localStorage.getItem(MODES_KEY) ?? "null") as Record<string, string>;
    expect(stored).toEqual({ "cell-b": "armed" });
    expect(Object.hasOwn(stored, "cell-a")).toBe(false);
  });

  it("an unknown session is off", async () => {
    const { result } = await renderChannel();
    expect(result.current.speechModeOf("cell-never")).toBe("off");
  });
});
