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
import type { ReactNode } from "react";
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
import { getSessions } from "./sessionStore";
import { voiceForSession } from "./sessionVoice";
import {
  readStandaloneTerminalFocus,
  subscribeStandaloneTerminalFocus,
} from "./standaloneTerminalFocus";
import { useTerminalDrawerVisible } from "./useTerminalDrawer";
import { readTerminalFocus, TERMINAL_FOCUS_EVENT } from "./useTerminalSessions";

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

export function TerminalSpeechHost({ children }: { children: ReactNode }) {
  const drawerVisible = useTerminalDrawerVisible();
  return (
    <SpeechHostProvider
      sessionOf={sessionOf}
      isSessionOpen={isSessionOpen}
      focusedCell={focusedCell}
      drawerVisible={drawerVisible}
      onArrival={dismissAttentionOnArrival}
      answerWaiting={answerWaiting}
      voiceFor={voiceForSession}
    >
      {children}
    </SpeechHostProvider>
  );
}
