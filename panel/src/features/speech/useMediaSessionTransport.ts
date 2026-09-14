/**
 * Hardware media keys, the lock screen and the notification shade, wired to the
 * panel's one playback.
 *
 * ## One target, because there is only one of everything
 *
 * The panel has exactly one `<audio>` element, and `navigator.mediaSession` is
 * one state machine per document. That settles what looks like a preference and
 * is not: **the transport acts on the playback, never on the focused cell.**
 *
 * The OS picks which action to send from `mediaSession.playbackState` — while
 * something is playing it sends `pause` and never `play` — so "start the cell I
 * just focused" is not expressible on that button at all. Rather than have the
 * hardware keys mean one thing and the panel's own controls another, every
 * surface drives the same target:
 *
 * - the run that is currently playing (or the one being held);
 * - or, when nothing is active, the **armed** cell's utterance.
 *
 * Hearing a *different* cell stays a click on that cell's speak control — the
 * barge-in path that has always existed. Focus is not an input to this hook,
 * and that absence is the design rather than an omission.
 *
 * ## Why the handlers are bound once
 *
 * Action handlers are document-global. Re-binding them on every render would be
 * harmless but pointless churn, and binding them inside a dependency-laden
 * effect invites a stale closure the day a dependency is forgotten. So they are
 * bound once and read the target through a ref, which is refreshed after every
 * render — a key press is a user gesture and can never land between a render
 * and its effects.
 */
import { useEffect, useRef } from "react";

/** What the OS transport needs to know about the panel's one playback. */
export interface MediaSessionTransportTarget {
  /** The cell the player is running, whether it is making sound or held. */
  speakingSessionId: string | null;
  /**
   * The cell whose run is suspended. Still the speaking session too — a pause
   * suspends the element rather than ending the ladder — which is why this is
   * read first everywhere below.
   */
  pausedSessionId: string | null;
  /** The one armed cell in this browser, or `null`. */
  armedSessionId: string | null;
  onSpeak: (sessionId: string) => void;
  onPause: (sessionId: string) => void;
  onResume: (sessionId: string) => void;
  onNext: (sessionId: string) => void;
  onPrevious: (sessionId: string) => void;
  /** Move the run back `seconds`, underflowing into earlier units. */
  onSeekBackward: (seconds: number) => void;
}

/**
 * How far one `seekbackward` goes. The Media Session spec lets the OS suggest
 * its own `seekOffset`; this ignores it on purpose, so the hardware key, the
 * bar's button and the keyboard combo all step the same distance.
 */
export const TRANSPORT_SEEK_SECONDS = 10;

/** Everything this hook binds — and so everything it must release. */
const TRANSPORT_ACTIONS: readonly MediaSessionAction[] = [
  "play",
  "pause",
  "nexttrack",
  "previoustrack",
  "seekbackward",
];

/**
 * The Media Session API, where there is one.
 *
 * Absent in jsdom, in older browsers, and in any non-secure context — and the
 * panel is served over plain HTTP on a LAN often enough that this is a live
 * case, not a theoretical one. Typed as possibly-undefined against a lib.dom
 * that promises it is always there.
 */
function mediaSessionOrNull(): MediaSession | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession ?? null;
}

/**
 * Mount once, with the host. See `SpeechHostProvider`.
 *
 * Returns nothing: every effect it has is on `navigator.mediaSession` and on
 * the host it was handed.
 */
export function useMediaSessionTransport(target: MediaSessionTransportTarget): void {
  const targetRef = useRef(target);

  useEffect(() => {
    targetRef.current = target;
  });

  useEffect(() => {
    const session = mediaSessionOrNull();
    if (!session) return;

    /**
     * The cell every action lands on: the run first, the armed cell only when
     * there is no run to act on.
     */
    const transportTarget = (): string | null => {
      const current = targetRef.current;
      return current.speakingSessionId ?? current.pausedSessionId ?? current.armedSessionId;
    };

    const bind = (action: MediaSessionAction, handler: (() => void) | null): void => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // A browser that does not know an action throws `NotSupportedError`
        // rather than ignoring it, and one unsupported action must not cost the
        // other four.
      }
    };

    bind("play", () => {
      const current = targetRef.current;
      // A held run continues from where it was suspended. Restarting it — which
      // is what `onSpeak` would do — is the one thing the user pressing play on
      // a paused answer cannot have meant.
      if (current.pausedSessionId) {
        current.onResume(current.pausedSessionId);
        return;
      }
      // Nothing is playing, so the OS is willing to send `play` at all. The
      // armed cell is the panel's standing answer to "what did you want to
      // hear?", and it is the same answer autoplay gives.
      if (current.armedSessionId) current.onSpeak(current.armedSessionId);
    });

    bind("pause", () => {
      const current = targetRef.current;
      // The cell that is speaking, whichever one that is and whatever has focus.
      if (current.speakingSessionId) current.onPause(current.speakingSessionId);
    });

    bind("nexttrack", () => {
      const sessionId = transportTarget();
      if (sessionId) targetRef.current.onNext(sessionId);
    });

    bind("previoustrack", () => {
      const sessionId = transportTarget();
      if (sessionId) targetRef.current.onPrevious(sessionId);
    });

    bind("seekbackward", () => {
      targetRef.current.onSeekBackward(TRANSPORT_SEEK_SECONDS);
    });

    return () => {
      // The handlers outlive this hook otherwise: they sit on the document's
      // media session, holding closures over a host that has gone.
      for (const action of TRANSPORT_ACTIONS) bind(action, null);
      session.playbackState = "none";
    };
  }, []);

  const { speakingSessionId, pausedSessionId } = target;

  useEffect(() => {
    const session = mediaSessionOrNull();
    if (!session) return;

    // This is what decides which key the OS sends, so it is not decoration: a
    // `playbackState` stuck on "playing" means the hardware button sends
    // `pause` forever and the panel can never be started from it.
    session.playbackState = pausedSessionId
      ? "paused"
      : speakingSessionId
        ? "playing"
        : "none";
  }, [pausedSessionId, speakingSessionId]);
}

export default useMediaSessionTransport;
