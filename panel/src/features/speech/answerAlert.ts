/**
 * The **answer alert**: an in-page info card raised for every answer that
 * ARRIVES, in any cell, whatever its speech mode — so an answer landing in a
 * cell (or a project) the user is not looking at is noticed without listening
 * for it.
 *
 * Two things keep it from being noise:
 *
 * - The cell the user is already looking at raises nothing: the focused cell,
 *   while its project's terminals are on screen and the tab is visible. A
 *   hidden tab is not looking at anything, so there even that cell raises one.
 * - Only a LIVE arrival counts. Answers recovered from `/api/speech/latest` —
 *   the mount hydration and a reconnect's catch-up (ADR 0017) — are shown in
 *   their cells, never announced: they are the past, not news.
 *
 * One card per cell (`answer-<sessionId>`): a second answer while the first's
 * card is up refreshes it in place rather than stacking. Clicking the card is
 * the notification's own tap — `arriveFromNotification` — so it lands on the
 * cell exactly the way a tapped system notification does.
 *
 * The decision is pure; the raise is a thin call into the alerts store. The
 * provider supplies everything this cannot know itself (the session list,
 * what is on screen, the router's navigate) — see `SpeechHostProvider`.
 */
import { alerts } from "../alerts/store";
import {
  arriveFromNotification,
  NOTIFICATION_CLICK_MESSAGE_TYPE,
} from "../notifications/notificationClickTarget";
import { answerPreview, terminalLabel } from "../notifications/notificationText";
import { matchProjectFromPath } from "../projects/matchProjectFromPath";

export function shouldRaiseAnswerAlert(input: {
  sessionId: string;
  recovered: boolean;
  focusedVisibleSessionId: string | null;
  documentVisible: boolean;
}): boolean {
  const { sessionId, recovered, focusedVisibleSessionId, documentVisible } = input;
  if (recovered) return false;
  return !(documentVisible && focusedVisibleSessionId === sessionId);
}

export function raiseAnswerAlert(input: {
  sessionId: string;
  project: string;
  terminalLabel: string;
  markdown: string;
  arrive: () => void;
}): void {
  const { sessionId, project, terminalLabel: label, markdown, arrive } = input;
  const detail = answerPreview(markdown);
  alerts.info(`${project} · ${label}`, {
    id: `answer-${sessionId}`,
    detail: detail || undefined,
    onClick: arrive,
  });
}

/** What the alert needs from the panel around the speech host. */
export interface AnswerAlertDeps {
  /** The session's project and names, or undefined for a session the panel does not know. */
  sessionOf: (sessionId: string) => { project: string; name: string; title?: string } | undefined;
  /** The focused cell, when its project's terminals are on screen; else null. */
  focusedVisibleSessionId: () => string | null;
  documentVisible: () => boolean;
  /** The router's navigate, for the click. */
  navigate: (path: string) => void;
}

/**
 * Decides and raises for one answer the channel took up. `recovered` is the
 * channel's own word for it: true for anything read off `/latest`.
 *
 * An answer for a session the panel does not list raises nothing: there is no
 * project to name or to arrive at.
 */
export function alertOnAnswer(
  answer: { sessionId: string; text: string },
  recovered: boolean,
  deps: AnswerAlertDeps,
): void {
  const { sessionId, text } = answer;
  const raise = shouldRaiseAnswerAlert({
    sessionId,
    recovered,
    focusedVisibleSessionId: deps.focusedVisibleSessionId(),
    documentVisible: deps.documentVisible(),
  });
  if (!raise) return;
  const session = deps.sessionOf(sessionId);
  if (!session) return;

  raiseAnswerAlert({
    sessionId,
    project: session.project,
    terminalLabel: terminalLabel(session),
    markdown: text,
    arrive: () => arriveAtCell(sessionId, session.project, deps),
  });
}

/**
 * A click on a speech alert: the notification's own tap, `arriveFromNotification`
 * — route to the cell's project, focus the cell, clear its attention LED. Shared
 * by the answer alert and the speaking alert (`speakingAlert.ts`), so both land
 * on a cell exactly the way a tapped system notification does.
 */
export function arriveAtCell(
  sessionId: string,
  project: string,
  deps: Pick<AnswerAlertDeps, "sessionOf" | "navigate">,
): void {
  // The dismiss wait it returns times itself out, and a click is a one-off;
  // nothing here outlives it to cancel it.
  arriveFromNotification(
    { type: NOTIFICATION_CLICK_MESSAGE_TYPE, sessionId, project },
    {
      projectOf: (id) => deps.sessionOf(id)?.project,
      navigate: deps.navigate,
    },
  );
}

/**
 * The focused cell when its project's terminals are on screen — the project's
 * terminals tab, or the terminal drawer over another of its tabs — else null.
 * In the grid every cell is visible; in Max and on a phone the focused one is
 * the one shown (`visibleSessionId`), so "focused" is the cell being looked at
 * either way. The standalone `/terminals` page keeps its focus to itself, so
 * there nothing counts as looked at and every answer alerts.
 */
export function focusedVisibleSessionIdFor(
  pathname: string,
  drawerVisible: boolean,
  readFocus: (project: string) => string | null,
): string | null {
  const match = matchProjectFromPath(pathname);
  if (!match) return null;
  if (match.section !== "iterm" && !drawerVisible) return null;
  return readFocus(match.name);
}
