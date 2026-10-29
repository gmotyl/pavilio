/**
 * The one place the channel and the player meet.
 *
 * Hosted **once per panel**, never per surface and never per cell: the player
 * owns a single `<audio>` element, so a second host would be a second element
 * and "only one thing speaks" would stop being structural. Two surfaces can be
 * on screen at once (ProjectView's and the terminal drawer's), so this hook has
 * exactly one call site — `SpeechHostProvider` — and surfaces read its value
 * from context. The channel is hoisted with it so every cell in the panel reads
 * the same speech modes and the same state.
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
 * that work is ranked and called off, for the third time for the same reason:
 * the channel cannot see the synthesizer and the player cannot see the other
 * cells. Unit 0 of an arrival goes out on anytts' `warm` tier and an armed
 * cell's remainder on `preload`, both behind the player's `run`; the library's
 * scheduler bounds and orders them. What only this module knows is when an
 * utterance stops being wanted — heard, out of the queue, its cell disarmed —
 * so it holds two `AbortController`s per utterance and aborts them then: one
 * for unit 0's warm, which only heard, out of the queue and unmount call off —
 * an off cell still warms unit 0 — and one for the armed remainder, which a
 * disarm or a failed preload calls off as well.
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
 * - the synthesizer gave up → `Ready`, plus an error alert
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
import { alerts } from "../alerts/store";
import { createAutoplayQueue, type AutoplayQueue } from "./autoplayQueue";
import { isDocSpeechKey } from "./docKey";
import { speechFailureAlert } from "./failureAlert";
import { prepare } from "./prepare";
import { pageSpeechText, preparePageText } from "./pageText";
import { loadPageList, pageUnitState, prunePage } from "./pageCache";
import { isSpeechSynthesized } from "./synth";
import { unitAudio } from "./unitAudio";
import type { GridSpeech, PreparedSpeech, SpeechUnit, Utterance } from "./types";
import type { MediaSessionTransportTarget } from "./useMediaSessionTransport";
import { useSpeechPlayer, type SpeechPlaybackError, type SpeechProgress } from "./useSpeechPlayer";
import { useUtteranceChannel } from "./useUtteranceChannel";
import { stepsOffTheWave, stepsOntoTheWave } from "./waveStep";
import { MAX_PENDING, MAX_PREVIOUS, utteranceUnderCursor } from "./utteranceQueue";

/**
 * How many utterances an autoplay cell's record keeps.
 *
 * The record is only ever asked about the utterance UNDER THE CURSOR, and the
 * cursor can only ever land on an utterance the queue holds — its history, the
 * answer it is on, and the ones waiting behind it. That is
 * `MAX_PREVIOUS + 1 + MAX_PENDING` at its very widest, so an id older than the
 * newest eleven recorded has fallen out of the queue's reach and can never be
 * asked about again. The same argument bounds the channel's `heard` set, and
 * for the same reason: unbounded, this would grow for as long as one cell
 * stays in autoplay.
 *
 * Derived from the queue's own constants rather than written as `11`, so a
 * deeper history cannot silently make the record too short.
 */
const MAX_AUTOPLAYED = MAX_PREVIOUS + 1 + MAX_PENDING;

/**
 * Records that autoplay has no further business with this utterance, dropping
 * the oldest record once the bound is reached.
 *
 * Re-recording moves an id to the newest end: a `Set` keeps insertion order,
 * and an utterance the transport has just landed on again is the last one that
 * should be forgotten.
 */
function rememberAutoplayed(remembered: Set<string>, utteranceId: string): void {
  remembered.delete(utteranceId);
  remembered.add(utteranceId);
  for (const oldest of remembered) {
    if (remembered.size <= MAX_AUTOPLAYED) break;
    remembered.delete(oldest);
  }
}

/** anytts rejects an aborted caller, queued or in flight, with an `AbortError`. */
function isAbortError(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === "AbortError";
}

/**
 * One utterance's claim on the synthesizer, as two signals.
 *
 * `warm` is unit 0's, and it is NOT the preloads'. An off cell still warms unit
 * 0 ("The first unit is warmed before it is asked for"), so a disarm — or a
 * preload that failed — must not call it off: with one shared controller it
 * did, the cell went green, and unit 0 was never warmed again. Only an
 * utterance that is heard, leaves the queue, or outlives its host loses it.
 *
 * `preload` is the armed remainder's, created on its first preload unit and
 * dropped (`null`) when a disarm or a failure calls it off, so the next pass
 * requests the units again on a fresh one.
 */
interface UtteranceSynthesis {
  readonly sessionId: string;
  warm: AbortController | null;
  preload: AbortController | null;
}

/**
 * How a playback ended. `"pending"` until something ends it early, and only a
 * run that is still `"pending"` when its promise settles is a natural end.
 *
 * `"failed"` is the run the synthesizer killed. It resolves its promise exactly
 * like a finished answer, so without the stamp it would be indistinguishable
 * from having been listened to — silence, and a cell marked heard. It is not
 * `"refused"`: that one is the browser declining, and it is deliberately
 * alert-free.
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
/**
 * Page speech: an open markdown page spoken through this host, keyed by its
 * `doc:` key (`docKey.ts`). The page's utterance is built here, in the
 * browser, and landed locally — no answer alert, no notification, nothing to
 * the server — then spoken exactly as a click on a cell would speak it.
 */
export interface PageSpeech {
  /**
   * Lands the page's text — its markdown source minus any leading frontmatter
   * (`pageSpeechText`) — as its key's one utterance (id = that text's hash)
   * and starts it: unit 0 is asked for at once, the key is preparing until it
   * is in hand, and whatever else was speaking is barged in on.
   *
   * `startUnit` starts the run there instead of at unit 0 — the ▶ on a page
   * block. Clamped into the page's units (a non-number reads as 0), as a
   * segment click is. With the page already playing it is a jump: the same
   * utterance restarts at that unit, as a segment click restarts it.
   */
  speakDocument(input: { key: string; text: string; startUnit?: number }): void;
  /** Stops the page's run, if it holds the element, and forgets the page. */
  stopDocument(key: string): void;
}

