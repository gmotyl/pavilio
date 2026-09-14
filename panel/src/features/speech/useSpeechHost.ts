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
 * reads `warmableUtterances`, fills the synthesis cache, and reports which
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
import { prepare } from "./prepare";
import { synthesizeSpeech } from "./synth";
import type { GridSpeech, PreparedSpeech, Utterance } from "./types";
import { useSpeechPlayer, type SpeechPlaybackError } from "./useSpeechPlayer";
import { useUtteranceChannel } from "./useUtteranceChannel";
import { utteranceUnderCursor } from "./utteranceQueue";
import { getStoredVoice } from "./voices";

/**
 * How a playback ended. `"pending"` until something ends it early, and only a
 * run that is still `"pending"` when its promise settles is a natural end.
 *
 * `"failed"` is the run the synthesizer killed. It resolves its promise exactly
 * like a finished answer, so without the stamp it would be indistinguishable
 * from having been listened to — silence, and a cell marked heard. It is not
 * `"refused"`: that one is the browser declining, and it is deliberately
 * toast-free.
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
  /**
   * The utterance being spoken. It is what tells a pause on the session's
   * current answer apart from a pause on one a newer answer has replaced —
   * the supersession test in the arrival effect below.
   */
  readonly utteranceId: string;
  outcome: RunOutcome;
}

