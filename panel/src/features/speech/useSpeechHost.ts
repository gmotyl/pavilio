/**
 * The one place the channel and the player meet.
 *
 * Hosted **once per panel**, never per surface and never per cell: the player
 * owns a single `<audio>` element, so a second host would be a second element
 * and "only one thing speaks" would stop being structural. Two surfaces can be
 * on screen at once (ProjectView's and the terminal drawer's), so this hook has
 * exactly one call site — `SpeechHostProvider` — and surfaces read its value
 * from context. The channel is hoisted with it so every cell in the panel reads
 * the same armed session and the same state.
 *
 * The coupling stays one-way. `useUtteranceChannel` still imports nothing from
 * the player; this module passes the player's `speakingSessionId` *into* the
 * channel on every render, and calls `markHeard` itself. That is the whole
 * reason this file exists.
 *
 * It is also where **warming** lives, for the same reason: warming needs the
 * channel's arrivals and the player's voice and cache, and neither of those two
 * may reach across to the other. The channel stays pure text work; this module
 * reads `speakableUtterances`, fills the synthesis cache, and reports which
 * cells are still waiting on it — {@link SpeechHost.preparingSessionIds}, the
 * red the control shows before anyone has clicked anything.
 *
 * ## Why a run object rather than `await play(); markHeard()`
 *
 * `useSpeechPlayer.play()` resolves the same way for four different endings —
 * the last unit finished, another cell barged in, the user hit stop, or the
 * browser refused the start — because barge-in resolves through
 * `if (isStale()) return;`, which is indistinguishable from a natural end. And
 * `heard` now means one thing only: the **final unit played to its end**. So
 * exactly one of those endings is `Heard` and every other one is `Ready`:
 *
 * - last unit ended → `Heard`
 * - user stopped or paused → `Ready` (the amendment's correction: a run the
 *   user cut short was not listened to)
 * - another cell took over → `Ready` (*not* heard — this is the trap)
 * - the browser refused → `Ready`
 * - the budget cut it short → `Ready`, plus a resume point
 * - the synthesizer gave up → `Ready`, plus a toast
 *
 * So the outcome is not read off the promise at all. Each `play` gets a {@link
 * Run} whose `outcome` starts `"pending"`, and whoever *ends* it early stamps
 * it: the incoming play stamps `"superseded"`, the stop handler stamps
 * `"stopped"`, the player's `onError` stamps `"refused"` or `"failed"`. A run
 * still `pending` when the promise settles — and that played every unit it was
 * handed — is the only natural end there is. The stamps are kept distinct
 * although they now share a destination: they are what a future reader needs to
 * see that the four endings were told apart deliberately.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "../../lib/toast";
import { closingMarkerUnit, prepare } from "./prepare";
import { synthesizeSpeech } from "./synth";
import type { GridSpeech, PreparedSpeech, Utterance } from "./types";
import { useSpeechPlayer, type SpeechPlaybackError } from "./useSpeechPlayer";
import { useUtteranceChannel } from "./useUtteranceChannel";
import { getStoredVoice } from "./voices";

/**
 * How a playback ended. `"pending"` until something ends it early, and only a
 * run that is still `"pending"` when its promise settles is a natural end.
 *
 * `"failed"` is the run the synthesizer killed. It resolves its promise exactly
 * like a finished answer, and `through === total` for a short utterance, so
 * without the stamp it would be indistinguishable from having been listened to
 * — silence, and a cell marked heard. It is not `"refused"`: that one is the
 * browser declining, and it is deliberately toast-free.
 */
type RunOutcome = "pending" | "superseded" | "stopped" | "refused" | "failed";

/**
 * What the host adds to {@link GridSpeech}: which cells are still *getting*
 * their audio. The grid-facing contract in `./types` stays as it is — it is
 * consumed by hand-built stubs all over the terminal suites — so the extra
 * channel lives here, on the host's own return type.
 */
