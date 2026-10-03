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
