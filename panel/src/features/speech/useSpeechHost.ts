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
 * red the control shows before anyone has clicked anything. It is also where
 * the panel-wide bound on that work lives — {@link WARM_CONCURRENCY} — for the
 * third time for the same reason: the channel cannot see the synthesizer and
 * the player cannot see the other cells, so only this module can count what the
 * whole grid has in flight.
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
import type { GridSpeech, PreparedSpeech, SpeechUnit, Utterance } from "./types";
import type { MediaSessionTransportTarget } from "./useMediaSessionTransport";
import { useSpeechPlayer, type SpeechPlaybackError, type SpeechProgress } from "./useSpeechPlayer";
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
 * their audio, and the run-level readings the OS transport needs. The
 * grid-facing contract in `./types` stays as it is — it is consumed by
 * hand-built stubs all over the terminal suites — so the extra channels live
 * here, on the host's own return type.
 *
 * The transport members make this a structural {@link MediaSessionTransportTarget},
 * which is how `SpeechHostProvider` can hand the host straight to
 * {@link useMediaSessionTransport}. They are deliberately NOT on `GridSpeech`:
 * no cell surface may act on another cell's run, and only the one document-wide
 * transport has any business asking which cell that is.
 */
export interface SpeechHost extends GridSpeech, MediaSessionTransportTarget {
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

/**
 * How many warms the WHOLE PANEL may have in flight at once.
 *
 * The per-cell bound is the queue's reach — what is being spoken and what the
 * transport would reach next, so two — and that was the only bound there was.
 * The warm loop walks every warmable utterance in every cell and fires a
 * synthesis for each with no await, so ten busy terminals opened ten edge-tts
 * WebSocket handshakes at once, each with its own DRM token, all competing with
 * the unit the listener is actually waiting for. `SPEECH_STREAM_STALL_TIMEOUT_MS`
 * is 15 s, so the losers stall rather than merely queue.
 *
 * Two, and the rest wait their turn:
 *
 * - It matches the per-cell bound, so a single cell's pair still goes out
 *   together. The common case — one terminal answering — is unchanged, and the
 *   existing per-cell pin keeps meaning what it meant.
 * - Speculation stops growing with the number of terminals. The gate is what
 *   makes the panel's warm cost a constant rather than a function of the grid.
 * - It leaves the listener the larger share. A live run's own cascade is
 *   bounded separately at `SYNTHESIS_CONCURRENCY` = 3 inside the player,
 *   and that one is audio somebody is waiting on; this one is a guess about a
 *   click nobody has made. The guess does not get to outnumber it.
 *
 * Not one: that would serialize a single cell's own pair behind itself and slow
 * the case the warm exists for. Not four or more: two cells' speculation would
 * then match or beat the live cascade, which is the ratio being fixed.
 */
const WARM_CONCURRENCY = 2;

/** Shared so a panel with nothing warming does not allocate a Set per render. */
const NOTHING_PREPARING: ReadonlySet<string> = new Set<string>();

/** Shared, for the same reason: a cell with nothing in it has no segments… */
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
/** …and a cell that is not the one running has measured nothing. */
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();

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
  /**
   * The utterance the player was last handed. Not `runRef`, which is nulled the
   * moment a run ends: the measurements outlive the run, and this is what says
   * whose they are.
   */
  const playingUtteranceRef = useRef<string | null>(null);
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
  /**
   * The panel-wide warm gate: how many warms are in flight, and the ones still
   * waiting for a slot. See {@link WARM_CONCURRENCY}.
   *
   * A ref rather than a module-level counter, and that IS panel-wide: this hook
   * is hosted exactly once per panel (`SpeechHostProvider`), which is the same
   * reason the player's single `<audio>` element lives here. Holding it on the
   * instance also means a host that unmounts takes its gate with it, rather
   * than leaving a stuck slot behind for the next one.
   */
  const warmGateRef = useRef<{ active: number; waiting: Array<() => void> }>({
    active: 0,
    waiting: [],
  });

