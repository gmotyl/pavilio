import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { REALTIME_RECONNECT_FRAME, subscribeRealtime } from "../realtime/channel";
import { useWebSocket } from "../realtime/useWebSocket";
import { prepare } from "./prepare";
import {
  INITIAL_LANGUAGE_STATE,
  nextLanguageState,
  voteLanguage,
  type LanguageState,
} from "./pronunciation";
import type { CellSpeechState, Utterance } from "./types";
import {
  emptyUtteranceQueue,
  utteranceQueueReducer,
  utteranceUnderCursor,
  type UtteranceQueue,
  type UtteranceQueueEvent,
} from "./utteranceQueue";
import { getStoredArmedSession, setStoredArmedSession } from "./voices";

/**
 * The panel's single subscriber to the utterance stream: it hydrates from the
 * server's latest-per-session store, listens for `speech-utterance` frames, and
 * remembers which cell has something unheard and which one is armed.
 *
 * It does NOT own playback, and it does not own synthesis either. The coupling
 * is kept one-way — nothing here imports the player or the synthesizer — so
 * `speaking`, `stalled`, `paused` and `preparing` are all *inputs*: the caller
 * (`useSpeechHost`) passes them on every render and
 * {@link useUtteranceChannel} overlays them onto the state it computes. A
 * session with no utterance can never be reported as anything but `empty`,
 * whatever is passed.
 *
 * What the channel itself decides is exactly one bit: `heard`. It means the
 * **final unit played to its end**, nothing less — {@link Channel.markHeard} is
 * called only from the host's natural end, never from a stop, a pause, a
 * barge-in or a dead synthesizer, all of which leave the cell `ready` because
 * something in it has still not been listened to.
 *
 * `heard` is a flag, never a deletion: the utterance stays retrievable through
 * {@link Channel.utteranceFor} so a click replays it out of the synthesis LRU
 * cache instead of paying for synthesis again. A session is `empty` until it has
 * something speakable in it, and only `empty` and `preparing` are inert.
 *
 * Arrival is also where a response with **nothing to say** is filtered out. That
 * has to happen here rather than at the click: marking the cell `ready` first
 * and discovering the emptiness only inside `speak` leaves every cell
 * pulsing for a pure-code answer, and an unarmed cell — the common case — stands
 * there with a pip until the user clicks it and nothing happens. So
 * {@link prepare} runs on arrival. It is pure text work (no synthesis, no
 * network), and importing it keeps the coupling one-way: the channel still
 * imports nothing from the player.
 *
 * The state a cell shows is {@link CellSpeechState}, declared in `./types` with
 * the rest of the grid-facing contract.
 */

/**
 * What the channel remembers per session. One named record rather than parallel
 * maps keyed by session id, so per-session knowledge has a single home.
 */
interface SessionSpeech {
  /**
   * The cell's whole transport state: up to five steps of history, the
   * utterance the transport is on, and the answers waiting behind it. Empty
   * until the session has received something speakable — the vote below still
   * had to be recorded for a response with nothing to say, and a record exists
   * for that alone.
   */
  queue: UtteranceQueue;
  /**
   * Utterance ids that played to their last unit in this browser.
   *
   * A SET rather than the flag it used to be, because the cursor no longer sits
   * on one fixed utterance: a cell can hold heard answers all through its
   * history and an unheard one in `current` at the same time, and a single flag
   * would report whichever of them the cursor was not on.
   */
  heard: ReadonlySet<string>;
  /**
   * The session's running language tally. Language is a property of the
   * SESSION, not of one response, so the vote is folded in here — where the
   * rest of the per-session knowledge already lives — the moment an utterance
   * arrives, and `languageFor` is what preparation reads.
   */
  language: LanguageState;
}

/** Folds one arriving utterance's vote into a session's tally. */
function advanceLanguage(previous: LanguageState | undefined, text: string): LanguageState {
  return nextLanguageState(previous ?? INITIAL_LANGUAGE_STATE, voteLanguage(text));
}

/**
 * Whether an arriving response has anything to say at all. A response that is
 * only code strips to nothing and prepares to zero units, and announcing that
 * would be a notification that can never be met.
 */
function hasSomethingToSay(text: string, language: "pl" | "en"): boolean {
  return prepare(text, { language }).units.length > 0;
}

