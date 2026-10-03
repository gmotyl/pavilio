import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../terminal/useAllTerminalSessions", () => ({
  useAllTerminalSessions: vi.fn(),
}));

// The arrival rule is the terminal feature's, and pinned in
// `attentionDismiss.test.tsx`; here only the call is asserted.
const dismissAttentionOnArrival = vi.hoisted(() => vi.fn<(sessionId: string) => void>());
vi.mock("../../terminal/attentionArrival", () => ({
  dismissAttentionOnArrival: (sessionId: string) => dismissAttentionOnArrival(sessionId),
}));

/**
 * Every unsubscribe the notifier is handed, by session id, so a test can see
 * that a session leaving the list really dropped its subscription. The real
 * channel still does the work: the wrapper only records.
 */
const unsubscribesBySession = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>[]>());

vi.mock("../../terminal/useTerminalActivityChannel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../terminal/useTerminalActivityChannel")>();
  return {
    ...actual,
    subscribeActivity: (sessionId: string, fn: (state: ActivityState) => void) => {
      const unsub = vi.fn(actual.subscribeActivity(sessionId, fn));
      const list = unsubscribesBySession.get(sessionId) ?? [];
      list.push(unsub);
      unsubscribesBySession.set(sessionId, list);
      return unsub;
    },
  };
});

import { useAllTerminalSessions } from "../../terminal/useAllTerminalSessions";
import type { SessionMeta } from "../../terminal/useTerminalSessions";
import {
  _applyEventForTests,
  _resetForTests,
  type ActivityState,
} from "../../terminal/useTerminalActivityChannel";
import {
  readTerminalFocus,
  TERMINAL_FOCUS_EVENT,
  type TerminalFocusEventDetail,
} from "../../terminal/useTerminalSessions";
import {
  NOTIFICATION_CLICK_MESSAGE_TYPE,
  type NotificationClickMessage,
} from "../notificationClickTarget";
import { notificationText } from "../notificationText";
import { setNotificationsEnabled } from "../notificationsEnabled";
import { COLD_START_WAIT_MS, useNotifier } from "../useNotifier";

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
  // An EventTarget, so the worker's `message` events can be dispatched at it.
  const container = Object.assign(new EventTarget(), {
    register: vi.fn().mockResolvedValue(registration),
    ready: Promise.resolve(registration),
  });
  Object.defineProperty(navigator, "serviceWorker", {
    value: container,
    configurable: true,
  });
  return showNotification;
}

/** What the worker posts when a notification is tapped and a window exists. */
async function postClick(message: NotificationClickMessage): Promise<void> {
  await act(async () => {
    navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: message }));
    await Promise.resolve();
  });
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
  unsubscribesBySession.clear();
  dismissAttentionOnArrival.mockReset();
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

    // The closed session's subscription is gone: its unsubscribe ran, and a
    // state it publishes now reaches nothing of the notifier's.
    const s2Unsubs = unsubscribesBySession.get("s2") ?? [];
    expect(s2Unsubs).toHaveLength(1);
    expect(s2Unsubs[0]).toHaveBeenCalledTimes(1);
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

    // s2 comes back while sitting in attention. Leaving the list made the
    // notifier forget it, and nothing it published while gone was recorded, so
    // this is a first sight in attention: one notification for it.
    withSessions([session("s1"), session("s3"), session("s2")]);
    rerender();
    await flush();
    expect(showNotification).toHaveBeenCalledTimes(4);
    expect((showNotification.mock.calls[3][1] as NotificationOptions).tag).toBe("s2");
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

