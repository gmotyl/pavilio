/**
 * The bar's first control is the cell's speech mode: `off → armed → autoplay →
 * off`, one step per click.
 *
 * It used to be a binary `role="switch"` reporting only `autoplay` through
 * `aria-checked` and `data-armed`. Three states are not a switch, so it is a
 * plain button that publishes the mode it is in as `data-speech-mode`, draws a
 * different glyph for each, and names both the current mode and what the next
 * click does — the click is the only way to learn the cycle otherwise.
 *
 * The icon is read off lucide's own class (`lucide-<icon-name>`, as rendered by
 * the installed `lucide-react`), so the test asserts on the glyph actually
 * drawn rather than on a test id the component could set independently of it.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GridSpeech, SpeechMode, SpeechUnit } from "../../speech/types";
import { emptyUtteranceQueue } from "../../speech/utteranceQueue";

vi.mock("../terminalInstances", () => ({
  acquireTerminal: () => {
    throw new Error("the bar must not acquire a terminal");
  },
  releaseTerminal: () => {},
  // Present even where nothing here reaches them: a factory missing an export
  // fails as an UNHANDLED error beside a green result.
  sendDismiss: () => {},
  THEME: new Proxy({}, { get: () => "#000000" }),
  followBottomAcrossResize: (_terminal: unknown, fit: () => void) => fit(),
}));

// Everything cold, nothing notifies: the segments are not this file's subject.
vi.mock("../../speech/synth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../speech/synth")>()),
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

// Imported after the mocks so they pick them up.
const { SpeechControlBar } = await import("../SpeechControlBar");

const SESSION = "cell-a";

/** Shared, because a `useSyncExternalStore` snapshot must be referentially
 *  stable between notifications — a fresh value per call is a render loop. */
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);

function makeSpeech(mode: SpeechMode): GridSpeech {
  return {
    stateFor: () => "empty",
    queueFor: () => emptyUtteranceQueue,
    heardFor: () => NOTHING_HEARD,
    unitsFor: () => NO_UNITS,
    subscribeProgress: () => () => {},
    progressFor: () => null,
    unitDurationsFor: () => NO_DURATIONS,
    // Only this cell carries the mode under test; any other id reads `off`, so
    // a bar asking about the wrong session draws the wrong glyph.
    speechModeOf: (sessionId) => (sessionId === SESSION ? mode : "off"),
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
  };
}

function renderBar(speech: GridSpeech) {
  return render(
    <SpeechControlBar
      sessionId={SESSION}
      speech={speech}
      answerOpen={false}
      onToggleAnswer={() => {}}
      send={() => true}
    />,
  );
}

const control = (): HTMLElement => screen.getByTestId(`speech-bar-autoplay-${SESSION}`);

const MODES: readonly SpeechMode[] = ["off", "armed", "autoplay"];

describe("SpeechControlBar — the speech mode control", () => {
  it("the first control shows the icon and data-speech-mode of each mode", () => {
    const icons: Record<SpeechMode, string> = {
      off: "lucide-radio",
      armed: "lucide-crosshair",
      autoplay: "lucide-volume-2",
    };
    for (const mode of MODES) {
      const { unmount } = renderBar(makeSpeech(mode));
      const button = control();
      expect(button).toHaveAttribute("data-speech-mode", mode);
      // A three-state cycle is not a switch: no `aria-checked` to half-tell it.
      expect(button.tagName).toBe("BUTTON");
      expect(button).not.toHaveAttribute("role", "switch");
      expect(button).not.toHaveAttribute("aria-checked");
      expect(button).not.toHaveAttribute("data-armed");

      const glyphs = button.querySelectorAll("svg");
      expect(glyphs).toHaveLength(1);
      expect(glyphs[0]).toHaveClass(icons[mode]);
      for (const other of MODES.filter((one) => one !== mode)) {
        expect(glyphs[0]).not.toHaveClass(icons[other]);
      }
      unmount();
    }
  });

  it("clicking the first control cycles the cell's mode", () => {
    for (const mode of MODES) {
      const speech = makeSpeech(mode);
      const { unmount } = renderBar(speech);
      fireEvent.click(control());
      expect(speech.cycleSpeechMode).toHaveBeenCalledTimes(1);
      expect(speech.cycleSpeechMode).toHaveBeenCalledWith(SESSION);
      unmount();
    }
  });

  it("the first control's label names the mode and the next click", () => {
    const labels: Record<SpeechMode, string> = {
      off: "Speech off — arm this cell",
      armed: "Armed — preloading; click for autoplay",
      autoplay: "Autoplay — click to turn off",
    };
    for (const mode of MODES) {
      const { unmount } = renderBar(makeSpeech(mode));
      expect(control()).toHaveAttribute("aria-label", labels[mode]);
      expect(control()).toHaveAttribute("title", labels[mode]);
      expect(control()).toHaveAccessibleName(labels[mode]);
      unmount();
    }
  });
});