export interface SpeechHost extends GridSpeech {
  /**
   * Sessions whose current utterance's first unit is still being synthesized.
   * A cell in here is **preparing** — the red "blocked on synthesis" — and one
   * that is not, but has an utterance, is **ready**: its audio is in hand, so a
   * click starts speaking with no wait.
   *
   * This is NOT the player's `waitingForSynthesis`. That one reports a *running*
   * playback blocked on its next unit; this one reports a cell that has not
   * been clicked at all. The two are different waits, on different sides of the
   * click, and the control paints them the same red only because the user's
   * question — "is the audio here yet?" — has the same answer.
   */
  preparingSessionIds: ReadonlySet<string>;
}

/** Shared so a panel with nothing warming does not allocate a Set per render. */
const NOTHING_PREPARING: ReadonlySet<string> = new Set<string>();

interface Run {
  readonly sessionId: string;
  /** The utterance being spoken, so a resume point cannot outlive it. */
  readonly utteranceId: string;
  /** Index just past the last unit this run was handed. */
  readonly through: number;
  /** How many units the whole utterance has, remainder included. */
  readonly total: number;
  outcome: RunOutcome;
}

/** Where a budget-capped run stopped, so a later click continues rather than restarts. */
interface ResumePoint {
  readonly utteranceId: string;
  readonly fromUnit: number;
}

