/**
 * Settings → Speech → "Page audio cache": the row the mockup draws
 * (`projects/pavilio/mockups/2026-10-29-page-speech-play-from-here-options.html`,
 * "Shared: Settings, Speech section"; design.md § Mockups) — pages · units ·
 * size from `cacheTotals`, and a "Wipe cache…" button that confirms first.
 *
 * The real `SpeechHostProvider` is mounted with a stubbed host, as the
 * document bar's suite does, so "a playing page stops" goes through the same
 * open-page record a page's Play writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, type ReactNode } from "react";
import { makeSpeech, resetSpeechHarness, synthMock } from "./speech.harness";
import type { AnswerWaitingPort, SpeechHost } from "../useSpeechHost";
import type { PageCacheTotals } from "../pageCache";
import { __resetAlertsForTests, getAlertsSnapshot } from "../../alerts/store";

const stub = vi.hoisted(() => ({ host: null as SpeechHost | null }));

const cache = vi.hoisted(() => ({
  cacheTotals: null as unknown as import("vitest").Mock<() => Promise<PageCacheTotals>>,
  wipeCache: null as unknown as import("vitest").Mock<() => Promise<PageCacheTotals>>,
}));

vi.mock("../pageCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pageCache")>();
  cache.cacheTotals = vi.fn();
  cache.wipeCache = vi.fn();
  return {
    ...actual,
    cacheTotals: () => cache.cacheTotals(),
    wipeCache: () => cache.wipeCache(),
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
import { PageCacheSettings } from "../PageCacheSettings";

const MOCKUP_TOTALS: PageCacheTotals = { pages: 38, units: 1204, bytes: 46.3 * 1024 * 1024 };
const ZERO: PageCacheTotals = { pages: 0, units: 0, bytes: 0 };

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

/** A page that pressed Play: its key is open in the provider, as a viewer's Play makes it. */
function OpenPage({ docKey }: { docKey: string }) {
  const pageSpeech = usePageSpeech();
  useEffect(() => {
    pageSpeech.speakDocument({ key: docKey, text: "Some page." });
  }, [pageSpeech, docKey]);
  return null;
}

function mount(host: Partial<SpeechHost> = {}, pages: string[] = []) {
  stub.host = makeSpeech(host);
  return render(
    <Host>
      {pages.map((key) => (
        <OpenPage key={key} docKey={key} />
      ))}
      <PageCacheSettings />
    </Host>,
  );
}

describe("PageCacheSettings", () => {
  beforeEach(() => {
    cache.cacheTotals.mockReset();
    cache.wipeCache.mockReset();
    cache.cacheTotals.mockResolvedValue(MOCKUP_TOTALS);
    cache.wipeCache.mockResolvedValue(MOCKUP_TOTALS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSpeechHarness();
    __resetAlertsForTests();
    stub.host = null;
  });

  it("shows the cache totals", async () => {
    mount();
    // Mockup check: the "Page audio cache" row shows pages · units · MB…
    expect(screen.getByRole("heading", { name: "Page audio cache" })).toBeTruthy();
    expect(await screen.findByText("38 pages · 1,204 units · 46.3 MB")).toBeTruthy();
    // …and a "Wipe cache…" button.
    const wipe = screen.getByRole("button", { name: "Wipe cache…" });
    expect((wipe as HTMLButtonElement).disabled).toBe(false);
  });

  it("wipe asks for confirmation before deleting", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    cache.cacheTotals.mockResolvedValueOnce(MOCKUP_TOTALS).mockResolvedValue(ZERO);
    mount();
    await screen.findByText("38 pages · 1,204 units · 46.3 MB");

    await user.click(screen.getByRole("button", { name: "Wipe cache…" }));

    // Mockup check: the button confirms first, naming the size.
    expect(confirm).toHaveBeenCalledWith("Delete 46.3 MB of cached page audio?");
    expect(cache.wipeCache).toHaveBeenCalledTimes(1);
    expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(
      cache.wipeCache.mock.invocationCallOrder[0],
    );
    expect(await screen.findByText("0 pages · 0 units · 0 B")).toBeTruthy();
  });

  it("cancelled confirmation deletes nothing", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onStop = vi.fn();
    mount({ stateFor: () => "speaking", onStop }, ["doc:pavilio/wiki/page.md"]);
    await screen.findByText("38 pages · 1,204 units · 46.3 MB");

    await user.click(screen.getByRole("button", { name: "Wipe cache…" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(cache.wipeCache).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
    expect(screen.getByText("38 pages · 1,204 units · 46.3 MB")).toBeTruthy();
  });

  it("wipe stops a playing page", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const playing = "doc:pavilio/wiki/playing.md";
    const idle = "doc:pavilio/wiki/idle.md";
    const onStop = vi.fn();
    mount(
      {
        stateFor: (key: string) => (key === playing ? "speaking" : "ready"),
        speakingSessionId: playing,
        onStop,
      },
      [playing, idle],
    );
    await screen.findByText("38 pages · 1,204 units · 46.3 MB");

    await user.click(screen.getByRole("button", { name: "Wipe cache…" }));

    // Only the page holding the element stops, and before the wipe, so
    // nothing it plays or warms lands after it.
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledWith(playing);
    expect(onStop.mock.invocationCallOrder[0]).toBeLessThan(
      cache.wipeCache.mock.invocationCallOrder[0],
    );
  });

  it("unavailable totals disable wipe", async () => {
    cache.cacheTotals.mockRejectedValue(new Error("page cache 503"));
    mount();

    expect(await screen.findByText("Cache unavailable")).toBeTruthy();
    const wipe = screen.getByRole("button", { name: "Wipe cache…" });
    expect((wipe as HTMLButtonElement).disabled).toBe(true);
  });

  it("a failed wipe raises the alert", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    cache.wipeCache.mockRejectedValue(new Error("disk full"));
    mount();
    await screen.findByText("38 pages · 1,204 units · 46.3 MB");

    await user.click(screen.getByRole("button", { name: "Wipe cache…" }));

    await waitFor(() =>
      expect(getAlertsSnapshot().map((a) => a.title)).toContain(
        "Couldn't clear the cache: disk full",
      ),
    );
  });
});
