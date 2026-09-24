/**
 * Arriving at a cell clears its attention LED.
 *
 * Focusing a terminal already says the user is here — `TerminalsSurface`'s
 * `handleFocus` calls `sendDismiss`, which puts `{ type: "dismiss-attention" }`
 * on that session's socket. Two other gestures mean the same thing just as
 * plainly: pressing the speech transport's play control, and putting the caret
 * in the answer composer. Both are asserted here, against the two components
 * that own them.
 *
 * ## Why the mock answers the dismiss with an `idle` event
 *
 * `sendDismiss` writes a frame and returns; nothing local changes. The state
 * goes to `idle` because the SERVER answers — `server/watcher.ts` calls
 * `dismiss(sessionId)` on that message, which broadcasts the session's new
 * state back down the activity channel. jsdom has neither end of that round
 * trip, so the spy plays the server's half: it applies the `idle` event the
 * real one would send. That keeps "and the state becomes `idle`" an assertion
 * about the whole path rather than about a local write nobody makes, and it is
 * what lets the second-focus criterion be about a session that really did
 * return to `idle` in between.
 *
 * Every criterion is asserted on the CALL to `sendDismiss`, never only on the
 * resulting state: "sends no dismiss" is the claim, and a session that was
 * already `idle` would read `idle` afterwards whether or not a frame went out.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MOBILE_QUERY } from "../../../lib/breakpoints";
import type { CellSpeechState, GridSpeech, SpeechUnit } from "../../speech/types";
import { emptyUtteranceQueue } from "../../speech/utteranceQueue";
import { AnswerComposer } from "../AnswerComposer";
import { SpeechControlBar } from "../SpeechControlBar";
import { __resetAnswerWaitingForTests } from "../answerWaiting";
import {
  _applyEventForTests,
  _resetForTests,
  getActivityState,
  type ActivityState,
} from "../useTerminalActivityChannel";

const sendDismiss = vi.hoisted(() => vi.fn<(sessionId: string) => void>());

// The pool is somebody else's subject. Only the one entry point these two
// gestures reach is replaced, so the assertion is on the frame being asked
// for rather than on a socket jsdom does not have.
vi.mock("../terminalInstances", () => ({
  sendDismiss: (sessionId: string) => sendDismiss(sessionId),
}));

// Nothing is synthesized in this file: the bar draws no segments and the
// cache's two readers only have to exist.
vi.mock("../../speech/synth", () => ({
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

/** Referentially stable — a fresh collection per call is a `useSyncExternalStore` loop. */
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();

function makeSpeech(state: CellSpeechState): GridSpeech {
  return {
    stateFor: () => state,
    queueFor: () => emptyUtteranceQueue,
    heardFor: () => NOTHING_HEARD,
    unitsFor: () => NO_UNITS,
    subscribeProgress: () => () => {},
    progressFor: () => null,
    unitDurationsFor: () => NO_DURATIONS,
    armedSessionId: null,
    onSpeak: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onNewestAnswer: vi.fn(),
    onArm: vi.fn(),
    onJumpToUnit: vi.fn(),
    onSeekWithinUnit: vi.fn(),
  } satisfies GridSpeech;
}

