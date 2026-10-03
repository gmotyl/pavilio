/*
 * Pavilio panel service worker — notification-only.
 *
 * It exists so the panel can raise system notifications through a
 * registration (required on Android and by installed web apps) and route a
 * notification click back to the right session.
 *
 * Deliberately NO network interception and NO caching: the panel is a live
 * view of local terminals, and a stale cached shell or API answer would be
 * worse than none. Do not add a network-interception handler or Cache Storage
 * here without revisiting that decision (a test guards it).
 */

// Take over at once: there is no cached state an older worker could be
// relying on, so waiting for every tab to close buys nothing.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/*
 * A tapped notification arrives at its session.
 *
 * The page owns everything past "which window": navigating to the project,
 * focusing the cell and dismissing its attention all happen there
 * (`notificationClickTarget.ts`), because a cell is a position in a grid, not
 * a route the worker could open. So the worker closes the notification and
 * then either focuses a panel window and posts it the session, or — with no
 * window running — opens one at the session's project.
 *
 * This file cannot import from `src/`, so the message type and the path below
 * are copies of `NOTIFICATION_CLICK_MESSAGE_TYPE` and `projectTerminalsPath`
 * in `notificationClickTarget.ts`; `notificationClickTarget.test.ts` runs this
 * very file and holds the two to each other.
 */
const NOTIFICATION_CLICK_MESSAGE_TYPE = "pavilio-notification-click";

function projectTerminalsPath(project) {
  return "/project/" + encodeURIComponent(project) + "/iterm";
}

/** Panel windows only: never a client of another origin. Focused, then visible, first. */
function pickPanelWindow(windows) {
  const ours = windows.filter((client) => {
    try {
      return new URL(client.url).origin === self.location.origin;
    } catch {
      return false;
    }
  });
  return (
    ours.find((client) => client.focused) ||
    ours.find((client) => client.visibilityState === "visible") ||
    ours[0] ||
    null
  );
}

async function arriveAt(data) {
  const sessionId = data && typeof data.sessionId === "string" ? data.sessionId : null;
  const project = data && typeof data.project === "string" ? data.project : null;

  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const client = pickPanelWindow(windows);

  if (client) {
    // Focus can be refused (no user activation left, platform policy); the
    // page can still move to the session, so post either way.
    let target = client;
    try {
      target = (await client.focus()) || client;
    } catch {
      // Keep the unfocused client.
    }
    if (sessionId && project) {
      target.postMessage({ type: NOTIFICATION_CLICK_MESSAGE_TYPE, sessionId, project });
    }
    return;
  }

  await self.clients.openWindow(project ? projectTerminalsPath(project) : "/");
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Keep the worker alive until the window is focused or opened.
  event.waitUntil(
    arriveAt(event.notification.data).catch(() => {
      // matchAll/openWindow can reject (no window allowed, worker shutting
      // down); there is nothing left to do, but never surface it unhandled.
    }),
  );
});
