import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { makeSpeech, resetSpeechHarness, selectSynth, synth, synthMock } from "./speech.harness";
import type { AnswerWaitingPort, SpeechHost } from "../useSpeechHost";
import type { SpeechUnit } from "../types";
import { DEFAULT_SPEECH_VOICE, setProjectVoice } from "../voices";
import { __resetAlertsForTests, getAlertsSnapshot } from "../../alerts/store";
import { preferences } from "../../../preferences/declarations";
import { clearPreference, readPreference } from "../../../preferences/store";

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
    loadPageList: null as unknown as import("vitest").Mock<(docKey: string) => Promise<boolean>>,
  };
});

vi.mock("../pageCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pageCache")>();
  cache.clearPage = vi.fn(async (_docKey: string) => {});
  cache.loadPageList = vi.fn(async (_docKey: string) => false);
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
      languageFor={() => "en"}
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
  cache.loadPageList.mockImplementation(async () => false);
  __resetAlertsForTests();
  clearPreference(preferences.speechPageCacheEnabled);
  resetSpeechHarness();
});

const clearButton = () => screen.queryByTestId(`speech-bar-clear-cache-${KEY}`);
const cachedLabel = () => screen.queryByTestId(`speech-bar-cached-${KEY}`);
const cacheToggle = () => screen.queryByTestId(`speech-bar-page-cache-${KEY}`);
/** Rendered but disabled: the icon never leaves the row. */
const clearDisabled = () => (clearButton() as HTMLButtonElement | null)?.disabled === true;