/** jsdom has no `matchMedia`, and the composer's grip asks it for the viewport. */
function installMatchMedia(mobile: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: mobile && query === MOBILE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

/** What the activity channel would have been told by the server. */
function setActivity(sessionId: string, state: ActivityState): void {
  _applyEventForTests({
    sessionId,
    state,
    at: 1,
    ...(state === "attention" ? { attentionSinceAt: 1 } : {}),
  });
}

function renderBar(sessionId: string, state: CellSpeechState = "ready") {
  return render(
    <SpeechControlBar
      sessionId={sessionId}
      speech={makeSpeech(state)}
      answerOpen={false}
      onToggleAnswer={() => {}}
      send={() => {}}
    />,
  );
}

function renderComposer(sessionId: string) {
  return render(
    <AnswerComposer sessionId={sessionId} send={() => {}} onSubmitted={() => {}} />,
  );
}

const play = (sessionId: string): HTMLElement =>
  screen.getByTestId(`speech-bar-playpause-${sessionId}`);

const autoplay = (sessionId: string): HTMLElement =>
  screen.getByTestId(`speech-bar-autoplay-${sessionId}`);

const field = (sessionId: string): HTMLElement =>
  screen.getByTestId(`answer-pane-composer-${sessionId}`);

describe("attention clears when the user actually arrives", () => {
  beforeEach(() => {
    _resetForTests();
    __resetAnswerWaitingForTests();
    installMatchMedia(false);
    sendDismiss.mockReset();
    // The server's half of the round trip — see the note on this file.
    sendDismiss.mockImplementation((sessionId: string) => {
      setActivity(sessionId, "idle");
    });
  });

  it("dismisses attention when the transport is played", () => {
    setActivity("cell-a", "attention");
    renderBar("cell-a");

    fireEvent.click(play("cell-a"));

    expect(sendDismiss).toHaveBeenCalledWith("cell-a");
    expect(getActivityState("cell-a")).toBe("idle");
  });

  it("dismisses attention when the composer takes focus", () => {
    setActivity("cell-a", "attention");
    renderComposer("cell-a");

    fireEvent.focus(field("cell-a"));

    expect(sendDismiss).toHaveBeenCalledWith("cell-a");
    expect(getActivityState("cell-a")).toBe("idle");
  });

  // Busy is the AGENT's state, not a notification to the user. Clearing it on
  // arrival would say the agent had stopped working because somebody looked.
  it("leaves a busy session alone on both gestures", () => {
    setActivity("cell-a", "busy");
    renderBar("cell-a");
    renderComposer("cell-a");

    fireEvent.click(play("cell-a"));
    fireEvent.focus(field("cell-a"));

    expect(sendDismiss).not.toHaveBeenCalled();
    expect(getActivityState("cell-a")).toBe("busy");
  });

  it("sends no dismiss for a session that is already idle", () => {
    setActivity("cell-a", "idle");
    renderBar("cell-a");
    renderComposer("cell-a");

    fireEvent.click(play("cell-a"));
    fireEvent.focus(field("cell-a"));

    expect(sendDismiss).not.toHaveBeenCalled();
  });

  it("does not re-send a dismiss on a second focus", () => {
    setActivity("cell-a", "attention");
    renderComposer("cell-a");

    fireEvent.focus(field("cell-a"));
    fireEvent.blur(field("cell-a"));
    fireEvent.focus(field("cell-a"));

    expect(sendDismiss).toHaveBeenCalledTimes(1);
  });

  /**
   * Autoplay is not the user arriving. An answer that starts reading itself
   * says only that the agent replied — the LED is exactly the notification
   * that reply deserves, so playback the user did not ask for must leave it
   * standing. The dismiss therefore hangs off the play control's own `onClick`
   * and nothing else: the states an autoplayed run walks through arrive as
   * renders, never as a press.
   */
  it("leaves the LED alone when autoplay starts a reply on its own", () => {
    setActivity("cell-a", "attention");
    const { rerender } = renderBar("cell-a", "ready");

    // Arming the cell is a press, but it is not the transport's.
    fireEvent.click(autoplay("cell-a"));
    // …and then the host reads the answer with nobody touching anything.
    for (const state of ["preparing", "speaking", "heard"] as CellSpeechState[]) {
      rerender(
        <SpeechControlBar
          sessionId="cell-a"
          speech={makeSpeech(state)}
          answerOpen={false}
          onToggleAnswer={() => {}}
          send={() => {}}
        />,
      );
    }

    expect(sendDismiss).not.toHaveBeenCalled();
    expect(getActivityState("cell-a")).toBe("attention");
  });
});
