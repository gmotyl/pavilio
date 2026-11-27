/**
 * The panel's speech host, wired to the terminals.
 *
 * `features/speech` does not import `features/terminal`; the dependency runs
 * the other way. This component is the one place that sees both: it reads the
 * terminal's stores — the session list, the focus preferences, the drawer, the
 * answer-waiting store, the session's voice — and hands them to
 * {@link SpeechHostProvider} as ports. Mount it once, where the provider would
 * go. See `App.tsx`.
 */
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { CASCADE } from "../speech/engines";
import {
  type OpenaiVoices,
  useOpenaiVoicesSnapshot,
  usePrimeOpenaiVoices,
} from "../speech/useOpenaiVoices";
import { usePocketVoicesSnapshot, usePrimePocketVoices } from "../speech/usePocketVoices";
import { getCascadeOrder, getStoredEngine } from "../speech/voices";
import {
  SpeechHostProvider,
  type FocusedCellPort,
} from "../speech/SpeechHostProvider";
import type { AnswerWaitingPort } from "../speech/useSpeechHost";
import {
  getAnswerWaiting,
  holdAnswer,
  isAnswerHeld,
  noteTransport,
  releaseAnswer,
} from "./answerWaiting";
import { dismissAttentionOnArrival } from "./attentionArrival";
import { getSessions, subscribeSessions } from "./sessionStore";
import { languageForSession, voiceForSession } from "./sessionVoice";
import {
  readStandaloneTerminalFocus,
  subscribeStandaloneTerminalFocus,
} from "./standaloneTerminalFocus";
import { useTerminalDrawerVisible } from "./useTerminalDrawer";
import { readTerminalFocus, TERMINAL_FOCUS_EVENT, type SessionMeta } from "./useTerminalSessions";

/** The terminal's answer-waiting store, as the host's port. One object, so its
 *  identity is stable across renders. */
const answerWaiting: AnswerWaitingPort = {
  get: getAnswerWaiting,
  hold: holdAnswer,
  release: releaseAnswer,
  noteTransport,
  isHeld: isAnswerHeld,
};

/** The session list at the moment of asking. */
function sessionOf(sessionId: string) {
  return getSessions().find((session) => session.id === sessionId);
}

/**
 * The channel never forgets a session, so the idle transport learns a cell
 * has closed from the session list: a session it no longer lists, while it
 * lists any, is gone. An empty list is read as not loaded yet and rules
 * nothing out — a panel that has not fetched its sessions must not go mute.
 */
function isSessionOpen(sessionId: string): boolean {
  const sessions = getSessions();
  return sessions.length === 0 || sessions.some((session) => session.id === sessionId);
}

/** {@link subscribeSessions} as `useSyncExternalStore` takes it. */
function subscribeSessionList(onChange: () => void): () => void {
  return subscribeSessions(() => onChange());
}

/** The last list {@link placementSignature} read, and its signature. */
let lastPlacement: { sessions: readonly SessionMeta[]; signature: string } | null = null;

/**
 * Where the session list places each session: its ids with their projects, as
 * one string — JSON of `[id, project]` pairs, so no id or project can run into
 * the next whatever characters it holds. A primitive, so `useSyncExternalStore` compares it by value and a
 * list that changes something else — a rename, an OSC title (a busy spinner
 * ticking in it) — gives the same snapshot and no new port. Removing a session
 * changes it too, and so is a warming pass with nothing new to place; that is
 * accepted rather than told apart, since the pass is idempotent and re-requests
 * only what failed or was called off. Memoised by the list's reference, which
 * the store keeps for an unchanged list, so a read per render does not rebuild
 * the string.
 */
function placementSignature(): string {
  const sessions = getSessions();
  if (lastPlacement?.sessions !== sessions) {
    lastPlacement = {
      sessions,
      signature: JSON.stringify(sessions.map((session) => [session.id, session.project])),
    };
  }
  return lastPlacement.signature;
}

/** The OmniVoice list's load state, as the language port's key sees it. */
function catalogState({ loaded, failed, unreachable }: OpenaiVoices): string {
  if (!loaded) return "";
  return failed || unreachable ? "down" : "voices";
}

/** The project's focus, the standalone page's, and every way either changes. */
const focusedCell: FocusedCellPort = {
  read: readTerminalFocus,
  readStandalone: readStandaloneTerminalFocus,
  subscribe: (onChange) => {
    const unsubscribe = subscribeStandaloneTerminalFocus(onChange);
    window.addEventListener(TERMINAL_FOCUS_EVENT, onChange);
    return () => {
      unsubscribe();
      window.removeEventListener(TERMINAL_FOCUS_EVENT, onChange);
    };
  },
};

/**
 * Whether speech may synthesize with the OpenAI-compatible engine: it is the
 * engine, or a cascade member that is on. Then the OmniVoice list is loaded
 * at app level, so a saved openai voice is known after a page reload.
 */
function speaksWithOpenai(): boolean {
  const engine = getStoredEngine();
  if (engine === "openai") return true;
  return engine === CASCADE && getCascadeOrder().some((entry) => entry.id === "openai" && entry.on);
}

export function TerminalSpeechHost({ children }: { children: ReactNode }) {
  const drawerVisible = useTerminalDrawerVisible();
  // Subscriptions only: `speaksWithOpenai` reads both through `voices.ts`.
  usePreference(preferences.speechEngine);
  usePreference(preferences.speechCascadeOrder);
  usePreference(preferences.speechEngineByProject);
  usePrimeOpenaiVoices(speaksWithOpenai());
  // Any project may name a pocket engine, whatever the global one is: the workspace voice list
  // loads at app level so a saved voice (`piotr`) resolves after a page reload.
  usePrimePocketVoices(true);
  // A new language port each time a session becomes placed, and when the
  // OmniVoice list first lands: `languageForSession` answers `undefined` for a
  // session the list does not hold yet, and for a saved openai voice the list
  // has not named yet, and the host takes a new port as the moment to warm
  // what it skipped for that. Keyed on the placement, not the list, so a
  // rename or a title change is no warming opportunity.
  //
  // A load that failed, or found the OmniVoice server down, has landed too: it
  // settles the language (a saved openai voice it cannot name is dropped, as a
  // stale one is), so answers are not left unwarmed while the server is away.
  // A later load that succeeds is a new port again, so the answers after it
  // are warmed in the voice it names; those already prepared keep their units.
  const placement = useSyncExternalStore(subscribeSessionList, placementSignature);
  const portKey = `${placement}|${catalogState(useOpenaiVoicesSnapshot())}|${usePocketVoicesSnapshot().loaded}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the point: a new placement, a new port
  const languageFor = useCallback((sessionId: string) => languageForSession(sessionId), [portKey]);
  return (
    <SpeechHostProvider
      sessionOf={sessionOf}
      isSessionOpen={isSessionOpen}
      focusedCell={focusedCell}
      drawerVisible={drawerVisible}
      onArrival={dismissAttentionOnArrival}
      answerWaiting={answerWaiting}
      voiceFor={voiceForSession}
      languageFor={languageFor}
    >
      {children}
    </SpeechHostProvider>
  );
}
