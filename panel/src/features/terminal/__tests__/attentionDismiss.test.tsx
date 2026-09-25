/**
 * Arriving at a cell clears its attention LED.
 *
 * Focusing a terminal already says the user is here — `TerminalsSurface`'s
 * `handleFocus` calls `sendDismiss`, which puts `{ type: "dismiss-attention" }`
 * on that session's socket. Working the transport, or putting the caret in the
 * answer composer, means the same thing just as plainly, and the panel offers
 * four doors onto the transport. All of them go through one rule —
 * `attentionArrival.dismissAttentionOnArrival` — and each is asserted here
 * against the thing that actually owns the gesture:
 *
 * - the speech bar's play/pause button, driven as a click on the real bar;
 * - `Ctrl+Shift+Space`, driven through `features/speech/useSpeechKeys`;
 * - the OS media session's `play` and `pause`, driven through
 *   `features/speech/useMediaSessionTransport`;
 * - the cell header's own speak button, which is wired in
 *   `TerminalLayoutGrid` and therefore asserted in `TerminalLayoutGrid.test.tsx`,
 *   where that grid already has a harness. It is the one door whose test lives
 *   somewhere else, and it is named here so the set can still be counted from
 *   one place.
 *
 * The two hooks are driven with the REAL helper rather than a spy callback, so
 * what these tests pin is the whole path down to the frame. That the panel
 * actually hands the hooks that helper is a separate question, and the answer
 * is structural: both take the arrival as a required parameter, so a
 * `SpeechHostProvider` that stopped passing it does not compile.
 *
 * ## The no-socket case
 *
 * Every door funnels into `sendDismiss`, which writes only on an OPEN socket
 * and is a silent no-op for a session with no instance at all — pinned by
 * `terminalInstances.test.ts`. jsdom has no socket under any of the tests
 * below, and none of them throws, which is the rest of that criterion.
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
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOBILE_QUERY } from "../../../lib/breakpoints";
import type { CellSpeechState, GridSpeech, SpeechUnit } from "../../speech/types";
import { emptyUtteranceQueue } from "../../speech/utteranceQueue";
import type { MediaSessionTransportTarget } from "../../speech/useMediaSessionTransport";
import { useMediaSessionTransport } from "../../speech/useMediaSessionTransport";
import { useSpeechKeys } from "../../speech/useSpeechKeys";
import { AnswerComposer } from "../AnswerComposer";
import { SpeechControlBar } from "../SpeechControlBar";
import { dismissAttentionOnArrival } from "../attentionArrival";
import { __resetAnswerWaitingForTests } from "../answerWaiting";
import {
  _applyEventForTests,
  _resetForTests,
  getActivityState,
  type ActivityState,
} from "../useTerminalActivityChannel";

const sendDismiss = vi.hoisted(() => vi.fn<(sessionId: string) => void>());
const reconnectOnActivate = vi.hoisted(() => vi.fn<(sessionId: string) => void>());

// The pool is somebody else's subject. Only the entry points these gestures
// reach are replaced, so the assertion is on the frame being asked for rather
// than on a socket jsdom does not have.
//
// `reconnectOnActivate` is the second of those entry points. The composer's
// focus now repairs that cell's socket as well as clearing its LED, so a mock
// that knows only `sendDismiss` makes every focus below throw. It is a spy
// rather than a bare no-op because the repair is part of the same arrival
// gesture this file is about: the focus tests can then pin that it is asked
// for, and asked for THIS session. What the real one REFUSES to do — a
// healthy socket, an exited session, a second ask mid-handshake — is a
// property of the pool, invisible through a spy, and is pinned against the
// real pool in `AnswerComposer.focusReconnect.test.tsx`.
vi.mock("../terminalInstances", () => ({
  sendDismiss: (sessionId: string) => sendDismiss(sessionId),
  reconnectOnActivate: (sessionId: string) => reconnectOnActivate(sessionId),
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
      send={() => true}
    />,
  );
}

function renderComposer(sessionId: string) {
  return render(
    <AnswerComposer sessionId={sessionId} send={() => true} onSubmitted={() => {}} />,
  );
}

const play = (sessionId: string): HTMLElement =>
  screen.getByTestId(`speech-bar-playpause-${sessionId}`);

const autoplay = (sessionId: string): HTMLElement =>
  screen.getByTestId(`speech-bar-autoplay-${sessionId}`);

const field = (sessionId: string): HTMLElement =>
  screen.getByTestId(`answer-pane-composer-${sessionId}`);

/**
 * The activity channel, the waiting store and the pool spies, back to nothing.
 *
 * Shared by all three describes below rather than written out again in each:
 * the last two drive the same rule through hooks instead of components, and a
 * harness that drifted between them would let one door be reset differently
 * from the rest.
 */
