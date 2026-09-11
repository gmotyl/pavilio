import { useCallback, useEffect, useState } from "react";
import { useWebSocket } from "../realtime/useWebSocket";
import {
  INITIAL_LANGUAGE_STATE,
  nextLanguageState,
  voteLanguage,
  type LanguageState,
} from "./pronunciation";
import type { Utterance } from "./types";
import { getStoredArmedSession, setStoredArmedSession } from "./voices";

/**
 * The panel's single subscriber to the utterance stream: it hydrates from the
 * server's latest-per-session store, listens for `speech-utterance` frames, and
 * remembers which cell has something unheard and which one is armed.
 *
 * It does NOT own playback. `useSpeechPlayer` does, and the coupling is kept
 * one-way — nothing here imports the player. `speaking` is therefore an *input*:
 * the caller (Task 11) passes the player's `speakingSessionId`, and
 * {@link useUtteranceChannel} overlays it onto the state it computes. A session
 * with no utterance can never be reported as speaking, whatever is passed.
 *
 * `heard` is a flag, never a deletion: the utterance stays retrievable through
 * {@link Channel.utteranceFor} so a click replays it out of the synthesis LRU
 * cache instead of paying for synthesis again. Only a session that has never
 * received an utterance is `empty`, and only `empty` is inert.
 */
export type CellSpeechState = "empty" | "unheard" | "heard" | "speaking";

/**
 * What the channel remembers per session. One named record rather than parallel
 * maps keyed by session id, so per-session knowledge has a single home.
 */
interface SessionSpeech {
  /** Always the latest utterance for the session — retained after it is heard. */
  utterance: Utterance;
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

export interface UtteranceChannelOptions {
  /**
   * The player's `speakingSessionId`, as of this render. Required, not
   * defaulted: forgetting it has no sensible fallback — it would silently
   * delete the `speaking` state from the grid — so the omission must be a type
   * error that forces the call site to decide.
   */
  speakingSessionId: string | null;
}

export interface Channel {
  stateFor(sessionId: string): CellSpeechState;
  utteranceFor(sessionId: string): Utterance | null;
  /**
   * The session's accumulated language, for `prepare`. Never a detection of
   * one response: it is the tally every utterance so far has voted into.
   */
  languageFor(sessionId: string): "pl" | "en";
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
 * The caller must pass the player's `speakingSessionId` on every render — the
 * channel never observes playback itself, so a stale or missing value is the
 * only way the grid can be wrong about what is speaking.
 */
export function useUtteranceChannel({ speakingSessionId }: UtteranceChannelOptions): Channel {
  const { lastMessage } = useWebSocket();
  const [sessions, setSessions] = useState<Map<string, SessionSpeech>>(() => new Map());
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
            // A tab that mounts after the broadcast has not heard it, and the
            // server keeps only the latest — so a seeded cell is unheard.
            next.set(utterance.sessionId, {
              utterance,
              heard: false,
              language: advanceLanguage(undefined, utterance.text),
            });
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
      if (existing?.utterance.id === utterance.id) return current;

      const next = new Map(current);
      // A frame can be the first news of a session — a terminal's response may
      // arrive before anything else told the channel the cell exists.
      next.set(utterance.sessionId, {
        utterance,
        heard: false,
        language: advanceLanguage(existing?.language, utterance.text),
      });
      return next;
    });
  }, [lastMessage]);

  const stateFor = useCallback(
    (sessionId: string): CellSpeechState => {
      const record = sessions.get(sessionId);
      if (!record) return "empty";
      if (sessionId === speakingSessionId) return "speaking";
      return record.heard ? "heard" : "unheard";
    },
    [sessions, speakingSessionId],
  );

  const utteranceFor = useCallback(
    (sessionId: string): Utterance | null => sessions.get(sessionId)?.utterance ?? null,
    [sessions],
  );

  const languageFor = useCallback(
    (sessionId: string): "pl" | "en" =>
      sessions.get(sessionId)?.language.lang ?? INITIAL_LANGUAGE_STATE.lang,
    [sessions],
  );

  const markHeard = useCallback((sessionId: string) => {
    setSessions((current) => {
      const existing = current.get(sessionId);
      if (!existing || existing.heard) return current;

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

  return { stateFor, utteranceFor, languageFor, armedSessionId, setArmed, markHeard };
}
