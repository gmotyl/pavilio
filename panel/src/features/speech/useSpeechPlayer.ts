/**
 * The player: one `<audio>` element, a one-unit object-URL lookahead, and
 * barge-in by index reset.
 *
 * One element for the whole player, not one per unit and not one per cell: only
 * one thing is ever speaking, so barge-in is an index reset rather than a
 * negotiation between elements. The next unit's object URL exists *before* the
 * current unit's `ended` fires, so the swap is a local assignment with no
 * network round-trip — motyl's rule, carried over.
 *
 * A pause holds the *element*, not the run: nothing is torn down, no URL is
 * revoked, and the ladder simply stops advancing until `resume`, which
 * re-issues `play()` on the source the element is still holding — so it
 * continues rather than restarting the unit.
 *
 * Nothing here is language-aware and nothing here prepares text: it plays the
 * units it is handed, in order, with the voice the user picked.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { prefetchSpeech, synthesizeSpeech, toSpeechBlob } from "./synth";
import type { SpeechUnit } from "./types";
import { getStoredVoice } from "./voices";

/**
 * How far ahead of the playing unit the ladder reaches. The unit at +1 is
 * materialized all the way to an object URL (that is what makes the swap
 * local); the rest are only warmed in the synthesis cache.
 */
export const PREFETCH_AHEAD = 2;

/**
 * Consecutive unit failures that stop the run. Consecutive is the point: a
 * flaky socket that drops one unit in five should not silence the answer, but a
 * synthesizer that is simply down should not be hammered unit after unit.
 * Motyl's rule.
 *
 * It is a ceiling, not the only guard: an utterance of one or two units runs
 * out of units before it can reach three failures, so `play` also reports a run
 * that ends having played nothing at all.
 */
export const MAX_CONSECUTIVE_UNIT_FAILURES = 3;

export type SpeechFailureKind =
  /** The browser refused `play()` — nothing has been unlocked by a gesture. */
  | "refused"
  /**
   * Synthesis let the run down: {@link MAX_CONSECUTIVE_UNIT_FAILURES} units in
   * a row failed, or the run ended having played no unit at all. The error's
   * `playedUnits` tells the two apart.
   */
  | "synthesis";

/**
 * A playback failure worth telling the user about. Both kinds are surfaced by
 * `useSpeechHost`'s `onError`, never swallowed: a refusal is what the green
 * `ready` pip falls back to, and a synthesis stop is what its toast reports. A
 * handler that silently ignores a kind swallows it twice over — the `console.error`
 * below is a fallback for a *missing* handler, not for a handler that returns.
 */
export class SpeechPlaybackError extends Error {
  readonly kind: SpeechFailureKind;
  readonly sessionId: string;
  /** Declared here rather than passed to `super`: the tsconfig lib is ES2020. */
  readonly cause: unknown;
  /**
   * How many units of this run actually reached the listener before it failed.
   * Zero means the user heard **nothing at all** — a different ending from a
   * run that spoke half an answer and then gave up. The host no longer branches
   * on it — since `heard` means the final unit played to its end, both endings
   * leave the cell `ready` alike — but it is the only thing that tells the two
   * failures apart from outside the run, which is why it is still carried.
   */
  readonly playedUnits: number;

  constructor(
    kind: SpeechFailureKind,
    sessionId: string,
    message: string,
    cause?: unknown,
    playedUnits = 0,
  ) {
    super(message);
    this.name = "SpeechPlaybackError";
    this.kind = kind;
    this.sessionId = sessionId;
    this.cause = cause;
    this.playedUnits = playedUnits;
  }
}

export interface SpeechPlayerOptions {
  /**
   * Where failures go. Optional, but a missing handler is not a licence to be
   * silent — the player logs instead.
   */
  onError?: (error: SpeechPlaybackError) => void;
}