function resetArrivalHarness(): void {
  _resetForTests();
  __resetAnswerWaitingForTests();
  installMatchMedia(false);
  reconnectOnActivate.mockReset();
  sendDismiss.mockReset();
  // The server's half of the round trip — see the note on this file.
  sendDismiss.mockImplementation((sessionId: string) => {
    setActivity(sessionId, "idle");
  });
}

describe("attention clears when the user actually arrives", () => {
  beforeEach(resetArrivalHarness);

  it("dismisses attention when the transport is played", () => {
    setActivity("cell-a", "attention");
    renderBar("cell-a");

    fireEvent.click(play("cell-a"));

    expect(sendDismiss).toHaveBeenCalledWith("cell-a");
    expect(getActivityState("cell-a")).toBe("idle");
  });

  /**
   * The same one control, pressed while the voice is reading.
   *
   * The rule is keyed on the gesture rather than on the direction the transport
   * moves — see `attentionArrival`. Nobody pauses an answer they are not
   * listening to, and this button IS the play button: which of the two a press
   * means is decided by where the run happens to be, so a dismiss that fired
   * only on the play half would fire or not fire for a reason the user never
   * expressed.
   */
  it("dismisses attention when the transport is paused", () => {
    setActivity("cell-a", "attention");
    renderBar("cell-a", "speaking");

    fireEvent.click(play("cell-a"));

    expect(sendDismiss).toHaveBeenCalledWith("cell-a");
    expect(getActivityState("cell-a")).toBe("idle");
  });

  /**
   * The caret landing in the composer is one arrival that says two things, and
   * both are asserted here so the pair cannot be split by accident: the user
   * is looking (clear the LED) and is about to send (repair the socket). They
   * share a handler and neither is conditional on the other — which is why the
   * reconnect is asked for by session id, not for the pool.
   */
  it("dismisses attention and asks for a reconnect when the composer takes focus", () => {
    setActivity("cell-a", "attention");
    renderComposer("cell-a");

    fireEvent.focus(field("cell-a"));

    expect(sendDismiss).toHaveBeenCalledWith("cell-a");
    expect(getActivityState("cell-a")).toBe("idle");
    expect(reconnectOnActivate).toHaveBeenCalledWith("cell-a");
    expect(reconnectOnActivate).toHaveBeenCalledTimes(1);
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
    // …but the socket repair is not the LED's business: somebody typing into a
    // busy cell still wants a live socket waiting when they press Enter.
    expect(reconnectOnActivate).toHaveBeenCalledWith("cell-a");
  });

  it("sends no dismiss for a session that is already idle", () => {
    setActivity("cell-a", "idle");
    renderBar("cell-a");
    renderComposer("cell-a");

    fireEvent.click(play("cell-a"));
    fireEvent.focus(field("cell-a"));

    expect(sendDismiss).not.toHaveBeenCalled();
  });

  /**
   * The caret leaving and coming back — routine while a reply is being typed.
   *
   * The two halves of the gesture answer a repeat differently, and that is the
   * point of asserting both here. The dismiss is decided HERE, by the rule
   * reading the cell's state: the first focus took the session to `idle`, so
   * the second raises no frame at all. The reconnect is decided in the POOL:
   * the composer asks again, unconditionally, and `reconnectOnActivate` drops
   * the ask because the handshake it started is still in flight. So the count
   * below is 2 rather than 1 — the second ask costs nothing, and that it costs
   * nothing is `AnswerComposer.focusReconnect.test.tsx`'s claim, made against
   * the real pool where the sockets it did or did not open can be counted.
   * Were this file to stub that refusal in, it would be asserting its own mock.
   */
  it("does not re-send a dismiss on a second focus", () => {
    setActivity("cell-a", "attention");
    renderComposer("cell-a");

    fireEvent.focus(field("cell-a"));
    fireEvent.blur(field("cell-a"));
    fireEvent.focus(field("cell-a"));

    expect(sendDismiss).toHaveBeenCalledTimes(1);
    expect(reconnectOnActivate.mock.calls).toEqual([["cell-a"], ["cell-a"]]);
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
          send={() => true}
        />,
      );
    }

    expect(sendDismiss).not.toHaveBeenCalled();
    expect(getActivityState("cell-a")).toBe("attention");
  });
});