/**
 * The record an unspeakable arrival leaves: the session's tally advances and
 * nothing else changes — the cell keeps whichever utterance and `heard` flag it
 * already had, so there is no pulse, no pip and no audio.
 */
function languageOnly(existing: SessionSpeech | undefined, language: LanguageState): SessionSpeech {
  return existing ? { ...existing, language } : emptySession(language);
}

/** Shared so a panel of silent cells does not allocate a Set per session. */
const NOTHING_HEARD: ReadonlySet<string> = new Set<string>();

const emptySession = (language: LanguageState): SessionSpeech => ({
  queue: emptyUtteranceQueue,
  heard: NOTHING_HEARD,
  language,
});

/**
 * The session's heard set with the utterance under the cursor folded into it.
 * Returns the set it was handed when there is nothing to add, so a repeated
 * mark stays a no-op all the way out to the Map.
 */
function withHeard(existing: SessionSpeech | undefined): ReadonlySet<string> {
  if (!existing) return NOTHING_HEARD;
  const spoken = utteranceUnderCursor(existing.queue);
  if (!spoken || existing.heard.has(spoken.id)) return existing.heard;
  return new Set([...existing.heard, spoken.id]);
}

/**
 * The heard set narrowed to the ids the queue can still reach — its history,
 * its cursor, and everything waiting behind it.
 *
 * `heard` is only ever asked of the utterance under the cursor, so an id that
 * has fallen out of the queue (an answer pushed off the far end of the history
 * past `MAX_PREVIOUS`, a pending answer dropped past `MAX_PENDING`) can never
 * be asked about again. Left alone the set grows for the life of the tab, and
 * {@link withHeard} rebuilds the whole of it on every mark — quadratic over a
 * long session. Cut on every advance it is bounded by the queue itself: eleven
 * utterances at its very widest.
 *
 * The one shadow this casts is a re-broadcast of an utterance the cell has
 * already let go of: it arrives as news rather than as something heard. The
 * server keeps one utterance per session and replays only that one, so the
 * cell's own dedupe gate covers every re-delivery that can actually happen.
 *
 * Returns the set it was handed when nothing has fallen out, so an advance that
 * drops nothing stays referentially a no-op all the way out to the Map.
 */
function prunedHeard(heard: ReadonlySet<string>, queue: UtteranceQueue): ReadonlySet<string> {
  if (heard.size === 0) return heard;

  const reachable = new Set<string>();
  // The WHOLE history, not its newest step: every answer the transport can
  // still be walked back onto is one the listener may be asked about again,
  // and a reach that stops at one step throws away the mark for the other
  // four the moment anything advances.
  for (const step of queue.previous) reachable.add(step.id);
  if (queue.current) reachable.add(queue.current.id);
  for (const waiting of queue.pending) reachable.add(waiting.id);

  let dropped = false;
  for (const id of heard) {
    if (!reachable.has(id)) {
      dropped = true;
      break;
    }
  }
  if (!dropped) return heard;

  return new Set([...heard].filter((id) => reachable.has(id)));
}

/** Folds an arriving utterance into a session's record, queue and all. */
function withArrival(
  existing: SessionSpeech | undefined,
  utterance: Utterance,
  language: LanguageState,
  speaking: boolean,
): SessionSpeech {
  const base = existing ?? emptySession(language);
  // An arrival is an advance like any other, so the heard set is cut back with
  // it. It usually drops nothing now: an idle arrival pushes what it
  // superseded onto the front of the history rather than discarding it, and
  // only a history already holding `MAX_PREVIOUS` answers loses one off the far
  // end. The cut is still taken on every arrival, because that is the moment
  // the queue's reach changes and `prunedHeard` returns the set it was handed
  // when nothing has actually fallen out.
  const queue = utteranceQueueReducer(base.queue, { type: "arrived", utterance, speaking });
  return { ...base, language, queue, heard: prunedHeard(base.heard, queue) };
}

/**
 * Whether the queue already holds this utterance anywhere — history, the
 * cursor, or the answers waiting behind it. The reducer has no dedupe of its
 * own, so this is the whole of the panel's defence against a reconnect replay
 * appending a second copy of an answer the cell already has.
 */
function queueHolds(queue: UtteranceQueue, id: string): boolean {
  return (
    queue.previous.some((step) => step.id === id) ||
    queue.current?.id === id ||
    queue.pending.some((waiting) => waiting.id === id)
  );
}