export interface SpeechPlayer {
  speakingSessionId: string | null;
  /**
   * The session whose run the user is holding paused, or `null`. A paused run
   * is still the speaking run — {@link SpeechPlayer.speakingSessionId} keeps
   * naming it — because a pause suspends the element rather than ending the
   * ladder. The control reads this one first: paused outranks speaking, so a
   * held run can never present as playing.
   */
  pausedSessionId: string | null;
  /**
   * Whether the run is blocked waiting for a unit to synthesize. One flag for
   * both occasions, because there is only one place playback ever waits: the
   * first unit of a run, and an underrun part-way through a response. It is
   * the "blocked on synthesis" red, so it is never left set on a run that has
   * given up — a red control always means more is still coming.
   */
  waitingForSynthesis: boolean;
  play(sessionId: string, units: SpeechUnit[], fromUnit?: number): Promise<void>;
  /**
   * Holds the current run: the element pauses where it is and the ladder stops
   * advancing, but nothing is torn down and no URL is revoked. Legal while the
   * run is blocked on synthesis too — the unit that then arrives is loaded and
   * left silent until {@link SpeechPlayer.resume}.
   */
  pause(): void;
  /** Lets a paused run go on from exactly where it was suspended. */
  resume(): void;
  stop(): void;
  unlock(): void;
  /**
   * Whether {@link SpeechPlayer.unlock} has run — i.e. whether a user gesture
   * has reached the element — and *not* whether playback is permitted. The
   * browser may refuse a `play()` regardless, and the player never clears this
   * flag when it does. So the green `ready` fallback must key off a
   * `kind: "refused"` {@link SpeechPlaybackError}, never off this being `true`.
   */
  readonly unlocked: boolean;
}

/**
 * One `play()` call's lifetime. `active` is the barge-in flag: a stop or a
 * newer `play` clears it, and every await in the run rechecks it, so an
 * abandoned run cannot advance the element or leak a URL it was still building.
 */
interface PlaybackRun {
  readonly sessionId: string;
  active: boolean;
  /**
   * Whether the user is holding this run. Distinct from `active`: a paused run
   * is still very much alive — it keeps its URLs, its element and its place in
   * the ladder — it simply makes no sound and does not advance.
   */
  paused: boolean;
  /** Object URLs built for this run and not yet revoked. */
  readonly urls: Set<string>;
  /** Set while a unit is playing; unblocks that wait on barge-in. */
  abandonUnit: (() => void) | null;
  /**
   * What `resume` must do to the unit the element is currently holding. Two
   * shapes, one hook: re-issue `play()` on the element — which continues from
   * the retained `currentTime`, because `src` was never touched — or, when the
   * unit reached its end under the pause, release the ladder to advance. Null
   * between units, where a resume has nothing to do but let the loop run on.
   */
  resumeUnit: (() => void) | null;
}

/** A unit's load never rejects, so the ladder can run ahead without a catch. */
type LoadedUnit =
  | { readonly index: number; readonly url: string }
  | { readonly index: number; readonly error: unknown };

/** Marks the browser refusing to start playback, as opposed to a unit failing. */
class PlaybackRefusedError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("the browser refused to start playback");
    this.name = "PlaybackRefusedError";
    this.cause = cause;
  }
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof (value as Promise<unknown> | undefined)?.then === "function";
}

function releaseUrl(run: PlaybackRun, url: string): void {
  if (run.urls.delete(url)) URL.revokeObjectURL(url);
}

/** Ends a run: no further advance, and every URL it still holds is revoked. */
function teardownRun(run: PlaybackRun): void {
  run.active = false;
  run.abandonUnit?.();
  for (const url of run.urls) URL.revokeObjectURL(url);
  run.urls.clear();
}

function resetElement(element: HTMLAudioElement): void {
  element.pause();
  element.removeAttribute("src");
}

