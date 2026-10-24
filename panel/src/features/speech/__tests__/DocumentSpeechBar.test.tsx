import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { makeSpeech, resetSpeechHarness, selectSynth, synth, synthMock } from "./speech.harness";
import type { AnswerWaitingPort, SpeechHost } from "../useSpeechHost";
import type { SpeechUnit } from "../types";
import { DEFAULT_SPEECH_VOICE, setProjectVoice } from "../voices";

/**
 * The host is stubbed, NOT `usePanelSpeech`: the bar is required to read the
 * panel's one host, and mocking the hook would delete the provider's throw.
 * So the real `SpeechHostProvider` is mounted and only the host it publishes
 * is swapped; the two document-wide hooks it runs are stubbed out.
 */
const stub = vi.hoisted(() => ({ host: null as SpeechHost | null }));

vi.mock("../synth", () => synthMock());
vi.mock("../useSpeechHost", () => {
  const useSpeechHost = () => stub.host;
  return { useSpeechHost, default: useSpeechHost };
});
vi.mock("../useMediaSessionTransport", () => ({ useMediaSessionTransport: () => {} }));
vi.mock("../useSpeechKeys", () => ({ useSpeechKeys: () => {} }));

import { SpeechHostProvider } from "../SpeechHostProvider";
import { DocumentSpeechBar } from "../DocumentSpeechBar";

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
  resetSpeechHarness();
});

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
});