export interface SpeechHost extends GridSpeech, MediaSessionTransportTarget, PageSpeech {
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

export interface SpeechHostOptions {
  /**
   * Every speakable answer the channel takes up; `recovered` for one read off
   * `/latest` rather than a live frame. See `UtteranceChannelOptions.onAnswer`.
   */
  onAnswer?: (utterance: Utterance, recovered: boolean) => void;
  /**
   * False for a session the panel knows has closed. The channel never forgets a
   * session, so this is the only way the idle transport learns a cell is gone.
   * Absent: every session counts as open.
   */
  isSessionOpen?: (sessionId: string) => boolean;
  /**
   * Told when the voice starts, is held, continues or falls silent — whichever
   * cell it is in and whoever started it. See {@link SpeechRunEvent}.
   */
  onRunChange?: (event: SpeechRunEvent) => void;
  /**
   * The voice a session speaks with. One port for the player's runs and the
   * host's warms and preloads alike: the synthesis cache keys on voice + text,
   * so a warm in any other voice is a synthesis the click never finds.
   */
  voiceFor: (sessionId: string) => string;
  /**
   * The cell's answer-waiting state: the hold on the text and the wave. See
   * {@link AnswerWaitingPort}.
   */
  answerWaiting: AnswerWaitingPort;
}

/**
 * What the host reads off a cell's wait for an answer — structurally the
 * terminal's `AnswerWaitingSnapshot`, restated here so speech imports nothing
 * from the terminal.
 */
interface AnswerWaitingView {
  /** The pane's body has handed over to the waiting state. */
  readonly waiting: boolean;
  /** A reply to a draft this cell sent is still expected. */
  readonly pending: boolean;
}

/**
 * The answer-waiting store, as the host reaches it. The store lives with the
 * terminal because the wave is the CELL's state, not the voice's — but the
 * wave STEP belongs here, in the one place every transport surface funnels
 * through. See `onPrevious`, and its note on why `get` is asked before
 * `noteTransport`.
 */
export interface AnswerWaitingPort {
  get(sessionId: string): AnswerWaitingView;
  hold(sessionId: string): void;
  release(sessionId: string): void;
  noteTransport(sessionId: string): void;
  isHeld(sessionId: string): boolean;
}

/**
 * What the voice is doing, for whatever has to follow it around the panel (the
 * speaking alert, `speakingAlert.ts`).
 *
 * - `start` — a run started in `sessionId`, manual or autoplay. A barge-in is a
 *   `start` with no `end` before it: the run it replaced is not the voice any
 *   more, but the voice did not stop.
 * - `pause` / `resume` — the run was held, and continues.
 * - `end` — the voice fell silent, however the run ended: played out, stopped,
 *   refused, failed. Reported only once the autoplay queue has had its turn, so
 *   a queued answer that starts straight after is a `start` without an `end`
 *   in between — what follows the voice can update in place rather than leave
 *   and come back.
 */
export type SpeechRunEvent =
  | { type: "start"; sessionId: string }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "end" };

/**
 * A page utterance's id: the FNV-1a hash of its key and its text, so pressing
 * Play on an unchanged page lands the same utterance — and finds its
 * preparation and its synthesis — while an edited page lands a new one, and
 * two pages that happen to hold the same text never share an id (nor the
 * abort, warm and heard state keyed on it).
 */