  /**
   * Runs a warm now if the panel has a slot, and otherwise queues it in arrival
   * order. The slot is released on EVERY ending — a warm that failed is not a
   * warm that is still running, and a gate closed by a swallowed rejection
   * would stop the panel warming anything ever again.
   */
  const runWarm = useCallback((warm: () => Promise<void>): void => {
    const gate = warmGateRef.current;

    const start = (): void => {
      gate.active += 1;
      void warm().then(
        () => {
          release();
        },
        () => {
          release();
        },
      );
    };

    const release = (): void => {
      gate.active -= 1;
      const next = gate.waiting.shift();
      if (next) next();
    };

    if (gate.active < WARM_CONCURRENCY) start();
    else gate.waiting.push(start);
  }, []);
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
  /**
   * Destructured on purpose, and depended on **as methods** everywhere below —
   * never as `player`.
   *
   * `useSpeechPlayer` memoizes its return value on `progress` and
   * `unitDurations`, so the player OBJECT changes identity on every
   * `timeupdate`: roughly 4 Hz while anything is speaking. Each of its methods
   * is individually `useCallback`-stable, so a callback that names the methods
   * it uses is stable too — while one that names `player` inherits the whole
   * churn. Nine of the callbacks below did, which handed 4 Hz back to the
   * `GridSpeech` memo and re-rendered every bar in the grid through the
   * `speech` prop — precisely what moving the playhead onto an external store
   * was done to prevent. `useSpeechHost.identity.test.tsx` is the pin.
   *
   * The readings in here are state, not methods, and they change on run
   * transitions rather than on the clock: a host identity that moves when a
   * cell starts or stops speaking is the point of those fields.
   */
  const {
    pause: pausePlayback,
    pausedSessionId,
    play: playUnits,
    progress,
    resume: resumePlayback,
    // Handed out under the transport's own name and otherwise untouched: it
    // takes seconds and nothing else, because a seek has exactly one possible
    // subject — the run in the element — and no session to guard against.
    seekBackward: onSeekBackward,
    seekWithinUnit: seekPlaybackWithinUnit,
    speakingSessionId,
    stop: stopPlayback,
    unitDurations,
    unlock,
    unlocked,
    waitingForSynthesis,
  } = player;
  // The channel never observes playback or synthesis, so everything it needs to
  // know about either has to be handed to it on every render. Forgetting one of
  // these deletes that state from the grid.
  const channel = useUtteranceChannel({
    speakingSessionId,
    pausedSessionId,
    waitingForSynthesis,
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

      // Through the panel-wide gate, which runs this now or queues it behind at
      // most {@link WARM_CONCURRENCY} others. The red above is set OUTSIDE the
      // gate on purpose: a cell waiting for a slot is a cell waiting for its
      // audio, and which side of the gate it is waiting on is not the user's
      // question.
      //
      // `synthesizeSpeech` rather than `prefetchSpeech`: the promise is the
      // whole point here — it is what says when the cell stops being red, and
      // now also what says when the next warm may start — and a
      // fire-and-forget warm cannot be reported on. The failure is swallowed
      // exactly as `prefetchSpeech` swallows it.
      runWarm(() =>
        // The voice is the one the click will use, from the same source
        // `useSpeechPlayer` reads, and it is read HERE rather than at the point
        // the warm was queued: a warm that waited out a voice change should
        // synthesize the voice the click is now going to want. The cache keys
        // on voice + text, so warming with any other one is a synthesis nobody
        // ever plays.
        synthesizeSpeech(first.text, { voice: getStoredVoice() })
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
          }),
      );
    }
    // Warming reads nothing from the player any more: the supersession that
    // used to ride along inside this loop is its own effect below, because it
    // is about the QUEUE rather than about the cache, and a loop over every
    // speakable utterance in the panel was never the honest place to ask "is
    // this one cell's held run stale".
  }, [languageFor, preparedFor, runWarm, setPreparing, warmableUtterances]);

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
    const paused = pausedSessionId;
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
    if (holdingTheCursor && queue.cursor === 0 && queue.pending.length > 0) {
      // The stop follows on the next pass, once `current` has moved onto it.
      dispatchQueue(paused, { type: "next" });
      return;
    }

    // The guard is load-bearing, not defence: the ordinary pause is a run
    // paused on the utterance the cursor is still on, and this effect runs the
    // moment that pause is taken. Without it every pause would supersede
    // itself.
    //
    // It now carries a second case the shape of the queue handed it. A paused
    // replay of HISTORY used to be superseded here by accident: an idle
    // arrival reset the cursor to `current`, the held run stopped matching it,
    // and the stop below fired. The list-shaped queue deliberately stopped
    // doing that — the cursor follows its own utterance down the history — so
    // the held run is still exactly what the cursor is on, and there is
    // nothing stale to abandon. Leaving it alone is the point rather than an
    // omission: a listener who stepped back to an older answer and paused it
    // has not asked to be returned to the front every time the agent answers
    // again, and the arrival is one forward press away rather than hostage to
    // anything.
    if (!under || holdingTheCursor) return;

    // Stamped before `stop()` so the abandoned run lands on `ready` rather than
    // `heard` — the order is not what makes it work (`stop()` resolves the
    // pending `play` on a microtask, so the synchronous stamp lands first
    // either way), the outcome is.
    held.outcome = "superseded";
    stopPlayback();
  }, [dispatchQueue, pausedSessionId, queueFor, stopPlayback]);

  /**
   * Play one named utterance in a cell. Named rather than looked up, because
   * the transport moves the cursor and then plays what it moved onto, and the
   * `utteranceFor` of the render the click happened in still points at where
   * the cursor WAS.
   */
  const speakUtterance = useCallback(
    (sessionId: string, utterance: Utterance, fromUnit = 0): void => {
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
      playingUtteranceRef.current = utterance.id;

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

      // `fromUnit` is the segment click's whole implementation: the player
      // already takes a starting unit, and starting there is what a jump IS.
      // Clamped, because the index comes off a rendered scrubber and a stale
      // render could name a unit a newer, shorter utterance does not have.
      void playUnits(
        sessionId,
        prepared.units,
        Math.min(Math.max(0, fromUnit), prepared.units.length - 1),
      )
        .then(() => finish(run))
        .catch(() => finish(run));
    },
    [finishUtterance, languageFor, markHeard, playUnits, preparedFor],
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
      unlock();

      // A run always plays the whole answer, so there is never a part-way
      // point to continue from: a click on a cell that has been heard replays
      // it from unit 0. Holding a run part-way is the player's `paused`, and
      // that click reaches `onResume`, never this.
      speak(sessionId);
    },
    [speak, unlock],
  );

  const onStop = useCallback(
    (sessionId: string): void => {
      // A deliberate stop lands where a barge-in lands: `Ready`. It was the
      // one exception, and the amendment removed it — a run the user cut short
      // never reached its last unit, so it was not listened to. Stamped before
      // `stop()`, which resolves the pending `play`.
      const run = runRef.current;
      if (run?.sessionId === sessionId) run.outcome = "stopped";
      stopPlayback();
    },
    [stopPlayback],
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
      if (speakingSessionId !== sessionId) return;
      pausePlayback();
    },
    [pausePlayback, speakingSessionId],
  );

  const onResume = useCallback(
    (sessionId: string): void => {
      if (pausedSessionId !== sessionId) return;
      // Deliberately NOT `player.unlock()`: the element is holding the paused
      // unit, so unlocking would play it here rather than through `resume()` —
      // and the gesture was already spent on the click that started the run.
      resumePlayback();
    },
    [pausedSessionId, resumePlayback],
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
      // What the press lands on: the cursor one step further back, read off
      // the queue as it stands now because the dispatch below has not been
      // applied to this value yet. Asking `utteranceUnderCursor` rather than
      // indexing `previous` here keeps the cursor's meaning in the file that
      // owns it — and reading `previous[0]` instead would quietly replay the
      // newest step of history however deep the listener had walked.
      //
      // Nothing there is a press with nothing behind it: the cursor is already
      // on the oldest answer the cell holds, or the cell has no history at
      // all. The reducer says the same; asking here is what keeps a refused
      // press from making a sound anyway.
      const target = utteranceUnderCursor({ ...queue, cursor: queue.cursor + 1 });
      if (!target) return;

      unlock();
      dispatchQueue(sessionId, { type: "previous" });
      recordAutoplayed(sessionId, target.id);
      // From its first unit: the transport steps onto a whole answer, never
      // into the middle of the one it was cut off in.
      speakUtterance(sessionId, target);
    },
    [dispatchQueue, queueFor, recordAutoplayed, speakUtterance, unlock],
  );

  const onNext = useCallback(
    (sessionId: string): void => {
      const queue = queueFor(sessionId);
      // From history, next means "come back" — one step towards the newest
      // answer, which is the step in between rather than `current` whenever
      // the listener has walked further than one back. Otherwise it means
      // "skip ahead" into what is waiting.
      const returning = queue.cursor > 0;
      const target = returning
        ? utteranceUnderCursor({ ...queue, cursor: queue.cursor - 1 })
        : (queue.pending[0] ?? null);
      if (!returning && !target) return;

      unlock();
      dispatchQueue(sessionId, { type: "next" });
      if (!target) return;

      recordAutoplayed(sessionId, target.id);
      speakUtterance(sessionId, target);
    },
    [dispatchQueue, queueFor, recordAutoplayed, speakUtterance, unlock],
  );

  /**
   * The scrubber's segments: the units of the utterance the cell's cursor is
   * on. Preparation is memoized per utterance id and costs no synthesis, so
   * calling this on every render of every cell is a Map lookup after the first
   * — and it is what lets the bar draw the whole response before a single unit
   * has been synthesized.
   */
  const unitsFor = useCallback(
    (sessionId: string): readonly SpeechUnit[] => {
      const utterance = utteranceUnderCursor(queueFor(sessionId));
      if (!utterance) return NO_UNITS;
      return preparedFor(utterance, languageFor(sessionId)).units;
    },
    [languageFor, preparedFor, queueFor],
  );

  /**
   * The playhead is an EXTERNAL STORE, not a field on the value this hook
   * returns.
   *
   * `player.progress` moves on every `timeupdate` — roughly 4 Hz. Returned as a
   * field it would change this object's identity at that rate, and since one
   * host serves the whole panel, every cell in the grid would re-render four
   * times a second for the one cell that is speaking. So the three moving
   * readings are mirrored into refs, the callbacks below read those refs rather
   * than the moving values, and subscribers are told when something moved. A
   * bar whose own snapshot did not change — every cell but the speaking one —
   * is not re-rendered at all.
   *
   * The refs are half of it. The other half is that nothing else in the
   * returned object may move at that rate either, which is why the player is
   * destructured at the top of this hook: a callback that depends on `player`
   * depends on `progress`, and the whole saving is gone. Both halves are pinned
   * by `useSpeechHost.identity.test.tsx`.
   *
   * `progressFor` is `[]`-stable; `unitDurationsFor` depends on `queueFor`,
   * because measurements belong to an utterance rather than to a cell and the
   * cursor is what says which utterance the bar is on. `queueFor` moves when a
   * queue does, which is not on the clock.
   */
  const progressListeners = useRef<Set<() => void>>(new Set());
  const progressRef = useRef<SpeechProgress | null>(null);
  const measuredRef = useRef<ReadonlyMap<number, number>>(NO_DURATIONS);
  const speakingRef = useRef<string | null>(null);
  /**
   * The UTTERANCE the mirrored durations were measured for — never merely the
   * cell. A duration map is keyed by unit INDEX, and an index means nothing
   * without the utterance it indexes into: unit 0 of the answer that just
   * finished and unit 0 of the answer that just arrived are both `0`. Keyed by
   * cell alone, a never-played answer inherited the finished one's timings, and
   * `SpeechControlBar` reads `durations.has(index)` as "played" — so the first
   * segment of an answer nobody had heard rendered as already spoken.
   *
   * Not `speakingSessionId`, and not `runRef`, both of which go null the moment
   * a run ends: the measurements outlive the run, and a scrubber that collapsed
   * back to character estimates the instant the audio stopped would throw away
   * everything it had just learned.
   *
   * Assigned HERE rather than in `speakUtterance`, in the same pass that
   * mirrors the map, so this ref and {@link measuredRef} always move together
   * — that much is structural, both being written by the one effect below.
   *
   * What makes the PAIR honest is not that, though, and it is worth saying
   * plainly because the obvious argument is circular: the value copied in is
   * `playingUtteranceRef`, which `speakUtterance` writes EAGERLY, during the
   * click. If the player's map outlived that click by even one render, this
   * effect would stamp the new utterance's id onto the old utterance's
   * seconds — exactly the bug `9f5b71a` fixed, a never-played answer rendering
   * as already played.
   *
   * It does not, and the reason is in `useSpeechPlayer.play`: a play for a
   * different utterance (or a different cell) drops `unitDurations`
   * SYNCHRONOUSLY, inside the same call `speakUtterance` makes immediately
   * after writing `playingUtteranceRef`. Both land in one React batch, so the
   * first pass of this effect after a barge-in already sees the cleared map.
   * There is no render in between to catch, on any of the three routes onto a
   * new utterance — `onNext`, `onJumpToUnit`, or an arrival superseding a
   * paused run. `useSpeechHost.durations.test.tsx` records every intermediate
   * pass across a live barge-in and pins that; deferring the player's clear by
   * a single tick turns it red.
   *
   * Not `speakUtterance`'s own eager write, then, but that write plus the
   * player's synchronous clear — and the gate in `unitDurationsFor`, which
   * refuses a map whose utterance is not the one under the cursor, is the belt
   * to those braces.
   */
  const measuredUtteranceRef = useRef<string | null>(null);

  useEffect(() => {
    progressRef.current = progress;
    measuredRef.current = unitDurations;
    speakingRef.current = speakingSessionId;
    if (speakingSessionId) measuredUtteranceRef.current = playingUtteranceRef.current;
    for (const listener of progressListeners.current) listener();
  }, [progress, speakingSessionId, unitDurations]);

  const subscribeProgress = useCallback((listener: () => void): (() => void) => {
    progressListeners.current.add(listener);
    return () => {
      progressListeners.current.delete(listener);
    };
  }, []);

  const progressFor = useCallback(
    (sessionId: string): SpeechProgress | null =>
      speakingRef.current === sessionId ? progressRef.current : null,
    [],
  );

  /**
   * The measurements the cell's scrubber may draw with — and only the ones that
   * were taken FROM the utterance it is drawing. The segments come from
   * `utteranceUnderCursor`, so the durations have to be gated on the same
   * utterance or the two disagree about what unit `n` is.
   *
   * Still a stable snapshot for `useSyncExternalStore`: both arms return a
   * value that outlives the call — the shared empty map, or the map the player
   * published — never a fresh one.
   */
  const unitDurationsFor = useCallback(
    (sessionId: string): ReadonlyMap<number, number> => {
      const under = utteranceUnderCursor(queueFor(sessionId));
      if (!under || under.id !== measuredUtteranceRef.current) return NO_DURATIONS;
      return measuredRef.current;
    },
    [queueFor],
  );

  const onJumpToUnit = useCallback(
    (sessionId: string, unitIndex: number): void => {
      const utterance = utteranceUnderCursor(queueFor(sessionId));
      if (!utterance) return;

      unlock();
      // NOT `player.jumpToUnit`, for two independent reasons, either of which
      // on its own would be enough:
      //
      // 1. It is a no-op for a cell that has never spoken in this tab — the
      //    player learns a session's units from `play` and from nothing else,
      //    while the scrubber's segments exist from the moment the utterance
      //    ARRIVES. A segment that silently does nothing is the worst outcome
      //    the bar can produce, and that is precisely what it would be on the
      //    very first click of every cell.
      // 2. It reaches `play` behind this module's back, so the run it
      //    supersedes would resolve still stamped `pending` — the one outcome
      //    that means "played to its end" — and the cell would be marked
      //    HEARD by a click that restarted it.
      //
      // Going through `speakUtterance` fixes both at once: it knows the
      // utterance, it prepares its units, and it stamps the outgoing run
      // `superseded` before starting the new one.
      speakUtterance(sessionId, utterance, unitIndex);
    },
    [queueFor, speakUtterance, unlock],
  );

  const onSeekWithinUnit = useCallback(
    (sessionId: string, seconds: number): void => {
      // The drag is only meaningful on the segment that is in the element, and
      // only this cell's run has one. A stray call from any other bar must not
      // move a run the user did not touch.
      if (speakingSessionId !== sessionId) return;
      seekPlaybackWithinUnit(seconds);
    },
    [seekPlaybackWithinUnit, speakingSessionId],
  );

  const onArm = useCallback(
    (sessionId: string | null): void => {
      // Arming is a click too, and it is the gesture the autoplay that follows
      // will need — so it is spent on the element here rather than lost.
      unlock();
      setArmed(sessionId);
    },
    [setArmed, unlock],
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

    if (!unlocked) {
      // No gesture has reached the element yet, so the browser would refuse
      // this anyway — and a tab that has just hydrated `/api/speech/latest`
      // must not start talking on its own. Absorb it: it is old news by the
      // time the user does click something.
      autoplayedRef.current = armedUtterance.id;
      return;
    }

    autoplayedRef.current = armedUtterance.id;
    speak(armedSessionId);
  }, [armedSessionId, armedUtterance, speak, unlocked]);

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
      unitsFor,
      subscribeProgress,
      progressFor,
      unitDurationsFor,
      onJumpToUnit,
      onSeekWithinUnit,
      preparingSessionIds,
      // The three the OS transport reads. They are run-level state, so they
      // move this object's identity when a run starts, is held or ends — which
      // is exactly when every cell's state changed anyway. Not on the 4 Hz
      // clock: `progress` and `unitDurations` stay out on the store, and
      // `useSpeechHost.identity.test.tsx` is the pin that says so.
      speakingSessionId,
      pausedSessionId,
      onSeekBackward,
    }),
    [
      armedSessionId,
      onArm,
      onJumpToUnit,
      onNext,
      onPause,
      onPrevious,
      onResume,
      onSeekBackward,
      onSeekWithinUnit,
      onSpeak,
      onStop,
      pausedSessionId,
      preparingSessionIds,
      progressFor,
      queueFor,
      speakingSessionId,
      stateFor,
      subscribeProgress,
      unitDurationsFor,
      unitsFor,
    ],
  );
}

export default useSpeechHost;
