import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../terminal/useAllTerminalSessions", () => ({
  useAllTerminalSessions: vi.fn(),
}));

import { useAllTerminalSessions } from "../../terminal/useAllTerminalSessions";
import type { SessionMeta } from "../../terminal/useTerminalSessions";
import {
  _applyEventForTests,
  _resetForTests,
  type ActivityState,
} from "../../terminal/useTerminalActivityChannel";
import { notificationText } from "../notificationText";
import { setNotificationsEnabled } from "../notificationsEnabled";
import { useNotifier } from "../useNotifier";

const useAllTerminalSessionsMock = useAllTerminalSessions as unknown as ReturnType<
  typeof vi.fn
>;

function session(id: string, extra: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id,
    name: `term-${id}`,
    project: "pavilio",
    cwd: "/tmp",
    pid: 1,
    createdAt: "2026-10-03T00:00:00.000Z",
    ...extra,
  };
}

function withSessions(sessions: SessionMeta[]): void {
  useAllTerminalSessionsMock.mockReturnValue({
    sessions,
    refresh: vi.fn(),
    reorder: vi.fn(),
    tiles: [],
    placeTiles: vi.fn(),
    applyPreset: vi.fn(),
  });
}

/** Installs a fake `navigator.serviceWorker` whose registration records notifications. */
function stubServiceWorker() {
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const registration = { showNotification } as unknown as ServiceWorkerRegistration;
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      register: vi.fn().mockResolvedValue(registration),
      ready: Promise.resolve(registration),
    },
    configurable: true,
  });
  return showNotification;
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    get: () => state,
    configurable: true,
  });
}

/** Publishes a state on the activity channel, then lets the registration promise settle. */
async function publish(sessionId: string, state: ActivityState): Promise<void> {
  await act(async () => {
    _applyEventForTests({ sessionId, state, at: Date.now() });
    await Promise.resolve();
  });
  await flush();
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  _resetForTests();
  setVisibility("hidden");
  setNotificationsEnabled(true);
  vi.stubGlobal("Notification", { permission: "granted" });
});

afterEach(() => {
  _resetForTests();
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(document, "visibilityState");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("useNotifier", () => {
  it("shows a notification when a hidden session wants attention", async () => {
    const showNotification = stubServiceWorker();
    const s1 = session("s1", { title: "build" });
    withSessions([s1]);
    const latestUtteranceFor = vi.fn(() => "All tests pass.");

    renderHook(() => useNotifier({ latestUtteranceFor }));
    await flush();

    await publish("s1", "busy");
    expect(showNotification).not.toHaveBeenCalled();

    await publish("s1", "attention");

    const copy = notificationText({ session: s1, latestUtterance: "All tests pass." });
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith(copy.title, {
      body: copy.body,
      tag: copy.tag,
      data: copy.data,
    });
    expect(latestUtteranceFor).toHaveBeenCalledWith("s1");
  });

  it("shows one notification per session when two want attention", async () => {
    const showNotification = stubServiceWorker();
    withSessions([session("s1"), session("s2")]);

    renderHook(() => useNotifier());
    await flush();

    await publish("s1", "busy");
    await publish("s2", "busy");
    await publish("s1", "attention");
    await publish("s2", "attention");

    expect(showNotification).toHaveBeenCalledTimes(2);
    const tags = showNotification.mock.calls.map(
      ([, options]) => (options as NotificationOptions).tag,
    );
    expect(tags).toEqual(["s1", "s2"]);
  });

  it("does not re-show for a republished attention state", async () => {
    const showNotification = stubServiceWorker();
    withSessions([session("s1")]);

    renderHook(() => useNotifier());
    await flush();

    await publish("s1", "busy");
    await publish("s1", "attention");
    await publish("s1", "attention");

    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it("resubscribes when the session list changes without double-firing", async () => {
    const showNotification = stubServiceWorker();
    withSessions([session("s1"), session("s2")]);

    const { rerender } = renderHook(() => useNotifier());
    await flush();

    await publish("s1", "busy");
    await publish("s1", "attention");
    expect(showNotification).toHaveBeenCalledTimes(1);

    // s2 closes, s3 opens; s1 is in both lists and is still in attention.
    withSessions([session("s1"), session("s3")]);
    rerender();
    await flush();

    // Remaining in attention across the change is not a new edge.
    expect(showNotification).toHaveBeenCalledTimes(1);

    // A republish for s1 is still a republish: its previous state survived.
    await publish("s1", "attention");
    expect(showNotification).toHaveBeenCalledTimes(1);

    // The closed session's subscription is gone.
    await publish("s2", "attention");
    expect(showNotification).toHaveBeenCalledTimes(1);

    // The new session is subscribed, exactly once.
    await publish("s3", "busy");
    await publish("s3", "attention");
    expect(showNotification).toHaveBeenCalledTimes(2);
    expect((showNotification.mock.calls[1][1] as NotificationOptions).tag).toBe("s3");

    // s1 leaving attention and coming back is a fresh edge, raised once.
    await publish("s1", "busy");
    await publish("s1", "attention");
    expect(showNotification).toHaveBeenCalledTimes(3);
  });

  it("does nothing when there is no service worker registration", async () => {
    // jsdom ships no `navigator.serviceWorker`, so registration resolves to null.
    expect("serviceWorker" in navigator).toBe(false);
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    withSessions([session("s1")]);

    const { unmount } = renderHook(() => useNotifier());
    await flush();

    await expect(
      (async () => {
        await publish("s1", "busy");
        await publish("s1", "attention");
      })(),
    ).resolves.toBeUndefined();

    unmount();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
