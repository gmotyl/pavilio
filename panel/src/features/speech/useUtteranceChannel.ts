import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
   * The cell's whole transport state: one step of history, the utterance the
   * transport is on, and the answers waiting behind it. Empty until the session
   * has received something speakable — the vote below still had to be recorded
   * for a response with nothing to say, and a record exists for that alone.
   */
  queue: UtteranceQueue;
  /**
   * Utterance ids that played to their last unit in this browser.
   *
   * A SET rather than the flag it used to be, because the cursor no longer sits
   * on one fixed utterance: a cell can hold a heard answer in `previous` and an
   * unheard one in `current` at the same time, and a single flag would report
   * whichever of the two the cursor was not on.
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

/** Folds an arriving utterance into a session's record, queue and all. */
function withArrival(
  existing: SessionSpeech | undefined,
  utterance: Utterance,
  language: LanguageState,
  speaking: boolean,
): SessionSpeech {
  const base = existing ?? emptySession(language);
  return {
    ...base,
    language,
    queue: utteranceQueueReducer(base.queue, { type: "arrived", utterance, speaking }),
  };
}

/**
 * Whether the queue already holds this utterance anywhere — history, the
 * cursor, or the answers waiting behind it. The reducer has no dedupe of its
 * own, so this is the whole of the panel's defence against a reconnect replay
 * appending a second copy of an answer the cell already has.
 */
function queueHolds(queue: UtteranceQueue, id: string): boolean {
  return (
    queue.previous?.id === id ||
    queue.current?.id === id ||
    queue.pending.some((waiting) => waiting.id === id)
  );
}

/**
 * Everything the cell might yet be asked to speak, which is what the host warms
 * from: the utterance under the cursor and the ones queued behind it. `previous`
 * is not in it — it was warmed when it was current, and a replay plays it out of
 * the synthesis cache.
 */
function speakableOf(queue: UtteranceQueue): Utterance[] {
  const under = utteranceUnderCursor(queue);
  const ahead = under === queue.current ? queue.pending : [queue.current, ...queue.pending];
  return [under, ...ahead].filter((entry): entry is Utterance => entry !== null);
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
}

/**
 * A transport event the *caller* may raise on a queue. `arrived` is not in it:
 * arrival is the channel's own business, and the `speaking` flag it carries is
 * something only the channel knows at the moment a frame lands.
 */
export type QueueCommand = Exclude<UtteranceQueueEvent, { type: "arrived" }>;

export interface Channel {
  stateFor(sessionId: string): CellSpeechState;
  /** The utterance the transport is on — `previous` while history is replaying. */
  utteranceFor(sessionId: string): Utterance | null;
  /** The cell's whole queue: one step of history, the cursor, what waits. */
  queueFor(sessionId: string): UtteranceQueue;
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
   * Every session's current speakable utterance, armed or not. It is how the
   * host learns that something ARRIVED — `utteranceFor` answers only about a
   * session the caller already knows to ask about, and warming has to react to
   * the arrival itself. The identity changes only when the set does, so an
   * effect keyed on it runs once per arrival rather than once per render, and
   * both arrival paths — a live frame and `/latest` hydration — land in it.
   */
  speakableUtterances: Utterance[];
  armedSessionId: string | null;
  /** Exclusive: arming a session disarms whichever was armed. `null` disarms. */
  setArmed(sessionId: string | null): void;
  markHeard(sessionId: string): void;
}

const LATEST_URL = "/api/speech/latest";

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
}: UtteranceChannelOptions): Channel {
  const { lastMessage } = useWebSocket();
  const [sessions, setSessions] = useState<Map<string, SessionSpeech>>(() => new Map());
  /**
   * The rendered `sessions`, mirrored so the *callbacks* below can read the
   * current tally without taking it as a dependency. The host's warming effect
   * is keyed on `languageFor` and `speakableUtterances` together, so both have
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
  playbackRef.current = { speakingSessionId, pausedSessionId };
  // Read once at mount, so a remount restores the armed cell (DECISION 12).
  const [armedSessionId, setArmedSessionId] = useState<string | null>(getStoredArmedSession);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(LATEST_URL);
        if (!res.ok || cancelled) return;

        const body = (await res.json()) as { utterances?: unknown };
        const raw = Array.isArray(body?.utterances) ? body.utterances : [];
        if (cancelled || raw.length === 0) return;

        setSessions((current) => {
          const next = new Map(current);
          for (const entry of raw) {
            const utterance = toUtterance(entry);
            // A frame that landed while this fetch was in flight is newer than
            // anything `/latest` can say, so hydration never displaces one —
            // that would resurrect an utterance and un-hear a heard cell.
            if (!utterance || next.has(utterance.sessionId)) continue;
            const language = advanceLanguage(undefined, utterance.text);
            // Hydration is an arrival too, so it gets the same gate: a stored
            // pure-code answer must not seed a pip either.
            if (!hasSomethingToSay(utterance.text, language.lang)) {
              next.set(utterance.sessionId, languageOnly(undefined, language));
              continue;
            }
            // A tab that mounts after the broadcast has not heard it, and the
            // server keeps only the latest — so a seeded cell is unheard, and
            // its queue is the one stored utterance with nothing on either side
            // of it. Nothing is playing on a tab that has just mounted, so the
            // arrival is an idle one by construction.
            next.set(
              utterance.sessionId,
              withArrival(undefined, utterance, language, false),
            );
          }
          return next;
        });
      } catch {
        // The panel server is unreachable (restarting, or the page was served
        // from a cache). Nothing is seeded and the channel stays usable — live
        // frames still register once the socket comes back.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
  const speakableRef = useRef<Utterance[]>([]);
  const speakableUtterances = useMemo(() => {
    const next = [...sessions.values()].flatMap((record) => speakableOf(record.queue));

    // `sessions` is a fresh Map on every change, including a `markHeard` that
    // touches no utterance at all, so the array it derives is fresh too. Utterance
    // objects are stored once and never rewritten, so element identity is the
    // honest test of whether the SET changed — and returning the previous array
    // when it did not is what stops the host warming effect churning.
    const previous = speakableRef.current;
    if (
      previous.length === next.length &&
      previous.every((utterance, index) => utterance === next[index])
    ) {
      return previous;
    }

    speakableRef.current = next;
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
      next.set(sessionId, { ...existing, queue });
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
      const advances = existing.queue.pending.length > 0 || existing.queue.cursor === "previous";
      const queue = advances
        ? utteranceQueueReducer(existing.queue, { type: "finished" })
        : existing.queue;
      if (heard === existing.heard && queue === existing.queue) return current;

      const next = new Map(current);
      next.set(sessionId, { ...existing, heard, queue });
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
    dispatchQueue,
    finishUtterance,
    languageFor,
    speakableUtterances,
    armedSessionId,
    setArmed,
    markHeard,
  };
}