function pageUtteranceId(key: string, text: string): string {
  const input = `${key}\u0000${text}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `doc-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Every session counts as open when the panel says nothing about it. */
const ALWAYS_OPEN = (): boolean => true;

export function useSpeechHost({
  onAnswer,
  isSessionOpen = ALWAYS_OPEN,
  onRunChange,
  voiceFor,
  answerWaiting,
}: SpeechHostOptions): SpeechHost {
  /**
   * `onRunChange`, mirrored: it is called from inside `speakUtterance`, whose
   * identity the whole grid depends on, so it must not be a dependency.
   */
  const onRunChangeRef = useRef(onRunChange);
  useEffect(() => {
    onRunChangeRef.current = onRunChange;
  }, [onRunChange]);
  /**
   * `voiceFor`, mirrored for the same reason: the warm and the preload read it,
   * and their identities must not follow the caller's callback.
   */
  const voiceForRef = useRef(voiceFor);
  useEffect(() => {
    voiceForRef.current = voiceFor;
  }, [voiceFor]);
  /**
   * `answerWaiting`, mirrored for the same reason: `onPrevious` and `onNext`
   * are transport identities the grid and the media keys hold on to.
   */
  const answerWaitingRef = useRef(answerWaiting);
  useEffect(() => {
    answerWaitingRef.current = answerWaiting;
  }, [answerWaiting]);
  /**
   * The run that held the element ended, and whether the voice has fallen
   * silent is still to be settled: the autoplay queue gets its turn first. See
   * the `end` effect below the autoplay effect.
   */
  const endPendingRef = useRef(false);
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
  /**
   * Each autoplay cell's utterances that autoplay is done with, so none is
   * played twice. One record per cell in autoplay — keyed by session, created
   * when the cell enters autoplay and dropped when it leaves.
   *
   * A SET rather than the one slot it used to be, because the records are no
   * longer all about the utterance under the cursor. A catch-up records the
   * answer it RECOVERED, which a speaking or paused cell queues behind the live
   * run and which a cursor parked in the history is not on — so a single slot
   * was overwritten with an id the guard never compares against, leaving the
   * cursor's own utterance unrecorded and the effect free to start it again:
   * the live run restarted from unit 0, and a silent step back spoke the answer
   * it had stepped onto. One record per utterance is the honest shape for a
   * question asked per utterance. Bounded by {@link MAX_AUTOPLAYED}.
   */
  const autoplayedRef = useRef<Map<string, Set<string>>>(new Map());
  /** Utterance ids whose first unit has been warmed, so none is warmed twice. */
  const warmedRef = useRef<Set<string>>(new Set());
  /**
   * The warm each session is CURRENTLY waiting on, by the signal it carries, so
   * a warm that a newer utterance superseded cannot report the cell ready when
   * it lands — the click would play the newer unit, which is still in flight.
   * The signal rather than the utterance id: a remount warms the same utterance
   * again on a fresh controller, and the aborted first warm landing late must
   * not clear the red the second one set.
   */
  const warmingRef = useRef<Map<string, AbortSignal>>(new Map());
  /**
   * The controllers of every utterance with a warm or preload out, keyed by
   * utterance id (see {@link UtteranceSynthesis}). anytts queues at call time,
   * so "is this still wanted?" is no longer asked when a job starts but
   * answered for the utterance's whole lifetime: both controllers are aborted
   * when the utterance is heard, leaves the queue, and on unmount; the preload
   * one alone when its cell is disarmed or a preload unit fails. A queued job
   * with no caller left is dropped without touching the network; one in flight
   * is closed once nobody holds it (the player's run may still).
   *
   * Per host, and that is panel-wide: this hook is hosted exactly once per
   * panel (`SpeechHostProvider`).
   */
  const synthesesRef = useRef<Map<string, UtteranceSynthesis>>(new Map());
  /**
   * Preload units already requested, as `utteranceId#index`, so a re-render
   * does not request the same unit twice. A unit whose utterance was called
   * off is taken back out, so arming the cell again reaches it.
   */
  const preloadedRef = useRef<Set<string>>(new Set());
  /**
   * The subset of `preloadedRef` that reached the library — since anytts
   * queues at call time, every one of them the moment it is requested. Kept as
   * its own set because it is what the eviction check below asks about.
   */
  const preloadStartedRef = useRef<Set<string>>(new Set());
  /**
   * Utterances whose preload a failed unit stopped, per session. A ref rather
   * than a local of `preloadRemainder`, because that function runs again on
   * every arrival anywhere in the grid and on every mode change: a stop held
   * only for one call would walk a down synthesizer through the rest of the
   * answer the next time any cell spoke. Cleared at the start of each
   * warming-effect run — an arrival, a mode change or a catch-up is the next
   * opportunity, and the one retry — and bounded per cell like the autoplay record, for the same reason:
   * an older answer than that is out of the queue's reach.
   */
  const preloadFailedRef = useRef<Map<string, Set<string>>>(new Map());
  /**
   * The answers autoplay cells are owed, across the grid, in arrival order —
   * see `autoplayQueue.ts`. Per host for the same reason as the controllers: there
   * is one host per panel, and one element for it to speak through.
   */
  const [autoplayQueue] = useState<AutoplayQueue>(createAutoplayQueue);
  /**
   * Bumped every time a run ends, however it ended: the autoplay queue's turn
   * signal. A ref would not do — the queue must be asked AFTER the ending's
   * own state (the cell marked heard, its backlog advanced) has rendered, and
   * a state update lands in the same batch as `finishUtterance`.
   */
  const [runEnds, setRunEnds] = useState(0);
  const [preparingSessionIds, setPreparingSessionIds] =
    useState<ReadonlySet<string>>(NOTHING_PREPARING);
  /**
   * The cell the player was last handed a run for, however that run ended —
   * the transport's idle target once no autoplay cell is owed an answer
   * (`idleTransportTarget.ts`). State, not a ref: the transport reads it off
   * this host's value, which has to move when it does.
   */
  const [lastSpokenSessionId, setLastSpokenSessionId] = useState<string | null>(null);
  /**
   * The cell whose transport was last stepped by hand (next / previous), until
   * the next run starts — the idle transport's first pick, so a step that
   * moves a cell's cursor onto a heard answer does not hand the following
   * press to another cell. See `idleTransportTarget.ts`.
   */
  const [steppedSessionId, setSteppedSessionId] = useState<string | null>(null);

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
    // already stopped — so an alert is the only thing that tells the user the
    // silence is a failure rather than the end of the answer. Every kind must
    // land somewhere: a handler that returns early also suppresses the player's
    // own `console.error` fallback, which only runs when there is no handler.
    // Worded by the TtsError the player carries as `cause`, when there is one.
    alerts.error(speechFailureAlert(error));
  }, []);

  const player = useSpeechPlayer({ onError, voiceFor });
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
   * was done to prevent. `useSpeechHost.preload.test.ts` (identity) is the pin.
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
  /**
   * The cursor moved under an autoplay cell, and whatever that move is owed has
   * been settled HERE — so the utterance it landed on is recorded as already
   * autoplayed, and the autoplay effect does not act on it a second time.
   *
   * Three callers, for what read as three different reasons and are really one.
   * In `onNext` the move IS played there, so without this record the effect
   * would see "the autoplay cell's utterance changed" and start the same answer
   * twice. In `onPrevious` the move is deliberately NOT played — and the record
   * is what makes that stick, because the effect watches the utterance under
   * the cursor and a backward step changes it exactly as an arrival would. Drop
   * the call there and the autoplay cell speaks the answer the user stepped back
   * to read, through the autoplay path rather than the transport's; the press
   * is silent everywhere except the one state Greg actually listens in. And the
   * channel's catch-up calls it for an answer recovered after a reconnect,
   * where the effect would otherwise ABSORB the arrival — returning to the
   * application is no gesture — and lose its spoken form for good (ADR 0017).
   *
   * Those three callers name the utterance the cursor LANDED on; the catch-up
   * names one that may be queued behind a live run or sitting in front of a
   * cursor parked in the history. That is why the record is a set: it has to
   * hold what the cursor is on and what was recovered at the same time.
   *
   * So this is not "mark it played". Nothing about `heard`, the unplayed count
   * or the pips passes through here — those are `markHeard` / `finishUtterance`
   * — and a silent step leaves every one of them alone. It is narrower than its
   * name: *autoplay has no further business with this utterance*. Only the
   * autoplay cell has such a record to corrupt.
   *
   * Declared above the channel, which is where the autoplay cells come from, so
   * it reads the per-cell records rather than the modes — and is stable for the
   * whole life of the host, which is what keeps the channel's catch-up effect
   * off it.
   */
  const recordAutoplayed = useCallback((sessionId: string, utteranceId: string): void => {
    const record = autoplayedRef.current.get(sessionId);
    if (record) rememberAutoplayed(record, utteranceId);
  }, []);

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
    // A catch-up after a reconnect is SHOWN, never spoken: see ADR 0017.
    recordAutoplayed,
    onAnswer,
  });
  const {
    arriveLocal,
    autoplaySessionIds,
    cycleSpeechMode: cycleChannelSpeechMode,
    dispatchQueue,
    drop: dropKey,
    finishUtterance,
    heardFor,
    languageFor,
    markHeard,
    queueFor,
    speechModeOf,
    stateFor,
    utteranceFor,
    warmableUtterances,
  } = channel;

  /** Each landed page utterance's id → its language, as voted once. */
  const pageLanguagesRef = useRef<Map<string, "pl" | "en">>(new Map());
  /**
   * The language an utterance is prepared in. A cell's comes from its
   * session's running tally — language is a property of the session. A page is
   * not a session: it is one text, read once, so its own vote decides, and the
   * tally (which needs two Polish votes to switch) would read every Polish page
   * as English. Asked once per utterance in effect: `preparedFor` keeps what it
   * prepared by id.
   */
  const languageOf = useCallback(
    (utterance: Utterance): "pl" | "en" => {
      if (!isDocSpeechKey(utterance.sessionId)) return languageFor(utterance.sessionId);
      // A page's vote reads its whole text, and the bar asks for its units on
      // every render — so the vote is taken once per utterance and kept by id
      // (the id is the key and text's hash, so it cannot go stale), until the
      // page is dropped.
      const known = pageLanguagesRef.current.get(utterance.id);
      if (known) return known;
      // The page's own preparation picks it, so the language a page plays in
      // is the one every other reader of the page prepared it in.
      const { language } = preparePageText(utterance.text);
      pageLanguagesRef.current.set(utterance.id, language);
      return language;
    },
    [languageFor],
  );
  /** Each spoken page's key → the id of the utterance it landed. */
  const pageUtterancesRef = useRef<Map<string, string>>(new Map());

  /**
   * What a preload asks before it is requested — is the cell still armed, is the
   * answer still unheard — read through mirrors, so `preloadRemainder` stays
   * stable. Mirrors rather than effect dependencies: `heardFor` moves on every
   * `markHeard`, and the warming effect must not re-run for that. What changes
   * after the request is the release effect's business.
   */
  const speechModeOfRef = useRef(speechModeOf);
  const heardForRef = useRef(heardFor);
  useEffect(() => {
    speechModeOfRef.current = speechModeOf;
    heardForRef.current = heardFor;
  }, [heardFor, speechModeOf]);

  const preparedFor = useCallback(
    (utterance: Utterance, language: "pl" | "en"): PreparedSpeech => {
      const cached = preparedRef.current.get(utterance.id);
      if (cached) return cached;

      // A page (`doc:` key) is prepared the one way every page is — block-
      // bounded, in its own vote's language (`preparePageText`) — so the units
      // the bar and play-from-here index are these units. An answer packs in
      // its session's language, as it always has.
      const prepared = isDocSpeechKey(utterance.sessionId)
        ? preparePageText(utterance.text)
        : prepare(utterance.text, { language });
      preparedRef.current.set(utterance.id, prepared);
      return prepared;
    },
    [],
  );

  /** The utterance's record, created on its first warm or preload. */
  const synthesisFor = useCallback((utterance: Utterance): UtteranceSynthesis => {
    const existing = synthesesRef.current.get(utterance.id);
    if (existing) return existing;

    const created: UtteranceSynthesis = {
      sessionId: utterance.sessionId,
      warm: null,
      preload: null,
    };
    synthesesRef.current.set(utterance.id, created);
    return created;
  }, []);

  /**
   * Calls an utterance's PRELOADS off, and only those: every remainder unit it
   * still has queued or in flight rejects `AbortError`, and is forgotten so a
   * later opportunity — arming the cell again, the retry after a failure —
   * requests it on a fresh controller. Unit 0's warm is left running: a cell
   * that is disarmed, or whose synthesizer dropped one unit, still wants its
   * first unit in hand.
   */
  const abortPreloads = useCallback((utteranceId: string): void => {
    const synthesis = synthesesRef.current.get(utteranceId);
    if (!synthesis) return;

    const prefix = `${utteranceId}#`;
    for (const key of preloadedRef.current) {
      if (key.startsWith(prefix)) preloadedRef.current.delete(key);
    }
    for (const key of preloadStartedRef.current) {
      if (key.startsWith(prefix)) preloadStartedRef.current.delete(key);
    }
    const { preload } = synthesis;
    synthesis.preload = null;
    if (!synthesis.warm) synthesesRef.current.delete(utteranceId);
    preload?.abort();
  }, []);

  /**
   * Calls an utterance off entirely — heard, out of the queue, or its host
   * gone: its preloads as {@link abortPreloads} does, and its unit-0 warm with
   * them. The warm is NOT forgotten: once called off, no further unit of it is
   * requested until it is preloaded again.
   */
  const abortUtterance = useCallback(
    (utteranceId: string): void => {
      const synthesis = synthesesRef.current.get(utteranceId);
      if (!synthesis) return;

      abortPreloads(utteranceId);
      synthesesRef.current.delete(utteranceId);
      const { warm } = synthesis;
      synthesis.warm = null;
      warm?.abort();
    },
    [abortPreloads],
  );

  /**
   * Unit 0 of an arriving utterance, on anytts' `warm` tier, once — or, for a
   * page run started mid-page, the unit it starts at (`start`, already
   * clamped into the units): that is the one the click waits on.
   */
  const warmFirstUnit = useCallback(
    (utterance: Utterance, units: readonly SpeechUnit[], start = 0): void => {
      if (warmedRef.current.has(utterance.id)) return;
      // Marked before the synthesis, not after: a second render must not start
      // a second warm of the same utterance while the first is in flight.
      warmedRef.current.add(utterance.id);

      const first = units[start];
      if (!first) return;

      // Its own controller, never the preloads': see `UtteranceSynthesis`.
      const warm = new AbortController();
      synthesisFor(utterance).warm = warm;
      const { signal } = warm;
      warmingRef.current.set(utterance.sessionId, signal);
      // Red from the moment it is asked for, whether the library starts it now
      // or queues it behind the playing run and the warms ahead of it: a cell
      // waiting in a queue is a cell waiting for its audio.
      setPreparing(utterance.sessionId, true);

      // `unitAudio` (a `synthesizeSpeech` underneath) rather than
      // `prefetchSpeech`: the promise is the whole point here — it is what says
      // when the cell stops being red — and a fire-and-forget warm cannot be
      // reported on. The failure is swallowed exactly as `prefetchSpeech`
      // swallows it.
      //
      // The voice is the one the click will use — the session's, through its
      // project, from the same `voiceFor` `useSpeechPlayer` reads. The
      // cache keys on voice + text, so warming with any other one is a
      // synthesis nobody ever plays.
      //
      // A page's unit 0 goes through its audio cache (`unitAudio`), so one on
      // disk is fetched rather than synthesized.
      unitAudio(utterance.sessionId, first, {
        voice: voiceForRef.current(utterance.sessionId),
        lang: first.lang,
        tier: "warm",
        signal,
      })
        .catch(() => {
          // A warm that failed — or was called off — must never strand a cell
          // red: the cell is reported ready anyway, and the click pays for the
          // synthesis itself, which is also how the user gets a retry.
        })
        .then(() => {
          // A newer warm took the cell over while this was out. It owns the
          // cell's colour now, so this landing says nothing.
          if (warmingRef.current.get(utterance.sessionId) !== signal) return;
          warmingRef.current.delete(utterance.sessionId);
          setPreparing(utterance.sessionId, false);
        });
    },
    [setPreparing, synthesisFor],
  );

  /**
   * Units 1..n of an armed cell's unheard utterance, on anytts' `preload` tier,
   * in the order they are handed in. Unit 0 is the warm's.
   *
   * All of them are requested now — the library queues them behind the run and
   * the warms — on the utterance's preload signal, so a cell disarmed or an
   * answer heard while they wait calls them off in one abort (see the release
   * effect). Called off is not failed: an `AbortError` is never counted below.
   *
   * A failed unit stops the rest of that utterance's preload too — by aborting
   * its preload controller, which drops the units still queued but leaves unit
   * 0's warm running — and it stays stopped
   * until the next warming-effect run (`preloadFailedRef`): a synthesizer that
   * is down must not be walked through a twelve-unit answer nobody has asked
   * for yet. The run, if one starts, reports the failure. The next pass
   * requests the units again on a fresh controller.
   */
  const preloadRemainder = useCallback(
    (utterance: Utterance, units: readonly SpeechUnit[]): void => {
      const { id, sessionId } = utterance;
      const unwanted = (): boolean =>
        preloadFailedRef.current.get(sessionId)?.has(id) === true ||
        speechModeOfRef.current(sessionId) === "off" ||
        heardForRef.current(sessionId).has(id);
      // Heard answers are never preloaded: a replay is a click away and pays
      // for itself, and an armed history must not cost the panel a backlog.
      if (unwanted()) return;

      for (let index = 1; index < units.length; index += 1) {
        const key = `${id}#${index}`;
        const unit = units[index];
        const { text, lang } = unit;
        if (preloadedRef.current.has(key)) {
          // The synth cache is an LRU: a unit requested earlier may have been
          // evicted since, and Play would then pay for it. Requested but cold
          // now (`isSpeechSynthesized` is `speechCacheState !== "cold"`, so in
          // flight counts as held) -> ask again.
          // A page's unit whose bytes the page cache holds is not evicted,
          // whatever the synth LRU did.
          const evicted =
            preloadStartedRef.current.has(key) &&
            !(isDocSpeechKey(sessionId) && pageUnitState(sessionId, unit) === "ready") &&
            !isSpeechSynthesized(text, { voice: voiceForRef.current(sessionId), lang });
          if (!evicted) continue;
          preloadStartedRef.current.delete(key);
        }
        preloadedRef.current.add(key);
        preloadStartedRef.current.add(key);

        const synthesis = synthesisFor(utterance);
        synthesis.preload ??= new AbortController();
        const { signal } = synthesis.preload;
        // The session's voice, for the same reasons the warm uses it.
        const voice = voiceForRef.current(sessionId);
        unitAudio(sessionId, unit, { voice, lang, tier: "preload", signal }).catch(
          (error: unknown) => {
            // Called off: whoever aborted already forgot the unit, and a late
            // rejection must not touch a fresh controller's bookkeeping.
            if (isAbortError(error)) return;
            // Best-effort, like every warm: the click synthesizes it for real.
            // The unit is forgotten so a retry reaches it, and the answer's
            // preloads are marked and called off so nothing after it is
            // synthesized until that retry. Its unit-0 warm is not a preload,
            // and keeps going.
            preloadedRef.current.delete(key);
            preloadStartedRef.current.delete(key);
            const failed = preloadFailedRef.current.get(sessionId) ?? new Set<string>();
            rememberAutoplayed(failed, id);
            preloadFailedRef.current.set(sessionId, failed);
            if (synthesesRef.current.get(id)?.preload?.signal === signal) abortPreloads(id);
          },
        );
      }
    },
    [abortPreloads, synthesisFor],
  );

  // The release effect: an utterance's controllers are aborted the moment it
  // stops being wanted. Heard — a replay is a click away and pays for itself.
  // Out of the queue (`MAX_PENDING` / `MAX_PREVIOUS`) — nothing can reach it
  // any more. Both of those call off unit 0's warm too. Its cell disarmed while
  // it was preloading calls off the PRELOADS alone — the remainder was only
  // ever for an armed cell, but an off cell still warms unit 0. `heardFor` and
  // `queueFor` move with every channel update and `speechModeOf` with every
  // mode change, which is exactly when one of those can have become true.
  useEffect(() => {
    for (const [id, { sessionId, preload }] of [...synthesesRef.current]) {
      const queue = queueFor(sessionId);
      const queued =
        queue.current?.id === id ||
        queue.previous.some((utterance) => utterance.id === id) ||
        queue.pending.some((utterance) => utterance.id === id);
      if (!queued || heardFor(sessionId).has(id)) abortUtterance(id);
      else if (preload && speechModeOf(sessionId) === "off") abortPreloads(id);
    }
  }, [abortPreloads, abortUtterance, heardFor, queueFor, speechModeOf]);

  // A host that unmounts calls off everything it still has out: queued warms
  // and preloads must not go on firing syntheses for a panel nobody is looking
  // at. Everything warmed or preloaded is forgotten with it, so React's
  // development double-mount — which runs this cleanup and then mounts the
  // SAME instance again — warms afresh on new controllers instead of being left
  // with dead ones.
  useEffect(() => {
    const syntheses = synthesesRef.current;
    const warmed = warmedRef.current;
    const warming = warmingRef.current;
    return () => {
      for (const id of [...syntheses.keys()]) abortUtterance(id);
      warmed.clear();
      warming.clear();
    };
  }, [abortUtterance]);

  useEffect(() => {
    // A lit control has to be ready to speak. Without this the first click pays
    // for loading the synthesis engine, a DRM token and a
    // fresh WebSocket handshake — seconds of nothing, which reads as a dead
    // button. So unit 0 is synthesized the moment an utterance arrives.
    //
    // EVERY session is warmed, not only the autoplay ones (Greg: "arm all, I will
    // use TTS most of the time"). The cost is one small synthesis per arriving
    // response, bounded by the number of terminals, and unit 0 is deliberately
    // the response's heading or first sentence.
    //
    // Warming is silent but deliberately VISIBLE. Silent: it fills the
    // synthesis cache and never touches the player, so a warmed cell that is
    // not in autoplay makes no sound however it is coloured. Visible: the cell is
    // reported preparing until the audio is actually in hand, because a green
    // control that might still be synthesizing is exactly the ambiguity the
    // red state exists to remove.
    //
    // An ARMED (or autoplay) cell goes further: every unit of its unheard
    // answer is preloaded, so the click that follows plays to the end without
    // a red underrun. Preloads are anytts' lowest tier — behind the playing
    // run and behind every unit-0 warm — and silent and invisible: the
    // scrubber's segments already show them landing, and the control's red is
    // about unit 0 alone.
    //
    // This run IS the "next opportunity" for a preload a failed unit stopped
    // (an arrival, a mode change, a catch-up that surfaced something). The stop
    // only holds within one pass, so a synthesizer that is down is walked once
    // per opportunity rather than through the whole answer, and a transient
    // failure no longer leaves an armed cell cold until its mode is cycled.
    preloadFailedRef.current.clear();
    for (const { utterance, mode } of warmableUtterances) {
      const { units } = preparedFor(utterance, languageOf(utterance));
      warmFirstUnit(utterance, units);
      if (mode !== "off") preloadRemainder(utterance, units);
    }
    // Warming reads nothing from the player any more: the supersession that
    // used to ride along inside this loop is its own effect below, because it
    // is about the QUEUE rather than about the cache, and a loop over every
    // speakable utterance in the panel was never the honest place to ask "is
    // this one cell's held run stale".
  }, [languageOf, preparedFor, preloadRemainder, warmFirstUnit, warmableUtterances]);

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
    //
    // TODO(follow-up): a pause taken DURING a history replay while `pending` is
    // non-empty releases nothing. The cursor is back in the history, so
    // `cursor === 0` is false and this arm is skipped; `holdingTheCursor` is
    // true, so the stop below returns as well — and the answers waiting behind
    // the replay sit there until the user presses next twice. The hole is
    // pre-existing, not a regression: the old `cursor === "current"` guard was
    // equally false in the same state. What the list-shaped queue changed is
    // the size of it — up to five answers held instead of one.
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
      const prepared = preparedFor(utterance, languageOf(utterance));
      if (prepared.units.length === 0) {
        // Defence in depth. `useUtteranceChannel` never announces a response
        // that prepares to nothing, so nothing speakable-looking should reach
        // this — but a cell that somehow does has nothing to say, and leaving it
        // pulsing would be a notification that can never be met.
        markHeard(sessionId);
        // Counts as a run that ended: reached from a dequeue, the autoplay
        // queue would otherwise wait for an ending that never comes.
        setRunEnds((count) => count + 1);
        return;
      }

      // Barge-in: whatever was speaking is *superseded*, not finished, so it
      // must revert to `unheard`. Stamped before `play`, which stops it.
      const previous = runRef.current;
      if (previous) previous.outcome = "superseded";

      const run: Run = { sessionId, utteranceId: utterance.id, outcome: "pending" };
      runRef.current = run;
      playingUtteranceRef.current = utterance.id;
      setLastSpokenSessionId(sessionId);
      // A run is the transport's focus from here on; the step has been spent.
      setSteppedSessionId(null);
      // The voice goes on, in this cell: whatever ended before it is not an end.
      endPendingRef.current = false;
      onRunChangeRef.current?.({ type: "start", sessionId });

      function finish(ended: Run): void {
        if (runRef.current === ended) {
          runRef.current = null;
          // Only the run holding the element ends the voice; a superseded one
          // finishes after its replacement has already started.
          endPendingRef.current = true;
        }
        // Whatever the ending, the autoplay queue gets to ask whether it is
        // its turn. A run another one superseded asks too, and is told no:
        // the run that replaced it holds the element.
        setRunEnds((count) => count + 1);

        // `heard` means the final unit played to its end, and nothing else.
        // Superseded, stopped, refused, failed — every ending that is not the
        // natural one leaves the cell `ready`, because something in it has
        // still not been listened to. A run still `pending` when the promise
        // settles is the only natural end there is.
        if (ended.outcome !== "pending") return;

        // Marks it heard AND moves the queue on — the queue's own "finished",
        // which advances into what is waiting, returns the cursor out of a
        // replay, and does nothing at all when neither applies. The autoplay
        // effect below is what turns that advance into sound, so a cell not in
        // autoplay ends up simply HOLDING the next answer.
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
    [finishUtterance, languageOf, markHeard, playUnits, preparedFor],
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

  /**
   * Drops what the host keeps per page utterance: its language, its warm mark
   * and its preparation. Only ever called with a page id (`pageUtteranceId`),
   * which no cell utterance shares, so answers keep their caches. A run still
   * holding the dropped preparation keeps its own reference; a later ask
   * simply prepares again, which is pure.
   */
  const forgetPageUtterance = useCallback((id: string): void => {
    pageLanguagesRef.current.delete(id);
    warmedRef.current.delete(id);
    preparedRef.current.delete(id);
  }, []);

  const speakDocument = useCallback(
    ({ key, text: source, startUnit = 0 }: { key: string; text: string; startUnit?: number }): void => {
      // The page's source as its surface loaded it; what is spoken — and
      // hashed into the id — is that source without its frontmatter.
      const text = pageSpeechText(source);
      const utterance: Utterance = {
        id: pageUtteranceId(key, text),
        sessionId: key,
        text,
        at: Date.now(),
      };
      // A page holds one utterance: an edited page's new text replaces the
      // old one rather than queueing behind it.
      const previousId = pageUtterancesRef.current.get(key);
      if (previousId !== undefined && previousId !== utterance.id) {
        abortUtterance(previousId);
        // Everything kept per page utterance goes with it, as `stopDocument`
        // forgets it: the old text coming back must warm (and show red) afresh,
        // and an edited page must not leave its old preparation behind.
        forgetPageUtterance(previousId);
        dropKey(key);
      }
      pageUtterancesRef.current.set(key, utterance.id);
      arriveLocal(utterance);

      // What `onSpeak` does, on the utterance named here: the channel's
      // `utteranceFor` of this render has not seen the arrival yet.
      unlock();
      const { units } = preparedFor(utterance, languageOf(utterance));
      if (units.length === 0) {
        // Nothing to say: the key stays `empty`, as the channel left it — and
        // the page's previous text, if it is still playing, stops with it
        // rather than speaking on under a key that no longer holds it.
        const run = runRef.current;
        if (run?.sessionId === key) {
          run.outcome = "stopped";
          stopPlayback();
        }
        return;
      }
      // The page's cached units, then its orphans dropped: listed first, so
      // the prune mirrors what the list loaded, and the prune hashes every
      // unit, which is what lets the bar read their state synchronously. In
      // the background, never awaited: unit 0 must not wait on two round trips,
      // and `pageAudio` asks the server per unit anyway. Both swallow their own
      // failures — an unreachable cache plays the page as if there were none,
      // and raises nothing.
      void loadPageList(key)
        .then(() => prunePage(key, units))
        .catch(() => {});
      // A non-number has no unit to clamp to, so it is 0; otherwise clamped
      // into the units, as `speakUtterance` clamps a segment click's.
      const start = Math.min(
        Math.max(Number.isFinite(startUnit) ? Math.trunc(startUnit) : 0, 0),
        units.length - 1,
      );
      // A local utterance is never warmed on arrival, so the unit the run
      // starts at is warmed here — the same warm the click then finds in
      // flight, and the same red until it lands.
      warmFirstUnit(utterance, units, start);
      speakUtterance(key, utterance, start);
    },
    [
      abortUtterance,
      arriveLocal,
      dropKey,
      forgetPageUtterance,
      languageOf,
      preparedFor,
      speakUtterance,
      stopPlayback,
      unlock,
      warmFirstUnit,
    ],
  );

  const stopDocument = useCallback(
    (key: string): void => {
      // Stopped, as the cell's stop is — but only the page's own run: a page
      // left behind by a cell that barged in must not silence that cell.
      const run = runRef.current;
      if (run?.sessionId === key) {
        run.outcome = "stopped";
        stopPlayback();
      }
      const id = pageUtterancesRef.current.get(key);
      pageUtterancesRef.current.delete(key);
      if (id !== undefined) {
        abortUtterance(id);
        // Forgotten, so the next Play warms (and shows red) afresh rather than
        // trusting a warm this stop called off.
        forgetPageUtterance(id);
      }
      warmingRef.current.delete(key);
      setPreparing(key, false);
      dropKey(key);
    },
    [abortUtterance, dropKey, forgetPageUtterance, setPreparing, stopPlayback],
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

  const onPrevious = useCallback(
    (sessionId: string): void => {
      const queue = queueFor(sessionId);

      // THE WAVE IS A POSITION, and it is read HERE rather than in the bar.
      //
      // Three surfaces raise this callback — the row's control, the
      // `Ctrl+Shift+Arrow` chord (`useSpeechKeys`) and the OS media keys
      // (`useMediaSessionTransport`) — and they agreed about every other
      // transport rule before the wave existed. A wave step implemented in the
      // row alone is two transports: the chord would be a no-op on the very
      // cell a reload strands, and would step PAST the newest answer wherever
      // history exists. So the step lives where all three meet.
      //
      // What it is: the wave — the body handed over while the agent works — is
      // one position ABOVE the newest answer the cell holds, not a lid over it.
      // A backward press taken from there lands on the answer under the cursor
      // and moves the cursor no step. Without that, the first press back both
      // holds and steps, so the newest answer — the one the unread count is
      // about — is the single answer a backward walk never lands on. Invisible
      // on a cell with history; total on a reloaded tab, where the server's one
      // retained utterance is the only answer there is.
      // READ BEFORE `noteTransport`, and that ordering is the whole of a bug
      // this once had. `noteTransport` sets `markOnly`, and `derive` collapses
      // a SEND-owned handover to `MARK_ONLY` the moment it is set — `waiting`
      // goes false. Asked afterwards, `stepsOffTheWave` answers no on exactly
      // the ordinary path "sent a draft, pressed Previous to re-read", and the
      // press holds AND steps, skipping the newest answer. The row used to
      // read its render-time snapshot, which is to say: before the press.
      const steppingOffTheWave = stepsOffTheWave(
        answerWaitingRef.current.get(sessionId).waiting,
        answerWaitingRef.current.isHeld(sessionId),
        utteranceUnderCursor(queue) !== null,
      );

      // The send wait's own rule: a transport press gives the body back and
      // leaves the mark on the play button. It lives here rather than in the
      // row for the same reason the step does — the chord and the media keys
      // are transport presses too, and a row that kept this to itself left
      // them unable to give the body back at all.
      answerWaitingRef.current.noteTransport(sessionId);
      // The transport is on this cell now, whatever the press turns out to
      // move: the idle play that follows stays here (`idleTransportTarget`).
      setSteppedSessionId(sessionId);

      if (steppingOffTheWave) {
        // A backward press is the user saying *I want the text*, and this
        // branch is a real move, so it takes the hold.
        answerWaitingRef.current.hold(sessionId);
        // The grant is spent even though the cursor did not move — see the
        // note on `unlock()` below. This branch is the one that most needs it:
        // on the reloaded cell it and the forward step back onto the wave are
        // the whole round trip, so skipping it here leaves a tab that has
        // interacted plenty and is still locked.
        unlock();
        return;
      }

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

      // The hold is taken AFTER the refusal, not before it. Before, it was a
      // rule the row's `disabled={!hasPrevious}` made unreachable — but the
      // chord and the media keys ask no button whether it is enabled, so a
      // `Ctrl+Shift+←` on a cell with no history would set a hold that nothing
      // in that run clears. `derive` answers a standing hold with `SETTLED`,
      // so the cell's pane would stop handing over to the wave altogether.
      answerWaitingRef.current.hold(sessionId);

      // And the press is SILENT: the cursor moves and nothing else happens.
      //
      // Stepping back used to speak what it landed on, which made the backward
      // control the one transport press you could not use to *look* at
      // something. The case it fails is the ordinary one — walking the answers
      // a cell is holding to find which of them matters. Every step talked over
      // the last, so reading an older answer quietly meant not reaching it at
      // all. The play control is how the answer under the cursor is heard now,
      // which is exactly what it already did.
      //
      // `unlock()` STAYS, although this press no longer makes a sound, and the
      // reason is that it is not about this press. The browser hands out the
      // autoplay permission only from inside a gesture handler, and it attaches
      // to the element for good; spending it here costs nothing, because
      // `unlock` is guarded to run once per element and that once happens on a
      // source-less element on purpose. What it buys is the next thing that
      // wants to speak. A tab whose only interaction so far was stepping back
      // is not unlocked, and the autoplay effect below does not merely defer an
      // arrival in that state — it ABSORBS it, marking the utterance autoplayed
      // so the cell stays quiet ever after. Skimming the backlog and then
      // arming would silently eat the next answer. A free gesture is the
      // cheaper side of that trade by some distance.
      //
      // `recordAutoplayed` stays for a related reason, and see its own comment:
      // the autoplay effect watches the utterance under the cursor, so a
      // backward step looks to it exactly like an arrival. Without the record
      // an autoplay cell would speak the answer the user stepped back to read —
      // the press silenced everywhere except the state it is listened to in.
      // It records nothing about `heard`, so the unplayed count is untouched.
      unlock();
      dispatchQueue(sessionId, { type: "previous" });
      recordAutoplayed(sessionId, target.id);
    },
    [dispatchQueue, queueFor, recordAutoplayed, unlock],
  );

  const onNext = useCallback(
    (sessionId: string): void => {
      const queue = queueFor(sessionId);

      // THE LAST STEP BACK ONTO THE WAVE — the mirror of `onPrevious`'s, and
      // here for the same reason: every surface must take it.
      //
      // The gate is "nothing ahead of the cursor", NOT "the cursor is on
      // `current`". With a backlog the newest answer the cell holds is
      // `pending.at(-1)`, which is what the row's own unread mark counts, so
      // the wave sits above the BACKLOG and forward from `current` steps into
      // it. Releasing here on a queued cell would spend the hold without
      // moving, and cost a second press to go one place.
      const steppingOntoTheWave = stepsOntoTheWave(
        answerWaitingRef.current.isHeld(sessionId),
        queue.cursor,
        queue.pending.length,
      );

      // The send wait's rule, as on the backward press — and read after the
      // gate above for the same reason: `noteTransport` moves what `derive`
      // reports, so anything asked of the store belongs before it.
      answerWaitingRef.current.noteTransport(sessionId);
      // As on the backward press: the idle play that follows stays here.
      setSteppedSessionId(sessionId);

      if (steppingOntoTheWave) {
        unlock();
        answerWaitingRef.current.release(sessionId);
        return;
      }

      // From history, next means "come back" — one step towards the newest
      // answer, which is the step in between rather than `current` whenever
      // the listener has walked further than one back. Otherwise it means
      // "skip ahead" into what is waiting. Either way the hold SURVIVES: it
      // stands for exactly as long as the cursor is below the wave, and is
      // spent above, by the branch this one falls through from.
      const returning = queue.cursor > 0;
      const target = returning
        ? utteranceUnderCursor({ ...queue, cursor: queue.cursor - 1 })
        : (queue.pending[0] ?? null);
      if (!returning && !target) return;

      // And the press is SILENT, exactly as `onPrevious` is — see its comment
      // for the reasoning, which holds in both directions and is only repeated
      // here in outline.
      //
      // Forward used to speak what it landed on, and the asymmetry was written
      // down as deliberate: forward was "the way into what is waiting". It is
      // no longer only that. The unread count says an answer is waiting and the
      // play control speaks it, while forward is also the one way back to the
      // wave — so the carve-out made the gesture that RETURNS to the waiting
      // state the loudest control on the row. Navigation moves the cursor;
      // audio starts from the arm switch or the play button, and from nothing
      // else.
      //
      // `unlock()` STAYS, although this press no longer makes a sound: it is
      // the browser's autoplay grant, handed out only from inside a gesture
      // handler and attached to the element for good. A tab whose only
      // interaction was navigating is a tab the autoplay effect ABSORBS the
      // next answer in — marking it autoplayed and staying quiet ever after —
      // so skimming and then arming would silently eat an answer.
      //
      // `recordAutoplayed` STAYS for the same reason it does on the backward
      // press, and it is what makes this silent on the ARMED cell too: the
      // autoplay effect watches the utterance under the cursor, so a step looks
      // exactly like an arrival to it. Without the record an autoplay cell would
      // speak the answer the user merely stepped onto — the press silenced
      // everywhere except the state it is listened to in. It records nothing
      // about `heard`, so the unplayed count is untouched.
      unlock();
      dispatchQueue(sessionId, { type: "next" });
      if (!target) return;

      recordAutoplayed(sessionId, target.id);
    },
    [dispatchQueue, queueFor, recordAutoplayed, unlock],
  );

  /**
   * The cursor, home — and **deliberately nothing else**.
   *
   * There is no `speakUtterance` here, and no `unlock` either. The pane raises
   * this when an answer landing released the hold it had on the text: the
   * listener had stepped back to re-read something and is, in all likelihood,
   * still listening to it. Moving the body to the answer that just landed is
   * what the arrival is owed; starting that answer's audio would cut off the
   * sentence they are hearing, and it is not what the release means.
   *
   * So the voice keeps reading whatever it was reading. The reducer's own
   * no-op discipline makes the common case — every arrival for a cell nobody
   * stepped back in — free: the cursor is already 0, the same queue object
   * comes back, and no cell re-renders.
   */
  const onNewestAnswer = useCallback(
    (sessionId: string): void => {
      dispatchQueue(sessionId, { type: "newest" });
    },
    [dispatchQueue],
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
      return preparedFor(utterance, languageOf(utterance)).units;
    },
    [languageOf, preparedFor, queueFor],
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
   * by `useSpeechHost.preload.test.ts` (identity).
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
   * paused run. `useSpeechHost.preload.test.ts` records every intermediate
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

  const cycleSpeechMode = useCallback(
    (sessionId: string): void => {
      // Cycling is a click too, and it is the gesture the autoplay that follows
      // will need — so it is spent on the element here rather than lost.
      unlock();
      cycleChannelSpeechMode(sessionId);
    },
    [cycleChannelSpeechMode, unlock],
  );

  /**
   * What each autoplay cell is owed by autoplay: the utterance under its cursor
   * and, while the cursor is on `current`, the answers waiting behind it — in
   * the order the cell would play them. The backlog is in here so that an
   * answer arriving for the SPEAKING cell takes its turn in the autoplay queue
   * at the moment it arrived, not at the moment its own run ended: otherwise an
   * answer from another cell that landed later would be spoken first.
   */
  const autoplayOwed = useCallback(
    (sessionId: string): Utterance[] => {
      const queue = queueFor(sessionId);
      const under = utteranceUnderCursor(queue);
      if (!under) return [];
      return queue.cursor === 0 ? [under, ...queue.pending] : [under];
    },
    [queueFor],
  );

  /**
   * Each autoplay cell with what it is owed, as one string so the effect below
   * runs when any of them moves and not on every render.
   */
  const autoplayKey = autoplaySessionIds
    .map(
      (sessionId) =>
        `${sessionId}\u0000${autoplayOwed(sessionId)
          .map((utterance) => utterance.id)
          .join("\u0000")}`,
    )
    .join("\u0001");

  useEffect(() => {
    // Entering autoplay does not speak what is already sitting in the cell:
    // autoplay is for utterances that ARRIVE while the cell is in it. A fresh
    // record per cell that just entered, because records belong to a cell and
    // say nothing about another; a cell still in autoplay keeps its own.
    const before = autoplayedRef.current;
    const after = new Map<string, Set<string>>();
    for (const sessionId of autoplaySessionIds) {
      const kept = before.get(sessionId);
      if (kept) {
        after.set(sessionId, kept);
        continue;
      }
      const remembered = new Set<string>();
      for (const owed of autoplayOwed(sessionId)) remembered.add(owed.id);
      after.set(sessionId, remembered);
    }
    // A cell that left autoplay gives up its turns: its answers stay unheard,
    // waiting for a click like any other cell's.
    for (const sessionId of before.keys()) {
      if (!after.has(sessionId)) autoplayQueue.dropSession(sessionId);
    }
    autoplayedRef.current = after;
    // `autoplayOwed` deliberately not a dependency: this must run when the set
    // of autoplay cells changes, and only then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplaySessionIds]);

  useEffect(() => {
    // 1. Enqueue. Every utterance an autoplay cell is owed that autoplay has
    //    not dealt with yet is recorded, and — with a gesture in hand — queued
    //    for its turn, oldest first across the cells. With no gesture yet it is
    //    ABSORBED instead: the browser would refuse anyway, and a tab that has
    //    just hydrated `/api/speech/latest` must not start talking on its own.
    //    A catch-up's recovered answers never get this far: the channel has
    //    already recorded them (ADR 0017), so they are shown, never queued.
    const arrived: Utterance[] = [];
    const owedIds = new Set<string>();
    for (const sessionId of autoplaySessionIds) {
      const record = autoplayedRef.current.get(sessionId);
      if (!record) continue;
      for (const owed of autoplayOwed(sessionId)) {
        owedIds.add(owed.id);
        if (record.has(owed.id)) continue;
        rememberAutoplayed(record, owed.id);
        if (unlocked) arrived.push(owed);
      }
    }
    // Stable, so answers that share a stamp keep the order they were found in.
    arrived.sort((left, right) => left.at - right.at);
    // An idle cell's newer answer replaces the older one under its cursor, so
    // the older one's queued turn is no longer owed: the newer answer takes
    // that turn over rather than queuing behind cells that answered between
    // the two. The speaking cell's backlog is still owed, so its next answer
    // keeps its own arrival place.
    for (const { sessionId, id } of arrived) {
      autoplayQueue.enqueue({ sessionId, utteranceId: id }, (queued) =>
        owedIds.has(queued.utteranceId),
      );
    }

    // 2. Dequeue — only between runs. A run that is still going, PAUSED
    //    included (a pause does not end it), keeps the element; the queue
    //    waits until it ends or a click replaces it. That is also what makes a
    //    manual play a barge-in rather than a queue jump: it holds the element
    //    until its own end, and only then does the queue resume.
    if (runRef.current) return;
    if (!unlocked) {
      // No gesture: the head is absorbed exactly as an arrival is — recorded
      // already, and no audio. Unreachable while `unlocked` only ever goes
      // false → true, but the gate is the browser's, not this queue's.
      while (autoplayQueue.next(() => true));
      return;
    }

    // The oldest entry still worth speaking: its cell still in autoplay, the
    // answer still under the cell's cursor (a newer arrival or a transport
    // press moved it on), and not heard by hand in the meantime. Anything else
    // is stale and dropped on the way.
    const turn = autoplayQueue.next(
      ({ sessionId, utteranceId }) =>
        speechModeOf(sessionId) === "autoplay" &&
        utteranceFor(sessionId)?.id === utteranceId &&
        !heardFor(sessionId).has(utteranceId),
    );
    if (!turn) return;
    const utterance = utteranceFor(turn.sessionId);
    if (utterance) speakUtterance(turn.sessionId, utterance);
    // Keyed on `autoplayKey`, which already folds in what every autoplay cell
    // is owed, and on `runEnds`, which is the queue's turn signal. The reads
    // above are this render's, which is the render either of them moved in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplayKey, runEnds, speakUtterance, unlocked]);

  // The voice fell silent — asked AFTER the autoplay effect above, which is
  // declared first and so runs first in the same commit: a queued answer it
  // started has already reported its `start` and cleared the flag, and the
  // alert following the voice moves on rather than leaving and coming back.
  useEffect(() => {
    if (!endPendingRef.current || runRef.current) return;
    endPendingRef.current = false;
    onRunChangeRef.current?.({ type: "end" });
  }, [runEnds]);

  // Held and continued, read off the player rather than off `onPause` /
  // `onResume`, so every route to a pause is seen. A run that ENDS while held
  // (a stop, a supersession) also clears `pausedSessionId`; that is no resume,
  // which is what the run's outcome and identity say.
  const heldSessionRef = useRef<string | null>(null);
  useEffect(() => {
    const before = heldSessionRef.current;
    heldSessionRef.current = pausedSessionId;
    if (pausedSessionId) {
      if (before !== pausedSessionId) onRunChangeRef.current?.({ type: "pause" });
      return;
    }
    const run = runRef.current;
    if (before && run?.sessionId === before && run.outcome === "pending") {
      onRunChangeRef.current?.({ type: "resume" });
    }
  }, [pausedSessionId]);

  /**
   * When the answer a play on this cell would start arrived — the utterance
   * under its cursor, the one `onSpeak` plays — or `null` once that is heard.
   * Only that one, and not an older unheard answer further down the history:
   * the idle transport ranks cells by what pressing play would actually say.
   */
  const oldestUnheardArrival = useCallback(
    (sessionId: string): number | null => {
      const under = utteranceUnderCursor(queueFor(sessionId));
      if (!under || heardFor(sessionId).has(under.id)) return null;
      return under.at;
    },
    [heardFor, queueFor],
  );

  return useMemo(
    () => ({
      stateFor,
      queueFor,
      heardFor,
      speechModeOf,
      autoplaySessionIds,
      onSpeak,
      onPause,
      onResume,
      onStop,
      onPrevious,
      onNext,
      onNewestAnswer,
      cycleSpeechMode,
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
      // `useSpeechHost.preload.test.ts` (identity) is the pin that says so.
      speakingSessionId,
      pausedSessionId,
      onSeekBackward,
      // The idle transport's readings. `lastSpokenSessionId` moves only when
      // a run starts in a different cell, `steppedSessionId` on a step press
      // and the next run start; `oldestUnheardArrival` with the queue and the
      // heard set, which move this object already. `isSessionOpen` is the
      // panel's, handed through.
      oldestUnheardArrival,
      lastSpokenSessionId,
      steppedSessionId,
      isSessionOpen,
      speakDocument,
      stopDocument,
    }),
    [
      autoplaySessionIds,
      cycleSpeechMode,
      heardFor,
      isSessionOpen,
      lastSpokenSessionId,
      oldestUnheardArrival,
      onJumpToUnit,
      onNewestAnswer,
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
      speakDocument,
      speakingSessionId,
      speechModeOf,
      stateFor,
      steppedSessionId,
      stopDocument,
      subscribeProgress,
      unitDurationsFor,
      unitsFor,
    ],
  );
}

export default useSpeechHost;
