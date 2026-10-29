import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { makeSpeech, resetSpeechHarness, selectSynth, synth, synthMock } from "./speech.harness";
import type { AnswerWaitingPort, SpeechHost } from "../useSpeechHost";
import type { SpeechUnit } from "../types";
import { DEFAULT_SPEECH_VOICE, setProjectVoice } from "../voices";
import { __resetAlertsForTests, getAlertsSnapshot } from "../../alerts/store";

/**
 * The host is stubbed, NOT `usePanelSpeech`: the bar is required to read the
 * panel's one host, and mocking the hook would delete the provider's throw.
 * So the real `SpeechHostProvider` is mounted and only the host it publishes
 * is swapped; the two document-wide hooks it runs are stubbed out.
 */
const stub = vi.hoisted(() => ({ host: null as SpeechHost | null }));

/**
 * The page cache the bar reads its share from, made writable: `share` is what
 * `pageCachedShare` answers for any key, `changed()` is the module announcing
 * an upload landed. Everything else in `pageCache` stays real, so the segment
 * states keep reading it as they do in production.
 */
const cache = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    share: { cached: 0, bytes: 0 },
    listeners,
    changed: () => {
      for (const listener of [...listeners]) listener();
    },
    clearPage: null as unknown as import("vitest").Mock<(docKey: string) => Promise<void>>,
    loadPageList: null as unknown as import("vitest").Mock<(docKey: string) => Promise<void>>,
  };
});

vi.mock("../pageCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pageCache")>();
  cache.clearPage = vi.fn(async (_docKey: string) => {});
  cache.loadPageList = vi.fn(async (_docKey: string) => {});
  return {
    ...actual,
    loadPageList: (docKey: string) => cache.loadPageList(docKey),
    pageCachedShare: () => cache.share,
    clearPage: (docKey: string) => cache.clearPage(docKey),
    subscribePageCache: (listener: () => void) => {
      cache.listeners.add(listener);
      const unsubscribe = actual.subscribePageCache(listener);
      return () => {
        cache.listeners.delete(listener);
        unsubscribe();
      };
    },
  };
});

vi.mock("../synth", () => synthMock());
vi.mock("../useSpeechHost", () => {
  const useSpeechHost = () => stub.host;
  return { useSpeechHost, default: useSpeechHost };
});
vi.mock("../useMediaSessionTransport", () => ({ useMediaSessionTransport: () => {} }));
vi.mock("../useSpeechKeys", () => ({ useSpeechKeys: () => {} }));

import { SpeechHostProvider, usePageSpeech } from "../SpeechHostProvider";
import { DocumentSpeechBar } from "../DocumentSpeechBar";
import { SpeechControlBar } from "../../terminal/SpeechControlBar";

const KEY = "doc:pavilio/wiki/page.md";

const answerWaiting: AnswerWaitingPort = {
  get: () => ({ waiting: false, pending: false }),
  hold: () => {},
  release: () => {},
  noteTransport: () => {},
  isHeld: () => false,
};

function Host({ children }: { children: ReactNode }) {
  return (
    <SpeechHostProvider
      sessionOf={() => undefined}
      isSessionOpen={() => false}
      focusedCell={{ read: () => null, readStandalone: () => null, subscribe: () => () => {} }}
      drawerVisible={false}
      onArrival={() => {}}
      answerWaiting={answerWaiting}
      voiceFor={() => "a-voice"}
    >
      {children}
    </SpeechHostProvider>
  );
}

const unitList = (count: number): SpeechUnit[] =>
  Array.from({ length: count }, (_, i) => {
    const text = `Paragraph ${i + 1}.`;
    return { text, chars: text.length, source: text } as SpeechUnit;
  });

/** Read through `useSyncExternalStore`, so it must be one object, not one per call. */
const PLAYING_FIRST = { unitIndex: 0, unitTime: 0, unitDuration: 2 };

function renderBar(overrides: Partial<SpeechHost>) {
  stub.host = makeSpeech(overrides);
  return render(
    <Host>
      <DocumentSpeechBar docKey={KEY} />
    </Host>,
  );
}

afterEach(() => {
  stub.host = null;
  cache.share = { cached: 0, bytes: 0 };
  cache.clearPage.mockReset();
  cache.clearPage.mockImplementation(async () => {});
  cache.loadPageList.mockReset();
  cache.loadPageList.mockImplementation(async () => {});
  __resetAlertsForTests();
  resetSpeechHarness();
});

const clearButton = () => screen.queryByTestId(`speech-bar-clear-cache-${KEY}`);
const cachedLabel = () => screen.queryByTestId(`speech-bar-cached-${KEY}`);