/**
 * Synthesizes one unit and wraps it in an object URL. Failures resolve as
 * `{ error }` rather than rejecting, so the caller decides between skipping the
 * unit and stopping the run, and a lookahead started for a run that is
 * afterwards abandoned cannot become an unhandled rejection.
 */
async function loadUnit(
  run: PlaybackRun,
  units: readonly SpeechUnit[],
  index: number,
  voice: string,
): Promise<LoadedUnit> {
  try {
    // The voice is always explicit: `synth.ts` keeps a private
    // `DEFAULT_VOICE = "en-GB-RyanNeural"` from motyl, so an omitted voice
    // silently overrides the panel's Andrew default.
    const buffer = await synthesizeSpeech(units[index].text, { voice });
    // `toSpeechBlob` copies the cached buffer. Wrapping it by hand would hand
    // the same ArrayBuffer out twice and detach it on the second playback.
    const url = URL.createObjectURL(toSpeechBlob(buffer));

    if (!run.active) {
      // Barged in while this was in flight: revoke now, since nothing will
      // ever play it and the run's URL set is already drained.
      URL.revokeObjectURL(url);
      return { index, error: new Error("playback was abandoned") };
    }

    run.urls.add(url);
    return { index, url };
  } catch (error) {
    return { index, error };
  }
}

/** Warms the synthesis cache for the units past the materialized lookahead. */
function warmAhead(
  units: readonly SpeechUnit[],
  from: number,
  through: number,
  voice: string,
): void {
  for (let index = from; index <= through && index < units.length; index += 1) {
    prefetchSpeech(units[index].text, { voice });
  }
}

/**
 * Plays one already-built URL and resolves when it ends. Rejects with
 * {@link PlaybackRefusedError} when the browser declines the start — a
 * per-element permission problem that will hit every unit, so the run stops —
 * and with a plain error when the element fails on this one unit, which is
 * treated like a failed synthesis and skipped.
 */
function playUnit(element: HTMLAudioElement, url: string, run: PlaybackRun): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      element.removeEventListener("ended", onEnded);
      element.removeEventListener("error", onFailed);
      run.abandonUnit = null;
      run.resumeUnit = null;
      finish();
    };

    const onEnded = (): void => {
      if (run.paused) {
        // The unit ran out under a pause. Resolving now would start the next
        // one speaking while the user is holding the run, so the ladder waits
        // for the resume instead.
        run.resumeUnit = () => settle(resolve);
        return;
      }
      settle(resolve);
    };
    const onFailed = (): void =>
      settle(() => reject(new Error(`the audio element could not play ${url}`)));

    element.addEventListener("ended", onEnded);
    element.addEventListener("error", onFailed);
    // Barge-in must not leave this pending forever: it resolves, and the run
    // loop's staleness check then abandons the run instead of advancing it.
    run.abandonUnit = () => settle(resolve);

    element.src = url;

    const start = (): void => {
      let started: unknown;
      try {
        started = element.play();
      } catch (cause) {
        settle(() => reject(new PlaybackRefusedError(cause)));
        return;
      }
      if (isPromiseLike(started)) {
        started.catch((cause: unknown) => settle(() => reject(new PlaybackRefusedError(cause))));
      }
    };

    // Re-issuing `play()` is also what a resume from mid-unit needs, and it
    // continues rather than restarts: `src` is assigned once, above, so the
    // element keeps the position it was paused at. Registering it here is what
    // lets `resume` stay ignorant of which of the two cases it is in — and
    // keeps a refused resume on the same reporting path as a refused start.
    run.resumeUnit = start;

    // The pause may have landed while this unit was still synthesizing. It is
    // loaded into the element, but nothing may make a sound until the resume.
    if (run.paused) return;
    start();
  });
}