/**
 * What the host **warms**, per cell: the utterance the transport is on, and the
 * one a `next` press would actually land on. That second entry is read off the
 * cursor, never off `queue.current` — while the cursor is back in the history a
 * press walks one step towards the newest answer, so from two steps back it
 * reaches `previous[cursor - 2]` and `current` is still two presses away; only
 * once the cursor is on `current` does a press move forward into the oldest
 * answer waiting behind it. Warming what the transport would reach is the whole
 * point of the list, so it has to be the cursor's own answer to that question
 * and not an approximation that happens to agree at depth one.
 *
 * Deliberately NOT "everything the cell might yet be asked to speak". That list
 * is up to eleven utterances per cell; the host fires a `synthesizeSpeech` for
 * each of them with no await and no limiter, and the player's own
 * `SYNTHESIS_CONCURRENCY` bounds the units of the one RUN it is playing and
 * nothing else — so back when history was a single slot, a full queue behind a
 * live run put seven requests in flight against the audio somebody is actually
 * listening to, and the list-shaped history would now make that eleven.
 *
 * Two is what the bound buys and what it costs: a queued answer still has its
 * first unit in hand before the transport reaches it, and the ones further back
 * are warmed as they move up — this list changes whenever the queue advances,
 * and the host's warming effect is keyed on it.
 *
 * `previous` is not in it either: it was warmed when it was current, and a
 * replay plays it out of the synthesis cache.
 */
function warmableOf(queue: UtteranceQueue): Utterance[] {
  const under = utteranceUnderCursor(queue);
  // Where a `next` press would land: one step towards the newest answer while
  // the cursor is back in the history, and the oldest answer waiting once it
  // is on `current`. Asking the cursor rather than comparing against
  // `queue.current` is what makes this right at depth: from two steps back the
  // next press reaches the step in between, not `current`, and warming
  // `current` there prepares an answer the transport will not touch for two
  // more presses while leaving the one it lands on cold.
  const next =
    queue.cursor > 0
      ? utteranceUnderCursor({ ...queue, cursor: queue.cursor - 1 })
      : (queue.pending[0] ?? null);
  return [under, next].filter((entry): entry is Utterance => entry !== null);
}

/**
 * Everything the channel is told rather than observes. The coupling stays
 * one-way — this module imports neither the player nor the synthesizer — so
 * `speaking`, `stalled`, `paused` and `preparing` all arrive as inputs from
 * `useSpeechHost`, the one place the channel, the player and the warming
 * effect meet.
 *
 * Every field is required, never defaulted: forgetting one has no sensible
 * fallback — it would silently delete a state from the grid, which is the bug
 * the required `speakingSessionId` was introduced to prevent — so the omission
 * has to be a type error that forces the call site to decide.
 */
export interface UtteranceChannelOptions {
  /** The player's `speakingSessionId`, as of this render. */
  speakingSessionId: string | null;
  /** The player's `pausedSessionId`: the run the user is holding, or `null`. */
  pausedSessionId: string | null;
  /**
   * The player's `waitingForSynthesis`: whether the live run is blocked on a
   * unit. It is what turns `speaking` into `stalled`, and it belongs to the one
   * running playback, so it is a single flag rather than a set.
   */
  waitingForSynthesis: boolean;
  /**
   * The host's `preparingSessionIds`: cells whose first unit is still being
   * warmed, before anyone has clicked anything. A different wait from
   * `waitingForSynthesis` — they sit on opposite sides of the click — painted
   * the same red only because the user's question has the same answer.
   */
  preparingSessionIds: ReadonlySet<string>;
  /**
   * The host's `recordAutoplayed`. The catch-up below calls it for every
   * utterance it takes up after a reconnect, so the armed cell does not speak
   * an answer that landed while the tab was frozen.
   *
   * Returning to the application is not a user gesture, and an armed cell in a
   * tab with no gesture does not merely *defer* an arrival — it ABSORBS it,
   * marking the utterance played so the cell stays quiet ever after. A
   * recovered answer handed to that path would lose its spoken form for good,
   * which is worse than not recovering it. Marking it ourselves keeps it off
   * that path entirely, and `recordAutoplayed` records nothing about `heard`,
   * so the pulse, the pip and the unread count are all unaffected. See ADR 0017.
   */
  recordAutoplayed: (sessionId: string, utteranceId: string) => void;
}

