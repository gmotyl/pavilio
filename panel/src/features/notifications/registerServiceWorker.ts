/**
 * Registers the panel's service worker (`public/sw.js`, served from the bundle
 * root). The worker exists only so notifications can be raised and clicked
 * through a registration — it handles no fetches and caches nothing, so the
 * panel behaves exactly as before whether or not this succeeds.
 *
 * Never rejects. No support (plain-HTTP LAN origin, old browser, jsdom) is the
 * normal case on some devices and resolves to null quietly; a failed
 * registration is reported once as a warning and also resolves to null, so a
 * caller at boot cannot take the panel down with it.
 */

/** Served by `express.static` from `dist/`, ahead of the SPA fallback. */
const WORKER_URL = "/sw.js";

/** Root scope, so the worker controls every panel route. */
const WORKER_SCOPE = "/";

/** Resolves to the registration, or null when the browser has no service worker support. */
export async function registerPanelServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;

  try {
    return await navigator.serviceWorker.register(WORKER_URL, { scope: WORKER_SCOPE });
  } catch (err) {
    console.warn("[panel] service worker registration failed; notifications stay in-page", err);
    return null;
  }
}

/**
 * Closes any outstanding notification raised for `sessionId` (its tag is the
 * session id — see `notificationText`).
 *
 * Fire-and-forget and synchronous to call: it never throws and never rejects,
 * because its caller is the arrival rule, which runs inside click, focus and
 * key handlers that must not learn about service workers. No support, no
 * registration, or a browser that refuses `getNotifications` all end in
 * silence; the worst case is a notification the user swipes away themselves.
 */
export function closeSessionNotifications(sessionId: string): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    void navigator.serviceWorker
      .getRegistration(WORKER_SCOPE)
      .then((registration) => registration?.getNotifications({ tag: sessionId }))
      .then((outstanding) => {
        for (const notification of outstanding ?? []) notification.close();
      })
      .catch(() => {
        // Nothing to close, or no way to reach it: see above.
      });
  } catch {
    // A container without `getRegistration` (a partial stub, an old engine).
  }
}
