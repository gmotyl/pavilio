/*
 * Pavilio panel service worker — notification-only.
 *
 * It exists so the panel can raise system notifications through a
 * registration (required on Android and by installed web apps) and, later,
 * route a notification click back to the right session.
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

// The notification click handler is added in a later task.