/**
 * The two doors that are not components.
 *
 * `useSpeechKeys` and `useMediaSessionTransport` both act on a RESOLVED target
 * — the run that is playing, else the one being held, else the armed cell —
 * and neither reads focus. So the arrival cannot hang off a component the way
 * the bar's and the composer's do: it has to be raised for the session the
 * hook just resolved, inside the same branch that starts or holds the audio.
 * These tests drive the hooks with the real rule and assert the frame.
 *
 * Autoplay needs no case of its own here, and that is the point: an autoplayed
 * answer never enters either hook. It is a change of state inside the host, so
 * neither a key press nor an OS action handler ever runs, and there is no
 * branch for a dismiss to escape from.
 */
interface FakeMediaSession {
  playbackState: MediaSessionPlaybackState;
  setActionHandler: (action: MediaSessionAction, handler: (() => void) | null) => void;
}

let mediaHandlers = new Map<string, (() => void) | null>();

/** jsdom implements no Media Session API, so the OS side is stood up by hand. */
function installMediaSession(): void {
  mediaHandlers = new Map();
  const session: FakeMediaSession = {
    playbackState: "none",
    setActionHandler(action, handler) {
      mediaHandlers.set(action, handler);
    },
  };
  Object.defineProperty(navigator, "mediaSession", { configurable: true, value: session });
}

function removeMediaSession(): void {
  Object.defineProperty(navigator, "mediaSession", { configurable: true, value: undefined });
}

/** What the OS does when a media key, a lock screen or a shade button is used. */
function fireMediaAction(action: MediaSessionAction): void {
  const handler = mediaHandlers.get(action);
  if (!handler) throw new Error(`no handler is bound for the "${action}" action`);
  handler();
}

/** The panel's one playback, as the two hooks are allowed to see it. */
function transportTarget(
  run: {
    speakingSessionId?: string | null;
    pausedSessionId?: string | null;
    armedSessionId?: string | null;
  } = {},
): MediaSessionTransportTarget {
  return {
    speakingSessionId: run.speakingSessionId ?? null,
    pausedSessionId: run.pausedSessionId ?? null,
    armedSessionId: run.armedSessionId ?? null,
    onSpeak: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onSeekBackward: vi.fn(),
  };
}

