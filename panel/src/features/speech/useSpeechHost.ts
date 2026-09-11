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
 * ## Why a run object rather than `await play(); markHeard()`
 *
 * `useSpeechPlayer.play()` resolves the same way for four different endings —
 * the last unit finished, another cell barged in, the user hit stop, or the
 * browser refused the start — because barge-in resolves through
 * `if (isStale()) return;`, which is indistinguishable from a natural end. The
 * four endings need three different outcomes (`design.md` §4's chart):
 *
 * - last unit ended → `Heard`
 * - user clicked stop → `Heard`
 * - another cell took over → `Unheard` (*not* heard — this is the trap)
 * - the browser refused → `Unheard`
 *
 * So the outcome is not read off the promise at all. Each `play` gets a {@link
 * Run} whose `outcome` starts `"pending"`, and whoever *ends* it early stamps
 * it: the incoming play stamps `"superseded"`, the stop handler stamps
 * `"stopped"`, the player's `onError` stamps `"refused"`. A run still `pending`
 * when the promise settles is the only natural end there is.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "../../lib/toast";
import { closingMarkerUnit, prepare } from "./prepare";
import type { PreparedSpeech, Utterance } from "./types";
import { useSpeechPlayer, type SpeechPlaybackError } from "./useSpeechPlayer";
import { useUtteranceChannel } from "./useUtteranceChannel";
import type { GridSpeech } from "../terminal/TerminalLayoutGrid";

/** How a playback ended. `"pending"` until something ends it early. */
type RunOutcome = "pending" | "superseded" | "stopped" | "refused";

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

export function useSpeechHost(): GridSpeech {
  const runRef = useRef<Run | null>(null);
  const resumeRef = useRef<Map<string, ResumePoint>>(new Map());
  // Keyed by utterance id: preparation is pure and the same utterance always
  // prepares the same way, so a replay must not pay for it twice.
  const preparedRef = useRef<Map<string, PreparedSpeech>>(new Map());
  /** The last utterance the armed cell autoplayed, so none is played twice. */
  const autoplayedRef = useRef<string | null>(null);

  const onError = useCallback((error: SpeechPlaybackError): void => {
    // A refusal is NOT a natural end: the cell falls back to `unheard`. This
    // keys off the error's `kind`, never off `player.unlocked` — that flag says
    // a gesture reached the element, not that playback is permitted, and the
    // player never clears it when the browser says no.
    if (error.kind === "refused") {
      const run = runRef.current;
      if (run?.sessionId === error.sessionId) run.outcome = "refused";
      return;
    }

    // A systemic synthesis failure has no pip to fall back to — the player has
    // already stopped — so a toast is the only thing that tells the user the
    // silence is a failure rather than the end of the answer. Every kind must
    // land somewhere: a handler that returns early also suppresses the player's
    // own `console.error` fallback, which only runs when there is no handler.
    toast.error("Speech stopped — the voice could not be synthesized.");
  }, []);

  const player = useSpeechPlayer({ onError });
  // The channel never observes playback, so the player's view of what is
  // speaking has to be handed to it on every render. Forgetting this deletes
  // the `speaking` state from the grid.
  const channel = useUtteranceChannel({ speakingSessionId: player.speakingSessionId });
  const { armedSessionId, languageFor, markHeard, setArmed, stateFor, utteranceFor } = channel;

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

        // Superseded or refused: the cell keeps whatever it had, which is
        // `unheard`. Only a deliberate stop and a real end make it `heard`.
        if (ended.outcome === "superseded" || ended.outcome === "refused") return;

        if (ended.outcome === "pending" && ended.through < ended.total) {
          // The budget cut is not the end of the response. The chart calls
          // this `Paused`; it looks exactly like `Unheard` in the header on
          // purpose, and only the resume point tells them apart.
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
      // A deliberate stop is the opposite of a barge-in: the chart sends it to
      // `Heard`. Stamped before `stop()`, which resolves the pending `play`.
      const run = runRef.current;
      if (run?.sessionId === sessionId) run.outcome = "stopped";
      player.stop();
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
    () => ({ stateFor, armedSessionId, onSpeak, onStop, onArm }),
    [armedSessionId, onArm, onSpeak, onStop, stateFor],
  );
}

export default useSpeechHost;