/**
 * A transport event the *caller* may raise on a queue. `arrived` is not in it:
 * arrival is the channel's own business, and the `speaking` flag it carries is
 * something only the channel knows at the moment a frame lands.
 */
export type QueueCommand = Exclude<UtteranceQueueEvent, { type: "arrived" }>;

export interface Channel {
  stateFor(sessionId: string): CellSpeechState;
  /** The utterance the transport is on — a step of history while one replays. */
  utteranceFor(sessionId: string): Utterance | null;
  /** The cell's whole queue: its history, the cursor, and what waits. */
  queueFor(sessionId: string): UtteranceQueue;
  /**
   * The ids of the cell's answers that have been played to their end, narrowed
   * to what the queue can still reach. Handed out so the unread count can be a
   * derivation over it — see `unreadAnswers.ts`.
   */
  heardFor(sessionId: string): ReadonlySet<string>;
  /** Raise previous / next / finished on a cell's queue. */
  dispatchQueue(sessionId: string, command: QueueCommand): void;
  /**
   * The utterance under the cursor played its last unit. It is marked heard,
   * and the queue moves on — but ONLY if something is waiting behind it, or the
   * cursor was replaying history. With neither, the cell keeps what it has:
   * `heard` is a flag and never a deletion, so a click still replays it.
   */
  finishUtterance(sessionId: string): void;
  /**
   * The session's accumulated language, for `prepare`. Never a detection of
   * one response: it is the tally every utterance so far has voted into.
   */
  languageFor(sessionId: string): "pl" | "en";
  /**
   * What the host warms, across every session, armed or not: per cell the
   * utterance under the cursor and the one the transport would reach next, and
   * no more than those two — see {@link warmableOf} for why the rest of a cell's
   * queue is not in it.
   *
   * It is also how the host learns that something ARRIVED: `utteranceFor`
   * answers only about a session the caller already knows to ask about, and
   * warming has to react to the arrival itself. The identity changes only when
   * the set does, so an effect keyed on it runs once per arrival rather than
   * once per render, and both arrival paths — a live frame and `/latest`
   * hydration — land in it.
   */
  warmableUtterances: Utterance[];
  armedSessionId: string | null;
  /** Exclusive: arming a session disarms whichever was armed. `null` disarms. */
  setArmed(sessionId: string | null): void;
  markHeard(sessionId: string): void;
}

const LATEST_URL = "/api/speech/latest";

/**
 * One `/latest` entry, decided: what it is, what it does to the session's tally
 * and whether it has anything to say. Settled before the state update so the
 * updater stays pure and the `recordAutoplayed` calls can be made outside it.
 */
interface CaughtUp {
  utterance: Utterance;
  /** The session's tally with this response's vote folded in. */
  language: LanguageState;
  /** False for a response with nothing to say: it votes, and seeds no pip. */
  speakable: boolean;
}

/** A parsed `/latest` response, waiting for the effect that commits it. */
interface FetchedLatest {
  utterances: Utterance[];
  /** False for the mount fetch: only a catch-up is absorbed. */
  catchUp: boolean;
}

/**
 * Whether what the cell already holds covers a `/latest` entry. One rule, for
 * the mount fetch and the catch-up alike:
 *
 * > skip it when the queue already holds the id, **or** when what the cell is
 * > showing is at least as new as the entry.
 *
 * The id half is `queueHolds`, the same dedupe the live-frame path uses: it
 * keeps a re-delivery out of the queue wherever the cell is holding it. The
 * CLOCK half is what the id half cannot say, and it covers three things the
 * gate used to get wrong:
 *
 * - **Mount.** The only thing that can already be there is a live frame that
 *   raced this fetch, and it is newer than anything `/latest` can say. It used
 *   to be skipped by a gate on the SESSION, which is a mount-shaped assumption
 *   and cost the catch-up the answer the user came back for; `at` says the same
 *   thing without asking which fetch this is, so the split is gone.
 * - **An aged-out entry.** The server retains one utterance per session and
 *   hands it back on EVERY catch-up. Once more than `MAX_PREVIOUS` answers have
 *   pushed it off the far end of the history its id is nowhere in the queue, so
 *   the id half alone re-takes an answer the cell has moved past — a duplicate
 *   in the history and a pip for something already heard.
 * - **The socket race.** An utterance posted after the `/latest` snapshot can
 *   win the race home, and the snapshot entry — an id the cell has never held —
 *   would then append over it and leave the cell showing the older answer.
 *
 * `utteranceQueueReducer`'s `arrived` case orders nothing by time, so whatever
 * passes this gate displaces what the cell is showing and un-hears it. This is
 * the whole of the ordering.
 *
 * A record with nothing under `current` — a session that has only ever cast a
 * language vote, or one whose single arrival queued behind a live run — is
 * covered by neither half and the entry is taken up, which is right: there is
 * nothing there for it to displace.
 */
