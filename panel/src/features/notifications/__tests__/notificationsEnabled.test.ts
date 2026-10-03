import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getNotificationsEnabled,
  notificationsAvailability,
  requestNotificationsPermission,
  setNotificationsEnabled,
} from "../notificationsEnabled";
import { preferences } from "../../../preferences/declarations";
import { storageKey } from "../../../preferences/types";

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

const KEY = storageKey(preferences.notificationsOn);

/**
 * A stand-in for the browser's `Notification` constructor: only the two static
 * members this module reads. `requestPermission` flips `permission` the way a
 * real prompt answered by the user would.
 */
function stubNotification(
  permission: NotificationPermission,
  answer: NotificationPermission = permission,
) {
  const fake = {
    permission,
    requestPermission: vi.fn(async () => {
      fake.permission = answer;
      return answer;
    }),
  };
  vi.stubGlobal("Notification", fake);
  return fake;
}

beforeEach(() => {
  // A page that received its portable document, so a portable write WOULD land
  // in it — which is what makes "not touched" below mean something.
  globals.__PAVILIO_PREFS__ = { version: 1 };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete globals.__PAVILIO_PREFS__;
  localStorage.clear();
});

describe("the per-device notifications switch", () => {
  it("defaults to off", () => {
    expect(getNotificationsEnabled()).toBe(false);
  });

  it("stores the switch on this device and not in the portable document", () => {
    const before = { ...globals.__PAVILIO_PREFS__ };
    // An INSTANCE spy: in this repo a prototype spy on Storage is never reached.
    const setItem = vi.spyOn(localStorage, "setItem");

    expect(setNotificationsEnabled(true)).toBe(true);

    expect(setItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalledWith(KEY, "true");
    expect(globals.__PAVILIO_PREFS__).toEqual(before);
    expect(getNotificationsEnabled()).toBe(true);

    expect(setNotificationsEnabled(false)).toBe(false);
    expect(getNotificationsEnabled()).toBe(false);
    expect(globals.__PAVILIO_PREFS__).toEqual(before);
  });
});

describe("notification permission", () => {
  it("reports unsupported when the browser has no Notification API", async () => {
    vi.stubGlobal("Notification", undefined);

    expect(notificationsAvailability()).toBe("unsupported");
    await expect(requestNotificationsPermission()).resolves.toBe("unsupported");
  });

  it("reports denied without prompting when permission was already refused", async () => {
    const fake = stubNotification("denied");

    expect(notificationsAvailability()).toBe("denied");
    await expect(requestNotificationsPermission()).resolves.toBe("denied");
    expect(fake.requestPermission).not.toHaveBeenCalled();
  });

  it("reports granted after the user allows it", async () => {
    const fake = stubNotification("default", "granted");

    expect(notificationsAvailability()).toBe("default");
    await expect(requestNotificationsPermission()).resolves.toBe("granted");
    expect(fake.requestPermission).toHaveBeenCalledTimes(1);
    expect(notificationsAvailability()).toBe("granted");
  });

  it("resolves the current availability when the prompt itself fails", async () => {
    const fake = stubNotification("default");
    fake.requestPermission.mockRejectedValueOnce(new Error("not allowed"));
    await expect(requestNotificationsPermission()).resolves.toBe("default");

    fake.requestPermission.mockImplementationOnce(() => {
      throw new TypeError("legacy browser");
    });
    await expect(requestNotificationsPermission()).resolves.toBe("default");
  });
});
