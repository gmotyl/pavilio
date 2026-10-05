import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preferences } from "../../../preferences/declarations";
import {
  PREFERENCE_PATCH_DEBOUNCE_MS,
  __resetPreferenceStoreForTests,
  readPreference,
  writePreference,
} from "../../../preferences/store";
import PreferencesReadOnlyAlert from "../PreferencesReadOnlyAlert";
import { __resetAlertsForTests, getAlertsSnapshot, userDismissAlert } from "../store";

// The store subscribes to the realtime channel; jsdom has no WebSocket.
vi.mock("../../realtime/channel", () => ({
  subscribeRealtime: () => () => {},
  __resetRealtimeChannelForTests: () => {},
}));

type PrefGlobals = {
  __PAVILIO_PREFS__?: Record<string, unknown>;
  __PAVILIO_PREFS_READONLY__?: boolean;
};
const globals = globalThis as unknown as PrefGlobals;

const ALERT_ID = "preferences-read-only";

let fetchMock: ReturnType<typeof vi.fn>;

function patchCalls(): unknown[][] {
  return fetchMock.mock.calls.filter(([url, init]) => {
    const method = (init as RequestInit | undefined)?.method;
    return String(url) === "/api/preferences" && method === "PATCH";
  });
}

beforeEach(() => {
  globals.__PAVILIO_PREFS__ = { version: 2 };
  fetchMock = vi.fn(async () => new Response('{"ok":true,"persisted":false}', { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  delete globals.__PAVILIO_PREFS__;
  delete globals.__PAVILIO_PREFS_READONLY__;
  localStorage.clear();
  sessionStorage.clear();
  __resetPreferenceStoreForTests();
  __resetAlertsForTests();
  vi.unstubAllGlobals();
});

describe("PreferencesReadOnlyAlert", () => {
  it("raises one persistent warning when preferences are read-only", () => {
    globals.__PAVILIO_PREFS_READONLY__ = true;
    render(<PreferencesReadOnlyAlert />);

    const live = getAlertsSnapshot();
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({
      id: ALERT_ID,
      kind: "warning",
      title: "Preferences are read-only",
      detail:
        "The preferences file was written by a newer panel. Changes last until the panel restarts.",
      persistent: true,
    });
  });

  it("raises nothing when the flag is false or missing", () => {
    globals.__PAVILIO_PREFS_READONLY__ = false;
    const first = render(<PreferencesReadOnlyAlert />);
    expect(getAlertsSnapshot()).toEqual([]);
    first.unmount();

    delete globals.__PAVILIO_PREFS_READONLY__;
    render(<PreferencesReadOnlyAlert />);
    expect(getAlertsSnapshot()).toEqual([]);
  });

  it("raises nothing once dismissed this tab session", () => {
    globals.__PAVILIO_PREFS_READONLY__ = true;
    writePreference(preferences.readOnlyAlertDismissed, true);

    render(<PreferencesReadOnlyAlert />);
    expect(getAlertsSnapshot()).toEqual([]);
  });

  it("dismissing records the session-scoped preference without a PATCH", () => {
    vi.useFakeTimers();
    globals.__PAVILIO_PREFS_READONLY__ = true;
    render(<PreferencesReadOnlyAlert />);
    expect(getAlertsSnapshot()).toHaveLength(1);

    act(() => userDismissAlert(ALERT_ID));
    // Past the PATCH window: a portable write would have flushed by now.
    act(() => vi.advanceTimersByTime(PREFERENCE_PATCH_DEBOUNCE_MS * 5));

    expect(getAlertsSnapshot()).toEqual([]);
    expect(readPreference(preferences.readOnlyAlertDismissed)).toBe(true);
    expect(sessionStorage.length).toBe(1);
    expect(localStorage.length).toBe(0);
    expect(patchCalls()).toEqual([]);
  });

  it("a later preference write does not re-raise the alert", () => {
    globals.__PAVILIO_PREFS_READONLY__ = true;
    const view = render(<PreferencesReadOnlyAlert />);
    expect(getAlertsSnapshot()).toHaveLength(1);
    const raisedSeq = getAlertsSnapshot()[0].seq;

    act(() => {
      writePreference(preferences.leftSidebarExpanded, false);
      writePreference(preferences.notificationsOn, true);
    });
    view.rerender(<PreferencesReadOnlyAlert />);

    const live = getAlertsSnapshot();
    expect(live).toHaveLength(1);
    // Not refreshed in place either: a re-push of the same id is a second raise.
    expect(live[0].seq).toBe(raisedSeq);
  });
});
