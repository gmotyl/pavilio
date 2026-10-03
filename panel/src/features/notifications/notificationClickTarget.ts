/**
 * Where a tapped notification takes the user, page side.
 *
 * The service worker (`public/sw.js`) handles the tap: it closes the
 * notification and either focuses a panel window and posts it a
 * {@link NotificationClickMessage}, or — with no window running — opens one at
 * {@link notificationArrivalPath}. The worker is plain JS served from
 * `public/` and cannot import this module, so it carries its own copies of the
 * message type and the paths; `notificationClickTarget.test.ts` loads the
 * shipped worker and holds the copies to the ones exported here.
 *
 * A cell is a position in a grid, not a route — the router addresses projects,
 * not cells — which is why the cell normally travels in the message. Only a
 * cold start, with no window to post to, carries it in the URL instead, as a
 * one-shot query parameter the page consumes and strips (`useNotifier`).
 */
import { dismissAttentionOnArrival } from "../terminal/attentionArrival";
import { dispatchTerminalFocus, writeTerminalFocus } from "../terminal/useTerminalSessions";

export const NOTIFICATION_CLICK_MESSAGE_TYPE = "pavilio-notification-click";

/** Posted by the service worker to a focused client; handled by useNotifier. */
export interface NotificationClickMessage {
  type: "pavilio-notification-click";
  sessionId: string;
  project: string;
}

export function isNotificationClickMessage(data: unknown): data is NotificationClickMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as Record<string, unknown>;
  return (
    message.type === NOTIFICATION_CLICK_MESSAGE_TYPE &&
    typeof message.sessionId === "string" &&
    typeof message.project === "string"
  );
}

/**
 * The project's terminal tab — where a session's cell lives. The same target
 * `QuickTerminalModal` and the phone sidebar use to land on a session, rather
 * than the bare `/project/<name>`, which `ProjectRedirect` may resolve to notes:
 * tapping a session's notification and landing anywhere but its terminals
 * would miss the point of the tap. Percent-encoded, because a project name may
 * hold a space or a `#`.
 */
export function projectTerminalsPath(project: string): string {
  return `/project/${encodeURIComponent(project)}/iterm`;
}

/** Query parameter a cold-started page reads the tapped session from. */
export const NOTIFICATION_SESSION_PARAM = "notification";

/**
 * Where the worker opens a window when none is running: the project's
 * terminals, carrying the tapped session so the page can still arrive at it.
 */
export function notificationArrivalPath(project: string, sessionId: string): string {
  return `${projectTerminalsPath(project)}?${NOTIFICATION_SESSION_PARAM}=${encodeURIComponent(sessionId)}`;
}

/** The tapped session a cold-start URL carries, or null when it carries none. */
export function notificationSessionFrom(search: string): string | null {
  const sessionId = new URLSearchParams(search).get(NOTIFICATION_SESSION_PARAM);
  return sessionId ? sessionId : null;
}

/** `search` without the cold-start parameter, other parameters kept ("" when none are left). */
export function withoutNotificationSession(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(NOTIFICATION_SESSION_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

export interface ArrivalDeps {
  /** The session's project if it still exists, else undefined. */
  projectOf: (sessionId: string) => string | undefined;
  navigate: (path: string) => void;
}

/**
 * The page's half of a tap: go to the project and, when the session is still
 * there, focus its cell and count the tap as arriving at it.
 *
 * The cell is focused the way every other cross-project jump does it
 * (`QuickTerminalModal.openDotTarget`, the spine drawer): persist the focus
 * for the project first, so a surface that mounts on the navigation reads it,
 * then navigate, then broadcast on the next tick for a surface that is already
 * mounted on that project and will not remount.
 *
 * A session that is gone (panel restarted, cell closed) lands on the project
 * and says nothing: a closed cell is the passage of time, not an error.
 */
export function arriveFromNotification(
  message: NotificationClickMessage,
  { projectOf, navigate }: ArrivalDeps,
): void {
  const project = projectOf(message.sessionId);
  if (project === undefined) {
    navigate(projectTerminalsPath(message.project));
    return;
  }
  writeTerminalFocus(project, message.sessionId);
  navigate(projectTerminalsPath(project));
  setTimeout(() => dispatchTerminalFocus(project, message.sessionId), 0);
  dismissAttentionOnArrival(message.sessionId);
}
