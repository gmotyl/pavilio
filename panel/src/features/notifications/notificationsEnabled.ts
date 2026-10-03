/**
 * The per-device notifications switch, and the browser permission it pairs with.
 *
 * NOT PORTABLE: the switch lives in this browser's storage, never in the
 * workspace document, because the permission it depends on is granted per
 * device. Reads and writes go through the preference registry, which owns the
 * try/catch around storage.
 *
 * The permission side never throws: a browser without the Notification API
 * reports "unsupported", and a prompt that fails resolves to whatever
 * permission is in effect afterwards.
 */
import { preferences } from "../../preferences/declarations";
import { readPreference, writePreference } from "../../preferences/store";

export type NotificationsAvailability = "granted" | "denied" | "default" | "unsupported";

/** The browser's `Notification` constructor, or `undefined` where it is missing. */
function notificationApi(): typeof Notification | undefined {
  const api = (globalThis as { Notification?: typeof Notification }).Notification;
  return typeof api === "function" || (typeof api === "object" && api !== null)
    ? api
    : undefined;
}

/** False when nothing is stored, and when the stored value is malformed. */
export function getNotificationsEnabled(): boolean {
  return readPreference(preferences.notificationsOn);
}

/** Stores the switch on this device and returns the value now in effect. */
export function setNotificationsEnabled(on: boolean): boolean {
  writePreference(preferences.notificationsOn, on);
  return on;
}

/** The permission in effect right now, or "unsupported" without the API. */
export function notificationsAvailability(): NotificationsAvailability {
  const api = notificationApi();
  if (!api) return "unsupported";
  const permission = api.permission;
  return permission === "granted" || permission === "denied" ? permission : "default";
}

/** Requests permission; returns the availability now in effect. Never throws. */
export async function requestNotificationsPermission(): Promise<NotificationsAvailability> {
  const current = notificationsAvailability();
  // Only "default" may prompt: "denied" is final until the user changes it in
  // the browser, and asking again would raise nothing anyway.
  if (current !== "default") return current;
  try {
    // Older Safari takes a callback and returns undefined instead of a
    // promise; wrapping both forms in one promise covers either.
    await new Promise<void>((resolve, reject) => {
      const result = notificationApi()!.requestPermission(() => resolve());
      if (result && typeof result.then === "function") {
        result.then(() => resolve(), reject);
      }
    });
  } catch {
    // A refused or failed prompt is reported through the permission below.
  }
  return notificationsAvailability();
}