describe("DocumentSpeechBar", () => {
  it("page row orders cache toggle, transport, share, clear icon", () => {
    cache.share = { cached: 4, bytes: 212 * 1024 };
    renderBar({ stateFor: () => "ready", unitsFor: () => unitList(6) });

    const bar = screen.getByTestId(`document-speech-bar-${KEY}`);
    const row = bar.querySelector(".speech-bar-row")!;
    expect(row).not.toBeNull();
    const order = [
      cacheToggle()!,
      screen.getByTestId(`speech-bar-playpause-${KEY}`),
      screen.getByTestId(`speech-bar-scrubber-${KEY}`),
      cachedLabel()!,
      clearButton()!,
    ];
    // Each control follows the one before it, all inside the one row.
    for (let i = 0; i < order.length; i++) {
      expect(order[i]).not.toBeNull();
      expect(row.contains(order[i])).toBe(true);
      if (i === 0) continue;
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(bar.querySelectorAll("[data-testid^='speech-bar-segment-']")).toHaveLength(6);
    expect(cachedLabel()!.textContent).toBe("4 of 6 cached · 212 KB");
    // An icon, not the old text button.
    expect(clearButton()!.textContent).toBe("");
    expect(clearButton()!.getAttribute("title")).toBe("Clear this page's cached audio");
    expect(clearButton()!.querySelector("svg")).not.toBeNull();

    // The label follows the cache as uploads land.
    cache.share = { cached: 5, bytes: 1.25 * 1024 * 1024 };
    act(() => cache.changed());
    expect(cachedLabel()!.textContent).toBe("5 of 6 cached · 1.3 MB");

    // Three buttons — cache toggle, play/pause, clear icon: no mode switch,
    // previous/next, eye button, launchers or hide toggle.
    expect(row.querySelectorAll("button")).toHaveLength(3);
    expect(screen.queryByTestId(`speech-bar-autoplay-${KEY}`)).toBeNull();
    expect(screen.queryByTestId(`document-speech-bar-previous-${KEY}`)).toBeNull();
    expect(screen.queryByTestId(`document-speech-bar-next-${KEY}`)).toBeNull();
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

  it("cache toggle reflects and flips the preference", () => {
    const OTHER = "doc:pavilio/wiki/other.md";
    stub.host = makeSpeech({ stateFor: () => "ready", unitsFor: () => unitList(3) });
    render(
      <Host>
        <DocumentSpeechBar docKey={KEY} />
        <DocumentSpeechBar docKey={OTHER} />
      </Host>,
    );
    const toggle = (key: string) => screen.getByTestId(`speech-bar-page-cache-${key}`);

    // On by default: pressed, green (`data-page-cache="on"`), and the label
    // names the state and what a click does.
    expect(toggle(KEY).getAttribute("aria-pressed")).toBe("true");
    expect(toggle(KEY).getAttribute("data-page-cache")).toBe("on");
    expect(toggle(KEY).getAttribute("aria-label")).toBe("Page cache on — click to turn off");
    expect(toggle(KEY).getAttribute("title")).toBe("Page cache on — click to turn off");
    expect(toggle(KEY).querySelector("svg")).not.toBeNull();

    fireEvent.click(toggle(KEY));
    expect(readPreference(preferences.speechPageCacheEnabled)).toBe(false);
    // Both mounted rows read the flip.
    for (const key of [KEY, OTHER]) {
      expect(toggle(key).getAttribute("aria-pressed")).toBe("false");
      expect(toggle(key).getAttribute("data-page-cache")).toBe("off");
      expect(toggle(key).getAttribute("aria-label")).toBe("Page cache off — click to turn on");
    }

    fireEvent.click(toggle(OTHER));
    expect(readPreference(preferences.speechPageCacheEnabled)).toBe(true);
    expect(toggle(KEY).getAttribute("aria-pressed")).toBe("true");
  });

  it("clear-cache icon is disabled with nothing cached", () => {
    renderBar({ stateFor: () => "ready", unitsFor: () => unitList(3) });

    // Always on the row, so the row never moves; disabled with nothing to clear.
    expect(clearButton()).not.toBeNull();
    expect((clearButton() as HTMLButtonElement).disabled).toBe(true);
    expect(cachedLabel()!.textContent).toBe("0 of 3 cached");

    cache.share = { cached: 1, bytes: 2048 };
    act(() => cache.changed());
    expect((clearButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("clear-cache icon stops the run and clears the page", async () => {
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
    // Stopped before cleared: the run must not still be reading audio that is
    // being deleted under it.
    expect(vi.mocked(stub.host!.onStop).mock.invocationCallOrder[0]).toBeLessThan(
      cache.clearPage.mock.invocationCallOrder[0],
    );
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

  it("failed clear keeps the icon enabled and alerts", async () => {
    cache.share = { cached: 2, bytes: 4096 };
    cache.clearPage.mockImplementation(async () => {
      // The local listing is emptied whatever the server said.
      cache.share = { cached: 0, bytes: 0 };
      cache.changed();
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
    // 0 cached now, yet the retry stays pressable.
    await waitFor(() => expect((clearButton() as HTMLButtonElement).disabled).toBe(false));
  });

  it("a failed clear re-reads the listing so the clear icon is enabled again", async () => {
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
      return true;
    });
    renderBar({ stateFor: () => "ready", unitsFor: () => unitList(3) });

    fireEvent.click(clearButton()!);

    await waitFor(() => expect(cache.loadPageList).toHaveBeenCalledWith(KEY));
    await waitFor(() => expect(clearDisabled()).toBe(false));
    expect(cachedLabel()?.textContent).toContain("2 of 3 cached");
  });

  it("a failed clear whose re-read also fails keeps the clear icon enabled until a clear succeeds", async () => {
    cache.share = { cached: 2, bytes: 4096 };
    cache.clearPage.mockImplementationOnce(async () => {
      cache.share = { cached: 0, bytes: 0 };
      cache.changed();
      throw new Error("DELETE answered 500");
    });
    // The re-read failed too: `loadPageList` swallows it, lists nothing and
    // answers that it read nothing.
    cache.loadPageList.mockImplementation(async () => {
      cache.share = { cached: 0, bytes: 0 };
      cache.changed();
      return false;
    });
    renderBar({ stateFor: () => "ready", unitsFor: () => unitList(3) });

    fireEvent.click(clearButton()!);
    await waitFor(() => expect(cache.loadPageList).toHaveBeenCalledWith(KEY));
    await waitFor(() => expect(clearButton()?.hasAttribute("disabled") ?? true).toBe(false));

    // The audio may still be on disk: the retry stays, and the label says so.
    expect(clearDisabled()).toBe(false);
    expect(cachedLabel()?.textContent).toContain("cache state unknown");

    fireEvent.click(clearButton()!);
    await waitFor(() => expect(clearDisabled()).toBe(true));
    expect(cachedLabel()?.textContent).toBe("0 of 3 cached");
  });

  it("a failed clear whose re-read succeeds with an empty listing stops reading as unknown", async () => {
    cache.share = { cached: 2, bytes: 4096 };
    cache.clearPage.mockImplementationOnce(async () => {
      cache.share = { cached: 0, bytes: 0 };
      cache.changed();
      throw new Error("DELETE answered 500");
    });
    // The server answered, and holds nothing for the page.
    cache.loadPageList.mockImplementation(async () => {
      cache.share = { cached: 0, bytes: 0 };
      cache.changed();
      return true;
    });
    renderBar({ stateFor: () => "ready", unitsFor: () => unitList(3) });

    fireEvent.click(clearButton()!);
    await waitFor(() => expect(cache.loadPageList).toHaveBeenCalledWith(KEY));

    await waitFor(() => expect(cachedLabel()?.textContent).toBe("0 of 3 cached"));
    expect(clearDisabled()).toBe(true);
  });

  it("a failed clear stops reading as unknown once a listing comes back with data", async () => {
    cache.share = { cached: 2, bytes: 4096 };
    cache.clearPage.mockImplementationOnce(async () => {
      cache.share = { cached: 0, bytes: 0 };
      cache.changed();
      throw new Error("DELETE answered 500");
    });
    cache.loadPageList.mockImplementation(async () => false);
    renderBar({ stateFor: () => "ready", unitsFor: () => unitList(3) });

    fireEvent.click(clearButton()!);
    await waitFor(() => expect(cachedLabel()?.textContent).toContain("cache state unknown"));

    // A later listing (the next Play) lists the page again.
    act(() => {
      cache.share = { cached: 1, bytes: 2048 };
      cache.changed();
    });
    expect(cachedLabel()?.textContent).toContain("1 of 3 cached");
    // …and then a listing that is truly empty disables the clear icon again.
    act(() => {
      cache.share = { cached: 0, bytes: 0 };
      cache.changed();
    });
    expect(clearDisabled()).toBe(true);
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
    expect(clearDisabled()).toBe(false);
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