export function useSpeechHost(): SpeechHost {
  const runRef = useRef<Run | null>(null);
  const resumeRef = useRef<Map<string, ResumePoint>>(new Map());
  // Keyed by utterance id: preparation is pure and the same utterance always
  // prepares the same way, so a replay must not pay for it twice.
  const preparedRef = useRef<Map<string, PreparedSpeech>>(new Map());
  /** The last utterance the armed cell autoplayed, so none is played twice. */
  const autoplayedRef = useRef<string | null>(null);
  /** Utterance ids whose first unit has been warmed, so none is warmed twice. */
  const warmedRef = useRef<Set<string>>(new Set());
  /**
   * The utterance each session is CURRENTLY warming, so a warm that a newer
   * utterance superseded cannot report the cell ready when it lands — the click
   * would play the newer unit, which is still in flight.
   */
  const warmingRef = useRef<Map<string, string>>(new Map());
  const [preparingSessionIds, setPreparingSessionIds] =
    useState<ReadonlySet<string>>(NOTHING_PREPARING);

  const setPreparing = useCallback((sessionId: string, preparing: boolean): void => {
    setPreparingSessionIds((current) => {
      if (current.has(sessionId) === preparing) return current;

      const next = new Set(current);
      if (preparing) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  }, []);

  const onError = useCallback((error: SpeechPlaybackError): void => {
    const run = runRef.current;

    // A refusal is NOT a natural end: the cell falls back to `ready`. This
    // keys off the error's `kind`, never off `player.unlocked` — that flag says
    // a gesture reached the element, not that playback is permitted, and the
    // player never clears it when the browser says no.
    if (error.kind === "refused") {
      if (run?.sessionId === error.sessionId) run.outcome = "refused";
      return;
    }

    // A run the synthesizer killed did not reach its last unit, so it was not
    // heard — whatever it managed to say first, and whatever its unit count
    // ends up looking like. The cell stays `ready` so the pip keeps inviting
    // the retry, which is how the user finds out a second click usually works.
    // `playedUnits` used to gate this; the amendment removed the gate, because
    // a half-spoken answer is exactly as unfinished as a silent one.
    if (run?.sessionId === error.sessionId) run.outcome = "failed";

    // A systemic synthesis failure has no pip to fall back to — the player has
    // already stopped — so a toast is the only thing that tells the user the
    // silence is a failure rather than the end of the answer. Every kind must
    // land somewhere: a handler that returns early also suppresses the player's
    // own `console.error` fallback, which only runs when there is no handler.
    toast.error("Speech stopped — the voice could not be synthesized.");
  }, []);

  const player = useSpeechPlayer({ onError });
  // The channel never observes playback or synthesis, so everything it needs to
  // know about either has to be handed to it on every render. Forgetting one of
  // these deletes that state from the grid.
  const channel = useUtteranceChannel({
    speakingSessionId: player.speakingSessionId,
    pausedSessionId: player.pausedSessionId,
    waitingForSynthesis: player.waitingForSynthesis,
    // The warm this module owns, handed back so one function — `stateFor` —
    // answers the whole of the control's question.
    preparingSessionIds,
  });
  const {
    armedSessionId,
    languageFor,
    markHeard,
    setArmed,
    speakableUtterances,
    stateFor,
    utteranceFor,
  } = channel;

  const preparedFor = useCallback(
    (utterance: Utterance, language: "pl" | "en"): PreparedSpeech => {
      const cached = preparedRef.current.get(utterance.id);
      if (cached) return cached;

      const prepared = prepare(utterance.text, { language });
      preparedRef.current.set(utterance.id, prepared);
      return prepared;
    },
    [],
  );

  useEffect(() => {
    // A lit control has to be ready to speak. Without this the first click pays
    // for the dynamic `import("edge-tts-universal/browser")`, a DRM token and a
    // fresh WebSocket handshake — seconds of nothing, which reads as a dead
    // button. So unit 0 is synthesized the moment an utterance arrives.
    //
    // EVERY session is warmed, not only the armed one (Greg: "arm all, I will
    // use TTS most of the time"). The cost is one small synthesis per arriving
    // response, bounded by the number of terminals, and unit 0 is deliberately
    // the response's heading or first sentence.
    //
    // Warming is silent but deliberately VISIBLE. Silent: it fills the
    // synthesis cache and never touches the player, so a warmed cell that is
    // not armed makes no sound however it is coloured. Visible: the cell is
    // reported preparing until the audio is actually in hand, because a green
    // control that might still be synthesizing is exactly the ambiguity the
    // red state exists to remove.
    for (const utterance of speakableUtterances) {
      if (warmedRef.current.has(utterance.id)) continue;
      // Marked before the synthesis, not after: a second render must not start
      // a second warm of the same utterance while the first is in flight.
      warmedRef.current.add(utterance.id);

      // A newer answer for a cell the user left PAUSED abandons the held run,
      // exactly as a barge-in abandons it in `speakFrom`. Without this the run
      // stays `pending` — `onPause` stamps nothing, on purpose — so the player
      // goes on naming the cell as its paused one, `paused` outranks every
      // other state in the channel, and the control routes the next click to
      // `onResume`. The arriving answer is warmed and unreachable: the user has
      // to listen the stale one out to its end before the new one can be
      // played at all. Stamped `superseded` *before* `stop()` resolves the
      // pending `play`, so the abandoned run lands on `ready` rather than
      // `heard`, and the session's resume point goes with it so the click that
      // follows starts at unit 0 of the new utterance rather than jumping into
      // the middle of the old text.
      //
      // Paused ONLY. A run that is still speaking is one the user is listening
      // to right now, and cutting that off mid-sentence because the agent
      // answered again is not the same favour.
      const held = runRef.current;
      if (
        held?.sessionId === utterance.sessionId &&
        held.utteranceId !== utterance.id &&
        player.pausedSessionId === utterance.sessionId
      ) {
        held.outcome = "superseded";
        player.stop();
        resumeRef.current.delete(utterance.sessionId);
      }

      const first = preparedFor(utterance, languageFor(utterance.sessionId)).units[0];
      if (!first) continue;

      warmingRef.current.set(utterance.sessionId, utterance.id);
      setPreparing(utterance.sessionId, true);

      // `synthesizeSpeech` rather than `prefetchSpeech`: the promise is the
      // whole point here — it is what says when the cell stops being red — and
      // a fire-and-forget warm cannot be reported on. The failure is swallowed
      // exactly as `prefetchSpeech` swallows it.
      //
      // The voice is the one the click will use, from the same source
      // `useSpeechPlayer` reads. The cache keys on voice + text, so warming
      // with any other voice would be a synthesis nobody ever plays.
      void synthesizeSpeech(first.text, { voice: getStoredVoice() })
        .catch(() => {
          // A warm that failed must never strand a cell red: the cell is
          // reported ready anyway, and the click pays for the synthesis
          // itself — which is also how the user gets a retry.
        })
        .then(() => {
          // A newer utterance took the cell over while this was in flight. It
          // owns the cell's colour now, so this landing says nothing.
          if (warmingRef.current.get(utterance.sessionId) !== utterance.id) return;
          warmingRef.current.delete(utterance.sessionId);
          setPreparing(utterance.sessionId, false);
        });
    }
    // `player.pausedSessionId` and `player.stop` rather than `player`: the
    // player's identity changes on every playback state change, and the whole
    // effect is a no-op for an utterance already in `warmedRef`, so depending
    // on the two members it actually reads keeps the re-runs cheap and their
    // reason legible.
  }, [
    languageFor,
    player.pausedSessionId,
    player.stop,
    preparedFor,
    setPreparing,
    speakableUtterances,
  ]);

  const speakFrom = useCallback(
    (sessionId: string, fromUnit: number): void => {
      const utterance = utteranceFor(sessionId);
      if (!utterance) return;

      const prepared = preparedFor(utterance, languageFor(sessionId));
      if (prepared.units.length === 0) {
        // Defence in depth. `useUtteranceChannel` never announces a response
        // that prepares to nothing, so nothing speakable-looking should reach
        // this — but a cell that somehow does has nothing to say, and leaving it
        // pulsing would be a notification that can never be met.
        markHeard(sessionId);
        return;
      }

      const start = Math.min(Math.max(fromUnit, 0), prepared.units.length - 1);
      // The budget caps only the first run; a continue plays the remainder to
      // the end. Slicing is what enforces it — the player always plays the
      // array it is handed to the end, so the cut has to be made here.
      const through = start === 0 ? prepared.spokenUnits : prepared.units.length;

      const spoken = prepared.units.slice(0, through);
      if (through < prepared.units.length) {
        // The budget cut is the only place a remainder exists — a continue
        // plays to the end — so `through < units.length` means `through ===
        // spokenUnits`, and `remainderParagraphs` is exactly the count to name.
        //
        // The marker is APPENDED to what the player is handed rather than added
        // to `prepared.units`: it costs nothing against the budget, and `run`
        // below still counts in prepared units only, so the resume point stays
        // the first unspoken unit rather than the marker.
        spoken.push(closingMarkerUnit(prepared.remainderParagraphs, prepared.language));
      }

      // Barge-in: whatever was speaking is *superseded*, not finished, so it
      // must revert to `unheard`. Stamped before `play`, which stops it.
      const previous = runRef.current;
      if (previous) previous.outcome = "superseded";

      const run: Run = {
        sessionId,
        utteranceId: utterance.id,
        through,
        total: prepared.units.length,
        outcome: "pending",
      };
      runRef.current = run;

      function finish(ended: Run): void {
        if (runRef.current === ended) runRef.current = null;

        // `heard` means the final unit played to its end, and nothing else.
        // Superseded, stopped, refused, failed — every ending that is not the
        // natural one leaves the cell `ready`, because something in it has
        // still not been listened to. A run still `pending` when the promise
        // settles is the only natural end there is.
        if (ended.outcome !== "pending") return;

        if (ended.through < ended.total) {
          // The budget cut is not the end of the response, so the cell stays
          // `ready` — indistinguishable in the header from a cell nobody has
          // clicked yet, on purpose, and only the resume point tells them
          // apart. It is NOT the control's `paused`, which is a run the user
          // is holding and the player is still naming as its speaking one.
          resumeRef.current.set(ended.sessionId, {
            utteranceId: ended.utteranceId,
            fromUnit: ended.through,
          });
          return;
        }

        resumeRef.current.delete(ended.sessionId);
        markHeard(ended.sessionId);
      }

      void player
        .play(sessionId, spoken, start)
        .then(() => finish(run))
        .catch(() => finish(run));
    },
    [languageFor, markHeard, player, preparedFor, utteranceFor],
  );

  const onSpeak = useCallback(
    (sessionId: string): void => {
      // The click is the gesture the element needs; every later programmatic
      // play rides on it.
      player.unlock();

      const utterance = utteranceFor(sessionId);
      if (!utterance) return;

      const resume = resumeRef.current.get(sessionId);
      // A resume point belongs to one utterance. A newer one replaced it, so
      // the click restarts rather than jumping into the middle of the old text.
      const fromUnit = resume?.utteranceId === utterance.id ? resume.fromUnit : 0;
      speakFrom(sessionId, fromUnit);
    },
    [player, speakFrom, utteranceFor],
  );

  const onStop = useCallback(
    (sessionId: string): void => {
      // A deliberate stop lands where a barge-in lands: `Ready`. It was the
      // one exception, and the amendment removed it — a run the user cut short
      // never reached its last unit, so it was not listened to. Stamped before
      // `stop()`, which resolves the pending `play`.
      const run = runRef.current;
      if (run?.sessionId === sessionId) run.outcome = "stopped";
      player.stop();
    },
    [player],
  );

  const onPause = useCallback(
    (sessionId: string): void => {
      // Nothing is stamped on the run: a pause does not END it. The run stays
      // `pending`, so the cell can still reach `heard` by playing out, and the
      // player keeps naming it as the speaking one — which is why `paused`
      // outranks `speaking` in the channel.
      //
      // Guarded on the session the player is actually running: the control
      // only offers a pause on that one cell, and a stray call from anywhere
      // else must not silence a run the user did not touch.
      if (player.speakingSessionId !== sessionId) return;
      player.pause();
    },
    [player],
  );

  const onResume = useCallback(
    (sessionId: string): void => {
      if (player.pausedSessionId !== sessionId) return;
      // Deliberately NOT `player.unlock()`: the element is holding the paused
      // unit, so unlocking would play it here rather than through `resume()` —
      // and the gesture was already spent on the click that started the run.
      player.resume();
    },
    [player],
  );

  const onArm = useCallback(
    (sessionId: string | null): void => {
      // Arming is a click too, and it is the gesture the autoplay that follows
      // will need — so it is spent on the element here rather than lost.
      player.unlock();
      setArmed(sessionId);
    },
    [player, setArmed],
  );

  const armedUtterance = armedSessionId ? utteranceFor(armedSessionId) : null;

  useEffect(() => {
    // Arming a cell does not speak what is already sitting in it: autoplay is
    // for utterances that ARRIVE while the cell is armed.
    autoplayedRef.current = armedSessionId ? (utteranceFor(armedSessionId)?.id ?? null) : null;
    // `utteranceFor` deliberately not a dependency: this must run when the
    // armed cell changes, and only then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armedSessionId]);

  useEffect(() => {
    if (!armedSessionId || !armedUtterance) return;
    if (autoplayedRef.current === armedUtterance.id) return;

    if (!player.unlocked) {
      // No gesture has reached the element yet, so the browser would refuse
      // this anyway — and a tab that has just hydrated `/api/speech/latest`
      // must not start talking on its own. Absorb it: it is old news by the
      // time the user does click something.
      autoplayedRef.current = armedUtterance.id;
      return;
    }

    autoplayedRef.current = armedUtterance.id;
    speakFrom(armedSessionId, 0);
  }, [armedSessionId, armedUtterance, player.unlocked, speakFrom]);

  return useMemo(
    () => ({
      stateFor,
      armedSessionId,
      onSpeak,
      onPause,
      onResume,
      onStop,
      onArm,
      preparingSessionIds,
    }),
    [
      armedSessionId,
      onArm,
      onPause,
      onResume,
      onSpeak,
      onStop,
      preparingSessionIds,
      stateFor,
    ],
  );
}

export default useSpeechHost;