function covers(existing: SessionSpeech | undefined, utterance: Utterance): boolean {
  if (!existing) return false;
  if (queueHolds(existing.queue, utterance.id)) return true;
  const showing = existing.queue.current;
  return showing !== null && showing.at >= utterance.at;
}

/** Narrows a WS frame or a `/latest` entry onto the locked wire format. */
function toUtterance(raw: unknown): Utterance | null {
  if (!raw || typeof raw !== "object") return null;
  const { id, sessionId, text, at } = raw as Record<string, unknown>;
  if (typeof id !== "string" || id === "") return null;
  if (typeof sessionId !== "string" || sessionId === "") return null;
  if (typeof text !== "string") return null;
  if (typeof at !== "number") return null;
  return { id, sessionId, text, at };
}

/**
 * The caller must pass all four inputs on every render — the channel never
 * observes playback or synthesis itself, so a stale or missing value is the
 * only way the grid can be wrong about where a cell's audio is.
 */
export function useUtteranceChannel({
  speakingSessionId,
  pausedSessionId,
  waitingForSynthesis,
  preparingSessionIds,
  recordAutoplayed,
}: UtteranceChannelOptions): Channel {
  const { lastMessage } = useWebSocket();
  const [sessions, setSessions] = useState<Map<string, SessionSpeech>>(() => new Map());
  /**
   * The rendered `sessions`, mirrored so the *callbacks* below can read the
   * current tally without taking it as a dependency. The host's warming effect
   * is keyed on `languageFor` and `warmableUtterances` together, so both have
   * to hold their identity across a `markHeard` or the effect churns on every
   * cell that finishes speaking — and stabilising only one of them changes
   * nothing, because the effect re-runs when either moves.
   */
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  /**
   * The playback inputs, mirrored for the arrival effects below.
   *
   * The `speaking` flag on an `arrived` event is what decides queue-versus-
   * current, so it has to be about THIS cell at the moment the frame lands —
   * not about the panel as a whole, and not about whichever render an effect's
   * closure happened to capture. A ref rather than a dependency, because adding
   * the two ids to the arrival effect's deps would re-run it on every playback
   * change and re-deliver the same frame.
   */
  const playbackRef = useRef({ speakingSessionId, pausedSessionId });
  // Written in an EFFECT, never during render. A render can be thrown away —
  // a concurrent render React abandons, StrictMode's double invocation — and a
  // mirror written during one of those runs ahead of the state that was
  // actually committed. An effect only runs for a commit, so the mirror can
  // never be newer than what the rest of the panel is looking at.
  //
  // Declared ABOVE the two arrival effects on purpose: effects run in
  // declaration order within a commit, so when a playback change and a frame
  // land in the same commit the mirror is already the committed one by the
  // time the arrival reads it.
  useEffect(() => {
    playbackRef.current = { speakingSessionId, pausedSessionId };
  }, [pausedSessionId, speakingSessionId]);
  /**
   * The host's `recordAutoplayed`, mirrored for the same reason as the playback
   * inputs: the catch-up effect below is keyed on the reconnect count alone, so
   * taking this callback as a dependency would re-fetch `/latest` every time
   * the host's armed cell changed its identity.
   */
  const recordAutoplayedRef = useRef(recordAutoplayed);
  useEffect(() => {
    recordAutoplayedRef.current = recordAutoplayed;
  }, [recordAutoplayed]);
  // Read once at mount, so a remount restores the armed cell (DECISION 12).
  const [armedSessionId, setArmedSessionId] = useState<string | null>(getStoredArmedSession);

  /**
   * How many times the realtime channel has come back. It is what re-runs the
   * hydration below, which would otherwise be `deps: []` — once, at mount — and
   * so would never ask for the answer that the panel server retained while the
   * socket was dead. See ADR 0017.
   *
   * Subscribed DIRECTLY rather than read off `lastMessage`: the channel
   * publishes the neutral frame alongside the file-change one, React batches
   * both into a single render, and `useWebSocket` keeps only the newest frame —
   * so the neutral one is never visible there. The file-change frame is
   * deliberately the one published last, because every other consumer depends
   * on seeing it. `lastMessage` still drives `speech-utterance` arrivals,
   * unchanged.
   */
  const [reconnects, setReconnects] = useState(0);
  useEffect(
    () =>
      subscribeRealtime((frame) => {
        if (frame.type !== REALTIME_RECONNECT_FRAME.type) return;
        setReconnects((count) => count + 1);
      }),
    [],
  );

  /**
   * What the newest `/latest` fetch read, waiting to be committed below. The
   * fetch itself decides nothing: see the commit effect for why.
   */
  const [fetched, setFetched] = useState<FetchedLatest | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Mount and catch-up are the same fetch, gated by the same rule, and differ
    // in exactly one thing: only a catch-up is absorbed by `recordAutoplayed`.
    const catchUp = reconnects > 0;

    (async () => {
      try {
        const res = await fetch(LATEST_URL);
        if (!res.ok || cancelled) return;

        const body = (await res.json()) as { utterances?: unknown };
        const raw = Array.isArray(body?.utterances) ? body.utterances : [];
        const utterances = raw
          .map(toUtterance)
          .filter((entry): entry is Utterance => entry !== null);
        if (cancelled || utterances.length === 0) return;

        setFetched({ utterances, catchUp });
      } catch {
        // The panel server is unreachable (restarting, or the page was served
        // from a cache). Nothing is seeded and the channel stays usable — live
        // frames still register once the socket comes back. A failed catch-up
        // is not an error state, it is the status quo ante.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reconnects]);

  /**
   * Commits what a fetch read, and records only what it actually took up.
   *
   * Deliberately not done in the fetch's own continuation. A promise callback
   * can run while React is holding a live frame's `setSessions` QUEUED but not
   * yet applied, so the state it reads off `sessionsRef` is older than the one
   * the updater will be handed: React applies the frame first, the updater's
   * re-check drops the entry, and `recordAutoplayed` has already absorbed an
   * answer that arrived as a genuine live frame — silencing it for good, which
   * ADR 0017 calls worse than not recovering it at all.
   *
   * An effect runs with everything React had queued already applied, and
   * anything queued after it lands BEHIND this update, so what is decided here
   * is exactly what the cell ends up holding — which is what makes the
   * `recordAutoplayed` calls below honest.
   *
   * Declared ABOVE the arrival effect, for the same reason the playback mirror
   * is: effects run in declaration order within a commit, so a frame landing in
   * the same commit queues its update behind this one rather than in front.
   */
  useEffect(() => {
    if (!fetched) return;
    const { utterances, catchUp } = fetched;

    // Decided against the rendered state before anything is set, so that
    // `recordAutoplayed` can be called from here rather than from inside the
    // updater — which writes the host's ref and has to stay pure.
    const taken: CaughtUp[] = [];
    for (const utterance of utterances) {
      const existing = sessionsRef.current.get(utterance.sessionId);
      if (covers(existing, utterance)) continue;
      const language = advanceLanguage(existing?.language, utterance.text);
      taken.push({
        utterance,
        language,
        speakable: hasSomethingToSay(utterance.text, language.lang),
      });
    }
    if (taken.length === 0) return;

    setSessions((current) => {
      const next = new Map(current);
      for (const { utterance, language, speakable } of taken) {
        const existing = next.get(utterance.sessionId);
        // Hydration is an arrival too, so it gets the same gate: a stored
        // pure-code answer must not seed a pip either.
        if (!speakable) {
          next.set(utterance.sessionId, languageOnly(existing, language));
          continue;
        }
        // A tab that was not there for the broadcast has not heard what it is
        // being handed, so the cell it seeds is unheard and the answer counts
        // towards the unread pip. A cell the user has PAUSED does not count as
        // speaking, exactly as on the live-frame path.
        const { speakingSessionId: live, pausedSessionId: held } = playbackRef.current;
        const speaking = live === utterance.sessionId && held !== utterance.sessionId;
        next.set(utterance.sessionId, withArrival(existing, utterance, language, speaking));
      }
      return next;
    });

    // Only a CATCH-UP is absorbed, never the mount fetch. A tab that has just
    // loaded has had no gesture either, and the host already absorbs a hydrated
    // arrival there for that reason; recording one from here would only clobber
    // the armed cell's own bookkeeping with an id that may never reach the
    // cursor.
    if (!catchUp) return;
    for (const { utterance, speakable } of taken) {
      if (speakable) recordAutoplayedRef.current(utterance.sessionId, utterance.id);
    }
  }, [fetched]);

  useEffect(() => {
    if (lastMessage?.type !== "speech-utterance") return;

    const utterance = toUtterance(lastMessage);
    if (!utterance) return;

    setSessions((current) => {
      const existing = current.get(utterance.sessionId);
      // Re-delivery of an utterance the cell already holds — a reconnect replay,
      // a double effect run — must not make a heard cell pulse again, and must
      // not append a second copy of it to the queue. Only a new id is news, and
      // the reducer past this gate has no dedupe of its own.
      if (existing && queueHolds(existing.queue, utterance.id)) return current;

      const next = new Map(current);
      // The vote is folded in whatever the response turns out to be: language is
      // a property of the SESSION, not of one response, so a pure-code answer
      // written in Polish still tells the session which language it is in.
      const language = advanceLanguage(existing?.language, utterance.text);

      if (!hasSomethingToSay(utterance.text, language.lang)) {
        next.set(utterance.sessionId, languageOnly(existing, language));
        return next;
      }

      // A frame can be the first news of a session — a terminal's response may
      // arrive before anything else told the channel the cell exists.
      //
      // A cell the user has PAUSED does not count as speaking: the living spec
      // is that a paused cell does not hold the next answer hostage, so the
      // arrival supersedes the held run rather than queueing behind it.
      const { speakingSessionId: live, pausedSessionId: held } = playbackRef.current;
      const speaking = live === utterance.sessionId && held !== utterance.sessionId;
      next.set(utterance.sessionId, withArrival(existing, utterance, language, speaking));
      return next;
    });
  }, [lastMessage]);

  const stateFor = useCallback(
    (sessionId: string): CellSpeechState => {
      const record = sessions.get(sessionId);
      // A record whose queue has nothing under the cursor is as inert as no
      // record at all: it exists only to carry the session's language tally.
      // Checked first, so a stray preparing, paused or speaking id cannot
      // invent a state for a cell that has nothing to play.
      const under = record ? utteranceUnderCursor(record.queue) : null;
      if (!record || !under) return "empty";

      // Playback outranks warming, and it has to. `preparing` is the control's
      // INERT red — a click raises nothing — so letting a late-landing warm
      // mask a live run would take the pause away from a run that is speaking.
      if (sessionId === pausedSessionId) return "paused";
      if (sessionId === speakingSessionId) {
        return waitingForSynthesis ? "stalled" : "speaking";
      }

      if (preparingSessionIds.has(sessionId)) return "preparing";
      // `heard` is set by `markHeard` alone, and the host calls it only when
      // the final unit has played to its end. Everything else — a barge-in, a
      // stop, a refusal, a dead synthesizer — leaves the flag where it was,
      // which is `ready`.
      // Asked of the utterance under the cursor, not of the cell: a cell whose
      // last answer played out and whose next one has arrived is `ready`, and
      // stepping back onto the one that was heard says `heard` again.
      return record.heard.has(under.id) ? "heard" : "ready";
    },
    [pausedSessionId, preparingSessionIds, sessions, speakingSessionId, waitingForSynthesis],
  );

  const utteranceFor = useCallback(
    (sessionId: string): Utterance | null => {
      const queue = sessions.get(sessionId)?.queue;
      return queue ? utteranceUnderCursor(queue) : null;
    },
    [sessions],
  );

  // Every cell has a queue, including one nothing has ever arrived for: the
  // transport renders in every cell, so this never hands back `undefined`.
  const queueFor = useCallback(
    (sessionId: string): UtteranceQueue => sessions.get(sessionId)?.queue ?? emptyUtteranceQueue,
    [sessions],
  );

  /**
   * Which of the cell's answers have been played to their end.
   *
   * Handed out because the unread count is a DERIVATION over it and the queue
   * — see `unreadAnswers.ts`. A surface that kept its own tally would have to
   * decrement it on playback, on an answer falling off the far end of the
   * history, on a pending answer dropped past the bound and on a re-broadcast,
   * and missing any one of those leaves a pip on a cell with nothing behind
   * it. Reading the set the channel already prunes to the queue's own reach
   * cannot drift.
   *
   * The shared empty set for a cell that has played nothing, like every other
   * "nothing here" here: a fresh `new Set()` per call would be a new snapshot
   * on every render for every silent cell in the panel.
   */
  const heardFor = useCallback(
    (sessionId: string): ReadonlySet<string> => sessions.get(sessionId)?.heard ?? NOTHING_HEARD,
    [sessions],
  );

  // Reads the mirror, so its identity never changes. It is only ever called
  // from the host's effects and callbacks — never rendered — so there is
  // nothing for a changing identity to refresh, and holding it still is what
  // keeps the warming effect from re-running on every `sessions` update.
  const languageFor = useCallback(
    (sessionId: string): "pl" | "en" =>
      sessionsRef.current.get(sessionId)?.language.lang ?? INITIAL_LANGUAGE_STATE.lang,
    [],
  );

  /** The last list handed out, so an unchanged set keeps its identity. */
  const warmableRef = useRef<Utterance[]>([]);
  const warmableUtterances = useMemo(() => {
    const next = [...sessions.values()].flatMap((record) => warmableOf(record.queue));

    // `sessions` is a fresh Map on every change, including a `markHeard` that
    // touches no utterance at all, so the array it derives is fresh too. Utterance
    // objects are stored once and never rewritten, so element identity is the
    // honest test of whether the SET changed — and returning the previous array
    // when it did not is what stops the host warming effect churning.
    const previous = warmableRef.current;
    if (
      previous.length === next.length &&
      previous.every((utterance, index) => utterance === next[index])
    ) {
      return previous;
    }

    warmableRef.current = next;
    return next;
  }, [sessions]);

  const markHeard = useCallback((sessionId: string) => {
    setSessions((current) => {
      const existing = current.get(sessionId);
      const heard = withHeard(existing);
      if (!existing || heard === existing.heard) return current;

      const next = new Map(current);
      next.set(sessionId, { ...existing, heard });
      return next;
    });
  }, []);

  const dispatchQueue = useCallback((sessionId: string, command: QueueCommand) => {
    setSessions((current) => {
      const existing = current.get(sessionId);
      if (!existing) return current;

      // The reducer returns the SAME object for a genuine no-op, which is what
      // stops a second `previous` press repainting the grid. Passing that
      // through as an unchanged Map keeps the property all the way out here.
      const queue = utteranceQueueReducer(existing.queue, command);
      if (queue === existing.queue) return current;

      const next = new Map(current);
      next.set(sessionId, { ...existing, queue, heard: prunedHeard(existing.heard, queue) });
      return next;
    });
  }, []);

  const finishUtterance = useCallback((sessionId: string) => {
    setSessions((current) => {
      const existing = current.get(sessionId);
      if (!existing) return current;

      const heard = withHeard(existing);
      // The queue moves on only when there is somewhere to move to. With an
      // empty queue and the cursor on `current`, `finished` would null the
      // cell out — and `heard` is a flag, never a deletion: the utterance has
      // to stay retrievable so a click replays it.
      const advances = existing.queue.pending.length > 0 || existing.queue.cursor > 0;
      const queue = advances
        ? utteranceQueueReducer(existing.queue, { type: "finished" })
        : existing.queue;
      // The mark goes in before the cut, and survives it: what was just heard
      // is what the advance moves into `previous`, which is still reachable.
      const kept = queue === existing.queue ? heard : prunedHeard(heard, queue);
      if (kept === existing.heard && queue === existing.queue) return current;

      const next = new Map(current);
      next.set(sessionId, { ...existing, heard: kept, queue });
      return next;
    });
  }, []);

  // Exclusivity is structural: one slot, so arming a cell IS disarming the
  // other. There is no set of armed cells that could ever hold two.
  const setArmed = useCallback((sessionId: string | null) => {
    setArmedSessionId(setStoredArmedSession(sessionId));
  }, []);

  return {
    stateFor,
    utteranceFor,
    queueFor,
    heardFor,
    dispatchQueue,
    finishUtterance,
    languageFor,
    warmableUtterances,
    armedSessionId,
    setArmed,
    markHeard,
  };
}