export function useSpeechHost(): SpeechHost {
  const runRef = useRef<Run | null>(null);
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
    dispatchQueue,
    finishUtterance,
    languageFor,
    markHeard,
    queueFor,
    setArmed,
    stateFor,
    utteranceFor,
    warmableUtterances,
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
    for (const utterance of warmableUtterances) {
      if (warmedRef.current.has(utterance.id)) continue;
      // Marked before the synthesis, not after: a second render must not start
      // a second warm of the same utterance while the first is in flight.
      warmedRef.current.add(utterance.id);

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
    // Warming reads nothing from the player any more: the supersession that
    // used to ride along inside this loop is its own effect below, because it
    // is about the QUEUE rather than about the cache, and a loop over every
    // speakable utterance in the panel was never the honest place to ask "is
    // this one cell's held run stale".
  }, [languageFor, preparedFor, setPreparing, warmableUtterances]);

  useEffect(() => {
    // "A paused cell does not hold the next answer hostage" — the living spec,
    // and the one arm where an arrival still supersedes rather than queueing.
    //
    // The next answer can be sitting in either of two places, because the two
    // halves arrive in either order. If the cell was ALREADY paused when the
    // answer landed, the queue put it straight into `current` and the held run
    // is playing something the cell has moved on from. If the answer landed
    // while the cell was still SPEAKING — correctly queued, a live run is never
    // cut short — then the pause is what releases it, and the queue has to be
    // stepped on first.
    //
    // Paused ONLY. A run that is still speaking is one the user is listening to
    // right now, and cutting that off because the agent answered again is not
    // the same favour.
    const held = runRef.current;
    const paused = player.pausedSessionId;
    if (!held || !paused || held.sessionId !== paused) return;

    const queue = queueFor(paused);
    const under = utteranceUnderCursor(queue);
    // Whether the cursor is still on the utterance the held run is speaking.
    // It is the whole question this effect asks, and it is asked TWICE below,
    // because both arms turn on it: while it is true the cell has not moved on
    // yet, and once it is false the held run is playing something stale.
    const holdingTheCursor = under !== null && under.id === held.utteranceId;

    // Release the answers waiting behind the held run — ONE of them. The guard
    // is the identity of the utterance under the cursor, never "is anything
    // pending": this effect re-runs on its own dispatch (the queue it reads is
    // in its dependencies), so a pending-count guard re-enters and advances
    // again, and again, until `pending` is empty — discarding every answer
    // between the held run and the newest one. At depth one that is invisible;
    // at depth three two whole answers are never played and never offered.
    // With this guard the next pass finds the cursor moved off `held` and
    // falls through to the stop below, which is where it was always going.
    if (holdingTheCursor && queue.cursor === "current" && queue.pending.length > 0) {
      // The stop follows on the next pass, once `current` has moved onto it.
      dispatchQueue(paused, { type: "next" });
      return;
    }

    // The guard is load-bearing, not defence: the ordinary pause is a run
    // paused on the utterance the cursor is still on, and this effect runs the
    // moment that pause is taken. Without it every pause would supersede
    // itself.
    if (!under || holdingTheCursor) return;

    // Stamped before `stop()` so the abandoned run lands on `ready` rather than
    // `heard` — the order is not what makes it work (`stop()` resolves the
    // pending `play` on a microtask, so the synchronous stamp lands first
    // either way), the outcome is.
    held.outcome = "superseded";
    player.stop();
  }, [dispatchQueue, player.pausedSessionId, player.stop, queueFor]);

  /**
   * Play one named utterance in a cell. Named rather than looked up, because
   * the transport moves the cursor and then plays what it moved onto, and the
   * `utteranceFor` of the render the click happened in still points at where
   * the cursor WAS.
   */
  const speakUtterance = useCallback(
    (sessionId: string, utterance: Utterance): void => {
      const prepared = preparedFor(utterance, languageFor(sessionId));
      if (prepared.units.length === 0) {
        // Defence in depth. `useUtteranceChannel` never announces a response
        // that prepares to nothing, so nothing speakable-looking should reach
        // this — but a cell that somehow does has nothing to say, and leaving it
        // pulsing would be a notification that can never be met.
        markHeard(sessionId);
        return;
      }

      // Barge-in: whatever was speaking is *superseded*, not finished, so it
      // must revert to `unheard`. Stamped before `play`, which stops it.
      const previous = runRef.current;
      if (previous) previous.outcome = "superseded";

      const run: Run = { sessionId, utteranceId: utterance.id, outcome: "pending" };
      runRef.current = run;

      function finish(ended: Run): void {
        if (runRef.current === ended) runRef.current = null;

        // `heard` means the final unit played to its end, and nothing else.
        // Superseded, stopped, refused, failed — every ending that is not the
        // natural one leaves the cell `ready`, because something in it has
        // still not been listened to. A run still `pending` when the promise
        // settles is the only natural end there is.
        if (ended.outcome !== "pending") return;

        // Marks it heard AND moves the queue on — the queue's own "finished",
        // which advances into what is waiting, returns the cursor out of a
        // replay, and does nothing at all when neither applies. The autoplay
        // effect below is what turns that advance into sound, so an unarmed
        // cell ends up simply HOLDING the next answer.
        finishUtterance(ended.sessionId);
      }

      void player
        .play(sessionId, prepared.units)
        .then(() => finish(run))
        .catch(() => finish(run));
    },
    [finishUtterance, languageFor, markHeard, player, preparedFor],
  );

  const speak = useCallback(
    (sessionId: string): void => {
      const utterance = utteranceFor(sessionId);
      if (!utterance) return;
      speakUtterance(sessionId, utterance);
    },
    [speakUtterance, utteranceFor],
  );

  const onSpeak = useCallback(
    (sessionId: string): void => {
      // The click is the gesture the element needs; every later programmatic
      // play rides on it.
      player.unlock();

      // A run always plays the whole answer, so there is never a part-way
      // point to continue from: a click on a cell that has been heard replays
      // it from unit 0. Holding a run part-way is the player's `paused`, and
      // that click reaches `onResume`, never this.
      speak(sessionId);
    },
    [player, speak],
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

  /**
   * The cursor moved under the armed cell, and the move is about to be played
   * here — so it is recorded as already autoplayed, or the effect below would
   * see "the armed cell's utterance changed" and start the same thing twice.
   * Only the armed cell has such a record to corrupt.
   */
  const recordAutoplayed = useCallback(
    (sessionId: string, utteranceId: string): void => {
      if (sessionId === armedSessionId) autoplayedRef.current = utteranceId;
    },
    [armedSessionId],
  );

  const onPrevious = useCallback(
    (sessionId: string): void => {
      const queue = queueFor(sessionId);
      // History is one step deep, so a second press is a no-op — and so is a
      // press on a cell with nothing behind its cursor. The reducer says the
      // same; asking here is what keeps it from making a sound anyway.
      if (queue.cursor === "previous" || queue.previous === null) return;

      player.unlock();
      dispatchQueue(sessionId, { type: "previous" });
      recordAutoplayed(sessionId, queue.previous.id);
      // From its first unit: the transport steps onto a whole answer, never
      // into the middle of the one it was cut off in.
      speakUtterance(sessionId, queue.previous);
    },
    [dispatchQueue, player, queueFor, recordAutoplayed, speakUtterance],
  );

  const onNext = useCallback(
    (sessionId: string): void => {
      const queue = queueFor(sessionId);
      // From history, next means "come back", and what plays is the utterance
      // that was current. Otherwise it means "skip ahead" into what is waiting.
      const returning = queue.cursor === "previous";
      const target = returning ? queue.current : (queue.pending[0] ?? null);
      if (!returning && !target) return;

      player.unlock();
      dispatchQueue(sessionId, { type: "next" });
      if (!target) return;

      recordAutoplayed(sessionId, target.id);
      speakUtterance(sessionId, target);
    },
    [dispatchQueue, player, queueFor, recordAutoplayed, speakUtterance],
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
    speak(armedSessionId);
  }, [armedSessionId, armedUtterance, player.unlocked, speak]);

  return useMemo(
    () => ({
      stateFor,
      queueFor,
      armedSessionId,
      onSpeak,
      onPause,
      onResume,
      onStop,
      onPrevious,
      onNext,
      onArm,
      preparingSessionIds,
    }),
    [
      armedSessionId,
      onArm,
      onNext,
      onPause,
      onPrevious,
      onResume,
      onSpeak,
      onStop,
      preparingSessionIds,
      queueFor,
      stateFor,
    ],
  );
}

export default useSpeechHost;