/** `Ctrl+Shift+Space`, at the body — nothing focused, as the panel is left. */
function pressToggleChord(): void {
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", {
      code: "Space",
      key: " ",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("attention clears from the keyboard transport", () => {
  beforeEach(resetArrivalHarness);

  it("dismisses the armed cell that Ctrl+Shift+Space starts", () => {
    setActivity("cell-b", "attention");
    renderHook(() => useSpeechKeys(transportTarget({ armedSessionId: "cell-b" }), dismissAttentionOnArrival));

    pressToggleChord();

    expect(sendDismiss).toHaveBeenCalledWith("cell-b");
    expect(getActivityState("cell-b")).toBe("idle");
  });

  it("dismisses the held run that Ctrl+Shift+Space resumes", () => {
    setActivity("cell-a", "attention");
    renderHook(() =>
      useSpeechKeys(
        transportTarget({ speakingSessionId: "cell-a", pausedSessionId: "cell-a" }),
        dismissAttentionOnArrival,
      ),
    );

    pressToggleChord();

    expect(sendDismiss).toHaveBeenCalledWith("cell-a");
  });

  // The chord is one key with two meanings, exactly like the bar's button, so
  // it dismisses whichever meaning the run gives it.
  it("dismisses the live run that Ctrl+Shift+Space holds", () => {
    setActivity("cell-a", "attention");
    renderHook(() =>
      useSpeechKeys(transportTarget({ speakingSessionId: "cell-a" }), dismissAttentionOnArrival),
    );

    pressToggleChord();

    expect(sendDismiss).toHaveBeenCalledWith("cell-a");
  });

  it("leaves a busy cell and an idle cell alone", () => {
    setActivity("cell-busy", "busy");
    setActivity("cell-idle", "idle");
    const { unmount } = renderHook(() =>
      useSpeechKeys(transportTarget({ armedSessionId: "cell-busy" }), dismissAttentionOnArrival),
    );
    pressToggleChord();
    unmount();

    renderHook(() =>
      useSpeechKeys(transportTarget({ armedSessionId: "cell-idle" }), dismissAttentionOnArrival),
    );
    pressToggleChord();

    expect(sendDismiss).not.toHaveBeenCalled();
    expect(getActivityState("cell-busy")).toBe("busy");
  });

  // Nothing playing, nothing held, nothing armed: the chord resolves to no
  // session, so there is nobody to have arrived and nothing to throw about.
  it("does nothing when the chord resolves to no cell", () => {
    expect(() => {
      renderHook(() => useSpeechKeys(transportTarget(), dismissAttentionOnArrival));
      pressToggleChord();
    }).not.toThrow();

    expect(sendDismiss).not.toHaveBeenCalled();
  });
});

describe("attention clears from the OS media session", () => {
  beforeEach(() => {
    resetArrivalHarness();
    installMediaSession();
  });

  afterEach(removeMediaSession);

  it("dismisses the armed cell that `play` starts", () => {
    setActivity("cell-b", "attention");
    renderHook(() =>
      useMediaSessionTransport(
        transportTarget({ armedSessionId: "cell-b" }),
        dismissAttentionOnArrival,
      ),
    );

    fireMediaAction("play");

    expect(sendDismiss).toHaveBeenCalledWith("cell-b");
    expect(getActivityState("cell-b")).toBe("idle");
  });

  it("dismisses the held run that `play` resumes", () => {
    setActivity("cell-a", "attention");
    renderHook(() =>
      useMediaSessionTransport(
        transportTarget({ speakingSessionId: "cell-a", pausedSessionId: "cell-a" }),
        dismissAttentionOnArrival,
      ),
    );

    fireMediaAction("play");

    expect(sendDismiss).toHaveBeenCalledWith("cell-a");
  });

  /**
   * The OS is the one surface where play and pause are two separate actions
   * rather than one button. That is a platform detail, not a different
   * intention, so `pause` arrives here too — otherwise the lock screen would
   * be the only transport in the panel where holding an answer left the LED
   * burning.
   */
  it("dismisses the live run that `pause` holds", () => {
    setActivity("cell-a", "attention");
    renderHook(() =>
      useMediaSessionTransport(
        transportTarget({ speakingSessionId: "cell-a" }),
        dismissAttentionOnArrival,
      ),
    );

    fireMediaAction("pause");

    expect(sendDismiss).toHaveBeenCalledWith("cell-a");
  });

  it("leaves a busy cell and an idle cell alone", () => {
    setActivity("cell-busy", "busy");
    setActivity("cell-idle", "idle");
    const { unmount } = renderHook(() =>
      useMediaSessionTransport(
        transportTarget({ armedSessionId: "cell-busy" }),
        dismissAttentionOnArrival,
      ),
    );
    fireMediaAction("play");
    unmount();

    renderHook(() =>
      useMediaSessionTransport(
        transportTarget({ armedSessionId: "cell-idle" }),
        dismissAttentionOnArrival,
      ),
    );
    fireMediaAction("play");

    expect(sendDismiss).not.toHaveBeenCalled();
    expect(getActivityState("cell-busy")).toBe("busy");
  });

  it("does nothing when `play` resolves to no cell", () => {
    renderHook(() => useMediaSessionTransport(transportTarget(), dismissAttentionOnArrival));

    expect(() => fireMediaAction("play")).not.toThrow();
    expect(sendDismiss).not.toHaveBeenCalled();
  });
});