describe("DocumentSpeechBar", () => {
  it("renders only play/pause and the scrubber", () => {
    renderBar({ stateFor: () => "ready", unitsFor: () => unitList(3) });

    const bar = screen.getByTestId(`document-speech-bar-${KEY}`);
    expect(screen.getByTestId(`speech-bar-playpause-${KEY}`)).toBeTruthy();
    expect(screen.getByTestId(`speech-bar-scrubber-${KEY}`)).toBeTruthy();
    expect(bar.querySelectorAll("[data-testid^='speech-bar-segment-']")).toHaveLength(3);

    // The one button is play/pause: no mode switch, previous/next, eye button,
    // launchers or hide toggle.
    expect(bar.querySelectorAll("button")).toHaveLength(1);
    expect(screen.queryByTestId(`speech-bar-autoplay-${KEY}`)).toBeNull();
    expect(screen.queryByTestId(`speech-bar-previous-${KEY}`)).toBeNull();
    expect(screen.queryByTestId(`speech-bar-next-${KEY}`)).toBeNull();
    expect(screen.queryByTestId(`speech-bar-eye-${KEY}`)).toBeNull();
    expect(screen.queryByTestId(`speech-bar-launchers-${KEY}`)).toBeNull();
  });

  it("shows preparing until the first unit is ready", () => {
    let state: "preparing" | "ready" = "preparing";
    const { rerender } = renderBar({ stateFor: () => state, unitsFor: () => unitList(2) });

    const play = () => screen.getByTestId(`speech-bar-playpause-${KEY}`);
    expect(play().getAttribute("data-speech")).toBe("preparing");
    expect(play().getAttribute("aria-label")).toBe("Preparing the audio…");
    expect(play().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(play());
    expect(stub.host?.onSpeak).not.toHaveBeenCalled();

    state = "ready";
    stub.host = { ...stub.host!, stateFor: () => state };
    rerender(
      <Host>
        <DocumentSpeechBar docKey={KEY} />
      </Host>,
    );
    expect(play().getAttribute("data-speech")).toBe("ready");
    expect(play().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(play());
    expect(stub.host?.onSpeak).toHaveBeenCalledWith(KEY);
  });

  it("segment click jumps to that unit", () => {
    renderBar({
      stateFor: () => "speaking",
      unitsFor: () => unitList(3),
      progressFor: () => PLAYING_FIRST,
    });

    fireEvent.click(screen.getByTestId(`speech-bar-segment-${KEY}-2`));
    expect(stub.host?.onJumpToUnit).toHaveBeenCalledWith(KEY, 2);

    fireEvent.click(screen.getByTestId(`speech-bar-playpause-${KEY}`));
    expect(stub.host?.onPause).toHaveBeenCalledWith(KEY);
  });

  it("reads cache state in the page's project voice", async () => {
    const EMMA = "en-US-EmmaMultilingualNeural";
    setProjectVoice("pavilio", EMMA);
    // The stand-in's own cache, keyed on voice + text as the real one is.
    selectSynth("simple", "peek");
    const units = unitList(2);
    await synth.synthesizeSpeech(units[0].text, { voice: EMMA });
    await synth.synthesizeSpeech(units[1].text, { voice: DEFAULT_SPEECH_VOICE });

    renderBar({ stateFor: () => "ready", unitsFor: () => units });

    const segment = (index: number) =>
      screen.getByTestId(`speech-bar-segment-${KEY}-${index}`).getAttribute("data-segment");
    expect(segment(0)).toBe("ready");
    // In the default voice: not what the page's units were synthesized in.
    expect(segment(1)).toBe("cold");
  });

  it("empty page disables play", () => {
    renderBar({ stateFor: () => "empty" });

    const play = screen.getByTestId(`speech-bar-playpause-${KEY}`) as HTMLButtonElement;
    expect(play.disabled).toBe(true);
    expect(play.getAttribute("aria-label")).toBe("Nothing to speak yet");
  });

  it("bar shows play, scrubber, cached share, clear cache in order", () => {
    cache.share = { cached: 4, bytes: 212 * 1024 };
    renderBar({ stateFor: () => "ready", unitsFor: () => unitList(6) });

    const row = screen.getByTestId(`document-speech-bar-${KEY}`);
    const order = [
      screen.getByTestId(`speech-bar-playpause-${KEY}`),
      screen.getByTestId(`speech-bar-scrubber-${KEY}`),
      cachedLabel()!,
      clearButton()!,
    ];
    // Mockup check — bar order: each control follows the one before it.
    for (let i = 1; i < order.length; i++) {
      expect(row.contains(order[i])).toBe(true);
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(cachedLabel()!.textContent).toBe("4 of 6 cached · 212 KB");
    expect(clearButton()!.textContent).toBe("Clear cache");

    // The label follows the cache as uploads land.
    cache.share = { cached: 5, bytes: 1.25 * 1024 * 1024 };
    act(() => cache.changed());
    expect(cachedLabel()!.textContent).toBe("5 of 6 cached · 1.3 MB");
  });

  it("clear cache is hidden when nothing is cached", () => {
    renderBar({ stateFor: () => "ready", unitsFor: () => unitList(3) });

    // Mockup check — Clear cache only with cache.
    expect(clearButton()).toBeNull();
    expect(cachedLabel()!.textContent).toBe("0 of 3 cached");

    cache.share = { cached: 1, bytes: 2048 };
    act(() => cache.changed());
    expect(clearButton()).not.toBeNull();
  });

  it("clear cache stops the run and clears the page", async () => {
    cache.share = { cached: 2, bytes: 4096 };
    renderBar({
      stateFor: () => "speaking",
      speakingSessionId: KEY,
      unitsFor: () => unitList(3),
      progressFor: () => PLAYING_FIRST,
    });

    fireEvent.click(clearButton()!);
    expect(stub.host?.onStop).toHaveBeenCalledWith(KEY);
    expect(cache.clearPage).toHaveBeenCalledWith(KEY);
    await waitFor(() => expect(clearButton()?.hasAttribute("disabled") ?? false).toBe(false));
    expect(getAlertsSnapshot()).toHaveLength(0);
  });

  it("clear cache on a page that is only warming does not stop the answer playing", async () => {
    cache.share = { cached: 2, bytes: 4096 };
    // The page's first unit is warming in the background ("preparing") while
    // a terminal answer owns the player.
    renderBar({
      stateFor: (key) => (key === KEY ? "preparing" : "speaking"),
      speakingSessionId: "cell-a",
      unitsFor: () => unitList(3),
    });

    fireEvent.click(clearButton()!);

    expect(stub.host?.onStop).not.toHaveBeenCalled();
    expect(cache.clearPage).toHaveBeenCalledWith(KEY);
    await waitFor(() => expect(clearButton()?.hasAttribute("disabled") ?? false).toBe(false));
  });

  it("stopPageRuns stops only an open page that owns the player", () => {
    const OTHER = "doc:pavilio/wiki/other.md";
    stub.host = makeSpeech({
      // Both pages read as holding the element; only OTHER's run owns it.
      stateFor: (key) => (key === KEY ? "preparing" : "speaking"),
      speakingSessionId: OTHER,
    });
    let pages: ReturnType<typeof usePageSpeech> | null = null;
    function Probe() {
      pages = usePageSpeech();
      return null;
    }
    render(
      <Host>
        <Probe />
      </Host>,
    );
    act(() => {
      pages!.speakDocument({ key: KEY, text: "Page one." });
      pages!.speakDocument({ key: OTHER, text: "Page two." });
    });

    act(() => pages!.stopPageRuns());
    expect(stub.host.onStop).toHaveBeenCalledTimes(1);
    expect(stub.host.onStop).toHaveBeenCalledWith(OTHER);
  });

  it("stopPageRuns leaves an answer playing while a page only warms", () => {
    stub.host = makeSpeech({
      stateFor: (key) => (key === KEY ? "preparing" : "speaking"),
      speakingSessionId: "cell-a",
    });
    let pages: ReturnType<typeof usePageSpeech> | null = null;
    function Probe() {
      pages = usePageSpeech();
      return null;
    }
    render(
      <Host>
        <Probe />
      </Host>,
    );
    act(() => pages!.speakDocument({ key: KEY, text: "Page one." }));

    act(() => pages!.stopPageRuns());
    expect(stub.host.onStop).not.toHaveBeenCalled();
  });

  it("a failed clear raises the alert", async () => {
    cache.share = { cached: 2, bytes: 4096 };
    cache.clearPage.mockImplementation(async () => {
      throw new Error("DELETE answered 500");
    });
    renderBar({ stateFor: () => "ready", unitsFor: () => unitList(3) });

    fireEvent.click(clearButton()!);
    // Not playing: nothing to stop, and a cell that speaks must not be silenced.
    expect(stub.host?.onStop).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(getAlertsSnapshot().map(({ kind, title }) => ({ kind, title }))).toEqual([
        { kind: "error", title: "Couldn't clear the cache: DELETE answered 500" },
      ]),
    );
  });

  it("a failed clear re-reads the listing so Clear cache comes back", async () => {
    cache.share = { cached: 2, bytes: 4096 };
    cache.clearPage.mockImplementation(async () => {
      // The local listing is emptied whatever the server said.
      cache.share = { cached: 0, bytes: 0 };
      cache.changed();
      throw new Error("DELETE answered 500");
    });
    // The server still holds the audio: the re-read lists it again.
    cache.loadPageList.mockImplementation(async () => {
      cache.share = { cached: 2, bytes: 4096 };
      cache.changed();
    });
    renderBar({ stateFor: () => "ready", unitsFor: () => unitList(3) });

    fireEvent.click(clearButton()!);

    await waitFor(() => expect(cache.loadPageList).toHaveBeenCalledWith(KEY));
    await waitFor(() => expect(clearButton()).not.toBeNull());
    expect(cachedLabel()?.textContent).toContain("2 of 3 cached");
  });

  it("a failed clear whose re-read also fails keeps Clear cache until a clear succeeds", async () => {
    cache.share = { cached: 2, bytes: 4096 };
    cache.clearPage.mockImplementationOnce(async () => {
      cache.share = { cached: 0, bytes: 0 };
      cache.changed();
      throw new Error("DELETE answered 500");
    });
    // The re-read failed too: `loadPageList` swallows it and lists nothing.
    cache.loadPageList.mockImplementation(async () => {
      cache.share = { cached: 0, bytes: 0 };
      cache.changed();
    });
    renderBar({ stateFor: () => "ready", unitsFor: () => unitList(3) });

    fireEvent.click(clearButton()!);
    await waitFor(() => expect(cache.loadPageList).toHaveBeenCalledWith(KEY));
    await waitFor(() => expect(clearButton()?.hasAttribute("disabled") ?? true).toBe(false));

    // The audio may still be on disk: the retry stays, and the label says so.
    expect(clearButton()).not.toBeNull();
    expect(cachedLabel()?.textContent).toContain("cache state unknown");

    fireEvent.click(clearButton()!);
    await waitFor(() => expect(clearButton()).toBeNull());
    expect(cachedLabel()?.textContent).toBe("0 of 3 cached");
  });

  it("a failed clear stops reading as unknown once a listing comes back with data", async () => {
    cache.share = { cached: 2, bytes: 4096 };
    cache.clearPage.mockImplementationOnce(async () => {
      cache.share = { cached: 0, bytes: 0 };
      cache.changed();
      throw new Error("DELETE answered 500");
    });
    cache.loadPageList.mockImplementation(async () => {});
    renderBar({ stateFor: () => "ready", unitsFor: () => unitList(3) });

    fireEvent.click(clearButton()!);
    await waitFor(() => expect(cachedLabel()?.textContent).toContain("cache state unknown"));

    // A later listing (the next Play) lists the page again.
    act(() => {
      cache.share = { cached: 1, bytes: 2048 };
      cache.changed();
    });
    expect(cachedLabel()?.textContent).toContain("1 of 3 cached");
    // …and then a listing that is truly empty hides Clear cache again.
    act(() => {
      cache.share = { cached: 0, bytes: 0 };
      cache.changed();
    });
    expect(clearButton()).toBeNull();
    expect(cachedLabel()?.textContent).toBe("0 of 3 cached");
  });

  it("a successful clear does not re-read the listing", async () => {
    cache.share = { cached: 2, bytes: 4096 };
    renderBar({ stateFor: () => "ready", unitsFor: () => unitList(3) });

    fireEvent.click(clearButton()!);
    await waitFor(() => expect(cache.clearPage).toHaveBeenCalled());
    await waitFor(() => expect(clearButton()?.hasAttribute("disabled") ?? false).toBe(false));

    expect(cache.loadPageList).not.toHaveBeenCalled();
  });

  it("scrubber segments still jump", () => {
    cache.share = { cached: 3, bytes: 9000 };
    renderBar({
      stateFor: () => "speaking",
      unitsFor: () => unitList(3),
      progressFor: () => PLAYING_FIRST,
    });

    // Mockup check — segments stay clickable beside the cache controls.
    expect(clearButton()).not.toBeNull();
    fireEvent.click(screen.getByTestId(`speech-bar-segment-${KEY}-1`));
    expect(stub.host?.onJumpToUnit).toHaveBeenCalledWith(KEY, 1);
    expect(cache.clearPage).not.toHaveBeenCalled();
  });

  it("the cell bar has no cache controls", () => {
    const CELL = "cell-a";
    // Whatever the cache would say, the cell bar never asks it.
    cache.share = { cached: 3, bytes: 9000 };
    render(
      <SpeechControlBar
        sessionId={CELL}
        speech={makeSpeech({ stateFor: () => "ready", unitsFor: () => unitList(3) })}
        answerOpen={false}
        onToggleAnswer={() => {}}
        send={() => true}
      />,
    );

    expect(screen.getByTestId(`speech-bar-scrubber-${CELL}`)).toBeTruthy();
    expect(screen.queryByTestId(`speech-bar-cached-${CELL}`)).toBeNull();
    expect(screen.queryByTestId(`speech-bar-clear-cache-${CELL}`)).toBeNull();
    expect(screen.queryByText(/cached/)).toBeNull();
    expect(screen.queryByText("Clear cache")).toBeNull();
  });
});