export function useSpeechPlayer(options: SpeechPlayerOptions = {}): SpeechPlayer {
  const [speakingSessionId, setSpeakingSessionId] = useState<string | null>(null);
  const [pausedSessionId, setPausedSessionId] = useState<string | null>(null);
  const [waitingForSynthesis, setWaitingForSynthesis] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const runRef = useRef<PlaybackRun | null>(null);
  const onErrorRef = useRef<SpeechPlayerOptions["onError"]>(undefined);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  const ensureElement = useCallback((): HTMLAudioElement => {
    if (!elementRef.current) {
      // Never attached to the document: it has no controls and nothing to lay
      // out, and the cell header is the whole UI for it.
      const element = document.createElement("audio");
      element.preload = "auto";
      elementRef.current = element;
    }
    return elementRef.current;
  }, []);

  const stop = useCallback((): void => {
    const run = runRef.current;
    if (run) {
      teardownRun(run);
      runRef.current = null;
    }
    if (elementRef.current) resetElement(elementRef.current);
    setSpeakingSessionId(null);
    setPausedSessionId(null);
    // A run that is over is not waiting for anything. Red means more is still
    // coming, so a torn-down run must never be left wearing it.
    setWaitingForSynthesis(false);
  }, []);

  const pause = useCallback((): void => {
    const run = runRef.current;
    if (!run || !run.active || run.paused) return;

    run.paused = true;
    elementRef.current?.pause();
    setPausedSessionId(run.sessionId);
  }, []);

  const resume = useCallback((): void => {
    const run = runRef.current;
    if (!run || !run.active || !run.paused) return;

    run.paused = false;
    setPausedSessionId(null);
    // Whatever the element is holding, this is how it goes on: a `play()` that
    // continues from the retained position, or the release of a unit that ended
    // under the pause. Deliberately NOT `play(sessionId, units, fromUnit)` —
    // that tears the run down and starts the unit again from its first word.
    run.resumeUnit?.();
  }, []);

  const report = useCallback(
    (
      run: PlaybackRun,
      kind: SpeechFailureKind,
      message: string,
      cause: unknown,
      playedUnits: number,
    ): void => {
      const error = new SpeechPlaybackError(kind, run.sessionId, message, cause, playedUnits);
      const handler = onErrorRef.current;
      if (handler) handler(error);
      // A missing handler still must not swallow it.
      else console.error("[speech]", error);
    },
    [],
  );

  const play = useCallback(
    async (sessionId: string, units: SpeechUnit[], fromUnit = 0): Promise<void> => {
      const element = ensureElement();
      // Barge-in: an explicit play outranks whatever is speaking, mid-unit.
      stop();
      if (units.length === 0) return;

      const start = Math.min(Math.max(Math.trunc(fromUnit), 0), units.length - 1);
      const voice = getStoredVoice();
      const run: PlaybackRun = {
        sessionId,
        active: true,
        paused: false,
        urls: new Set<string>(),
        abandonUnit: null,
        resumeUnit: null,
      };
      runRef.current = run;
      setSpeakingSessionId(sessionId);

      const isStale = (): boolean => !run.active || runRef.current !== run;
      /**
       * Materializes the next unit's object URL and warms the rest of the
       * ladder behind it. Called with the index *after* the one just handled,
       * so the warming is measured from the unit that is about to play.
       */
      const ladderFrom = (index: number): Promise<LoadedUnit> | null => {
        warmAhead(units, index + 1, index + PREFETCH_AHEAD - 1, voice);
        return index < units.length ? loadUnit(run, units, index, voice) : null;
      };

      // Nothing is warmed before the first unit: it is the one the listener is
      // waiting on, so it gets the connection to itself.
      let pending: Promise<LoadedUnit> | null = loadUnit(run, units, start, voice);
      let consecutiveFailures = 0;
      /** Units the listener actually heard. Zero at the end is a failed run. */
      let playedUnits = 0;
      /** Why the last unit was lost, for the report a silent run ends with. */
      let lastFailure: unknown = null;

      while (pending !== null) {
        // The only place playback ever waits on synthesis, which is why one
        // flag covers both the first unit of the run and a mid-response
        // underrun. A newer run owns the flag the moment this one goes stale,
        // so an abandoned run must not clear it on its way out.
        setWaitingForSynthesis(true);
        const loaded = await pending;
        if (isStale()) return;
        setWaitingForSynthesis(false);

        if ("error" in loaded) {
          consecutiveFailures += 1;
          lastFailure = loaded.error;
          if (consecutiveFailures >= MAX_CONSECUTIVE_UNIT_FAILURES) {
            report(
              run,
              "synthesis",
              `speech stopped after ${consecutiveFailures} units failed to synthesize`,
              loaded.error,
              playedUnits,
            );
            stop();
            return;
          }
          pending = ladderFrom(loaded.index + 1);
          continue;
        }

        // The next unit's URL is built while this one plays, so it exists
        // before `ended` fires. Started before the await, never after it.
        pending = ladderFrom(loaded.index + 1);

        try {
          await playUnit(element, loaded.url, run);
          consecutiveFailures = 0;
          playedUnits += 1;
        } catch (cause) {
          if (cause instanceof PlaybackRefusedError) {
            releaseUrl(run, loaded.url);
            report(
              run,
              "refused",
              "the browser refused to start speaking",
              cause.cause,
              playedUnits,
            );
            stop();
            return;
          }
          // The element failed on this unit alone: treat it like a failed
          // synthesis and let the next unit have its turn.
          consecutiveFailures += 1;
          lastFailure = cause;
          if (consecutiveFailures >= MAX_CONSECUTIVE_UNIT_FAILURES) {
            releaseUrl(run, loaded.url);
            report(
              run,
              "synthesis",
              `speech stopped after ${consecutiveFailures} units failed to play`,
              cause,
              playedUnits,
            );
            stop();
            return;
          }
        }

        releaseUrl(run, loaded.url);
        if (isStale()) return;
      }

      if (isStale()) return;

      // The run reached the end of its units without ever making a sound.
      // {@link MAX_CONSECUTIVE_UNIT_FAILURES} cannot catch this on its own:
      // an utterance of one or two units runs out of units before it runs out
      // of the failures the ladder needs, so the loop simply ends and the run
      // would otherwise look exactly like a finished answer — silence, no
      // toast, and a cell flipped to `heard`. Short answers are the common
      // case, so this weaker condition is what makes a dead click legible.
      if (playedUnits === 0) {
        report(
          run,
          "synthesis",
          `speech produced nothing: all ${units.length - start} units failed`,
          lastFailure,
          0,
        );
      }

      stop();
    },
    [ensureElement, report, stop],
  );

  const unlock = useCallback((): void => {
    const element = ensureElement();
    // Autoplay permission attaches to the element, not to the page: a `play()`
    // the user's own gesture authorises keeps this element playable for the
    // later, programmatic plays. The element has no source yet, so the call
    // itself fails — consuming the gesture is the entire point.
    try {
      const started: unknown = element.play();
      if (isPromiseLike(started)) {
        started.then(() => element.pause()).catch(() => {});
      } else {
        element.pause();
      }
    } catch {
      // Nothing to unlock yet; the gesture has still reached the element.
    }
    setUnlocked(true);
  }, [ensureElement]);

  // Unmount: revoke straight off the refs, with no state update to a hook that
  // is already gone.
  useEffect(
    () => () => {
      if (runRef.current) teardownRun(runRef.current);
      runRef.current = null;
      if (elementRef.current) resetElement(elementRef.current);
    },
    [],
  );

  return useMemo(
    () => ({
      speakingSessionId,
      pausedSessionId,
      waitingForSynthesis,
      play,
      pause,
      resume,
      stop,
      unlock,
      unlocked,
    }),
    [
      speakingSessionId,
      pausedSessionId,
      waitingForSynthesis,
      play,
      pause,
      resume,
      stop,
      unlock,
      unlocked,
    ],
  );
}
