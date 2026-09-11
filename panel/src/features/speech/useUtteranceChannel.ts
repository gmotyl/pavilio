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
 * barge-in, a budget cut or a dead synthesizer, all of which leave the cell
 * `ready` because something in it has still not been listened to.
 *
 * `heard` is a flag, never a deletion: the utterance stays retrievable through
 * {@link Channel.utteranceFor} so a click replays it out of the synthesis LRU
 * cache instead of paying for synthesis again. A session is `empty` until it has
 * something speakable in it, and only `empty` and `preparing` are inert.
 *
 * Arrival is also where a response with **nothing to say** is filtered out. That
 * has to happen here rather than at the click: marking the cell `ready` first
 * and discovering the emptiness only inside `speakFrom` leaves every cell
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
   * The latest **speakable** utterance for the session — retained after it is
   * heard. `null` when the only thing the session has ever received had nothing
   * to say: the vote below still had to be recorded, and a record exists for
   * that alone.
   */
  utterance: Utterance | null;
  /** Spoken in this browser. Flipped back by a newer utterance. */
  heard: boolean;
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
  return existing ? { ...existing, language } : { utterance: null, heard: false, language };
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

export interface Channel {
  stateFor(sessionId: string): CellSpeechState;
  utteranceFor(sessionId: string): Utterance | null;
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
            // server keeps only the latest — so a seeded cell is unheard.
            next.set(utterance.sessionId, { utterance, heard: false, language });
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
      // Re-delivery of the same utterance (a reconnect replay, a double effect
      // run) must not make a heard cell pulse again. Only a new id is news.
      if (existing?.utterance?.id === utterance.id) return current;

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
      next.set(utterance.sessionId, { utterance, heard: false, language });
      return next;
    });
  }, [lastMessage]);

  const stateFor = useCallback(
    (sessionId: string): CellSpeechState => {
      const record = sessions.get(sessionId);
      // A record with no speakable utterance is as inert as no record at all:
      // it exists only to carry the session's language tally. Checked first, so
      // a stray preparing, paused or speaking id cannot invent a state for a
      // cell that has nothing to play.
      if (!record?.utterance) return "empty";

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
      // budget stop, a stop, a refusal, a dead synthesizer — leaves the flag
      // where it was, which is `ready`.
      return record.heard ? "heard" : "ready";
    },
    [pausedSessionId, preparingSessionIds, sessions, speakingSessionId, waitingForSynthesis],
  );

  const utteranceFor = useCallback(
    (sessionId: string): Utterance | null => sessions.get(sessionId)?.utterance ?? null,
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
    const next = [...sessions.values()]
      .map((record) => record.utterance)
      .filter((utterance): utterance is Utterance => utterance !== null);

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
      if (!existing?.utterance || existing.heard) return current;

      const next = new Map(current);
      next.set(sessionId, { ...existing, heard: true });
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
    languageFor,
    speakableUtterances,
    armedSessionId,
    setArmed,
    markHeard,
  };
}