describe("tapping a notification", () => {
  it("navigates and dismisses attention for a session that still exists", async () => {
    stubServiceWorker();
    withSessions([session("s1", { project: "my project" })]);
    const navigate = vi.fn();
    const focused: TerminalFocusEventDetail[] = [];
    const onFocus = (e: Event) =>
      focused.push((e as CustomEvent<TerminalFocusEventDetail>).detail);
    window.addEventListener(TERMINAL_FOCUS_EVENT, onFocus);

    try {
      renderHook(() => useNotifier({ navigate }));
      await flush();

      await postClick({
        type: NOTIFICATION_CLICK_MESSAGE_TYPE,
        sessionId: "s1",
        project: "my project",
      });
      // The focus broadcast goes out on the next tick, after the navigation,
      // as every other cross-project jump in the panel does it.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(navigate).toHaveBeenCalledWith("/project/my%20project/iterm");
      // Persisted before navigating, so the project's surface mounts on it.
      expect(readTerminalFocus("my project")).toBe("s1");
      expect(focused).toEqual([{ project: "my project", sessionId: "s1" }]);
      expect(dismissAttentionOnArrival).toHaveBeenCalledWith("s1");
    } finally {
      window.removeEventListener(TERMINAL_FOCUS_EVENT, onFocus);
    }
  });

  it("navigates to the project without error when the session is gone", async () => {
    stubServiceWorker();
    withSessions([session("s1")]);
    const navigate = vi.fn();
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const focused = vi.fn();
    window.addEventListener(TERMINAL_FOCUS_EVENT, focused);

    try {
      renderHook(() => useNotifier({ navigate }));
      await flush();

      await postClick({
        type: NOTIFICATION_CLICK_MESSAGE_TYPE,
        sessionId: "gone",
        project: "pavilio",
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(navigate).toHaveBeenCalledWith("/project/pavilio/iterm");
      expect(readTerminalFocus("pavilio")).not.toBe("gone");
      expect(focused).not.toHaveBeenCalled();
      expect(dismissAttentionOnArrival).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(TERMINAL_FOCUS_EVENT, focused);
    }
  });

  it("ignores messages that are not a notification click", async () => {
    stubServiceWorker();
    withSessions([session("s1")]);
    const navigate = vi.fn();

    renderHook(() => useNotifier({ navigate }));
    await flush();

    await act(async () => {
      navigator.serviceWorker.dispatchEvent(
        new MessageEvent("message", { data: { type: "something-else", sessionId: "s1" } }),
      );
      await Promise.resolve();
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(dismissAttentionOnArrival).not.toHaveBeenCalled();
  });

  it("stops listening for clicks once unmounted", async () => {
    stubServiceWorker();
    withSessions([session("s1")]);
    const navigate = vi.fn();

    const { unmount } = renderHook(() => useNotifier({ navigate }));
    await flush();
    unmount();

    await postClick({
      type: NOTIFICATION_CLICK_MESSAGE_TYPE,
      sessionId: "s1",
      project: "pavilio",
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(dismissAttentionOnArrival).not.toHaveBeenCalled();
  });
});

describe("a cold start from a tapped notification", () => {
  /**
   * The page the worker opens when no panel window was running: a real router
   * at the worker's URL, with the notifier wired to it the way `Notifier` is.
   * Returns the router's location, so a test sees the URL it ends on.
   */
  function renderAt(url: string) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    );
    return renderHook(
      () => {
        const navigate = useNavigate();
        const location = useLocation();
        useNotifier({ navigate, location });
        return location;
      },
      { wrapper },
    );
  }

  it("focuses and dismisses the tapped session once the list loads, then clears the param", async () => {
    stubServiceWorker();
    // The list is not known yet at mount: the store fetches it after.
    withSessions([]);
    const focused: TerminalFocusEventDetail[] = [];
    const onFocus = (e: Event) =>
      focused.push((e as CustomEvent<TerminalFocusEventDetail>).detail);
    window.addEventListener(TERMINAL_FOCUS_EVENT, onFocus);

    try {
      const { result, rerender } = renderAt("/project/my%20project/iterm?notification=s%201");
      await flush();
      expect(dismissAttentionOnArrival).not.toHaveBeenCalled();
      expect(result.current.search).toBe("?notification=s%201");

      withSessions([
        session("s0", { project: "my project" }),
        session("s 1", { project: "my project" }),
      ]);
      rerender();
      await flush();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(readTerminalFocus("my project")).toBe("s 1");
      expect(focused).toEqual([{ project: "my project", sessionId: "s 1" }]);
      expect(dismissAttentionOnArrival).toHaveBeenCalledTimes(1);
      expect(dismissAttentionOnArrival).toHaveBeenCalledWith("s 1");
      // Stripped, so a reload does not arrive a second time.
      expect(result.current.pathname).toBe("/project/my%20project/iterm");
      expect(result.current.search).toBe("");

      // A later list change does not replay the arrival.
      withSessions([session("s 1", { project: "my project" })]);
      rerender();
      await flush();
      expect(dismissAttentionOnArrival).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(TERMINAL_FOCUS_EVENT, onFocus);
    }
  });

  it("clears the param without error when the loaded list lacks the session", async () => {
    stubServiceWorker();
    withSessions([session("s1")]);
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const focused = vi.fn();
    window.addEventListener(TERMINAL_FOCUS_EVENT, focused);

    try {
      const { result } = renderAt("/project/pavilio/iterm?notification=gone");
      await flush();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(result.current.pathname).toBe("/project/pavilio/iterm");
      expect(result.current.search).toBe("");
      expect(readTerminalFocus("pavilio")).not.toBe("gone");
      expect(focused).not.toHaveBeenCalled();
      expect(dismissAttentionOnArrival).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(TERMINAL_FOCUS_EVENT, focused);
    }
  });

  it("gives up and clears the param when no list ever arrives", async () => {
    vi.useFakeTimers();
    try {
      stubServiceWorker();
      withSessions([]);

      const { result } = renderAt("/project/pavilio/iterm?notification=s1");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_WAIT_MS - 1);
      });
      expect(result.current.search).toBe("?notification=s1");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.search).toBe("");
      expect(dismissAttentionOnArrival).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a URL without the param alone", async () => {
    stubServiceWorker();
    withSessions([session("s1")]);

    const { result } = renderAt("/project/pavilio/iterm?view=grid");
    await flush();

    expect(result.current.search).toBe("?view=grid");
    expect(dismissAttentionOnArrival).not.toHaveBeenCalled();
  });
});
