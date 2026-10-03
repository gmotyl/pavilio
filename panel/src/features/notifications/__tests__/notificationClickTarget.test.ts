/**
 * The service worker's half of a tap: the REAL `public/sw.js`, loaded into a
 * sandbox with a fake `self` and `clients`, and handed a fake
 * `notificationclick` event. The worker cannot import from `src/`, so these
 * tests are what keep its copy of the message type and the project path in
 * step with `notificationClickTarget.ts`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  NOTIFICATION_CLICK_MESSAGE_TYPE,
  notificationArrivalPath,
  projectTerminalsPath,
  type NotificationClickMessage,
} from "../notificationClickTarget";

// panel/public/sw.js, four levels above `src/features/notifications/__tests__/`.
const swPath = resolve(__dirname, "../../../../public/sw.js");

const ORIGIN = "https://panel.example.ts.net";

interface FakeClient {
  url: string;
  focused: boolean;
  visibilityState: DocumentVisibilityState;
  focus: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}

function fakeClient(url: string, extra: Partial<FakeClient> = {}): FakeClient {
  const client: FakeClient = {
    url,
    focused: false,
    visibilityState: "hidden",
    focus: vi.fn(),
    postMessage: vi.fn(),
    ...extra,
  };
  // `WindowClient.focus()` resolves to the client it focused.
  client.focus.mockImplementation(() => Promise.resolve(client));
  return client;
}

/** Loads the shipped worker against fake globals and returns a click dispatcher. */
function loadWorker(windows: FakeClient[]) {
  const handlers = new Map<string, (event: unknown) => void>();
  const clients = {
    matchAll: vi.fn().mockResolvedValue(windows),
    openWindow: vi.fn().mockResolvedValue(null),
    claim: vi.fn().mockResolvedValue(undefined),
  };
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => handlers.set(type, fn),
    skipWaiting: vi.fn(),
    clients,
    location: { origin: ORIGIN },
  };
  runInNewContext(readFileSync(swPath, "utf8"), { self, URL, console });

  const click = async (data: unknown) => {
    const handler = handlers.get("notificationclick");
    if (!handler) throw new Error("sw.js registers no notificationclick handler");
    const notification = { data, tag: "", close: vi.fn() };
    const waited: Promise<unknown>[] = [];
    handler({ notification, waitUntil: (p: Promise<unknown>) => waited.push(p) });
    // The handler must hand its work to `waitUntil`, or the browser may stop
    // the worker before the window is focused or opened.
    expect(waited).toHaveLength(1);
    await Promise.all(waited);
    return notification;
  };

  return { clients, click };
}

describe("notificationclick in sw.js", () => {
  it("focuses an existing window and posts the session id", async () => {
    const elsewhere = fakeClient("https://other.example/project/x", { focused: true });
    const background = fakeClient(`${ORIGIN}/`);
    const visible = fakeClient(`${ORIGIN}/project/pavilio/iterm`, {
      visibilityState: "visible",
    });
    const { clients, click } = loadWorker([elsewhere, background, visible]);

    const notification = await click({ sessionId: "s1", project: "my project" });

    expect(notification.close).toHaveBeenCalledTimes(1);
    expect(clients.matchAll).toHaveBeenCalledWith({ type: "window", includeUncontrolled: true });
    // A client of another origin is never touched, even a focused one; of the
    // panel's own, the visible one is preferred.
    expect(elsewhere.focus).not.toHaveBeenCalled();
    expect(elsewhere.postMessage).not.toHaveBeenCalled();
    expect(background.focus).not.toHaveBeenCalled();
    expect(visible.focus).toHaveBeenCalledTimes(1);
    const message: NotificationClickMessage = {
      type: NOTIFICATION_CLICK_MESSAGE_TYPE,
      sessionId: "s1",
      project: "my project",
    };
    expect(visible.postMessage).toHaveBeenCalledWith(message);
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it("opens a window at the project, carrying the session, when none is running", async () => {
    const { clients, click } = loadWorker([fakeClient("https://other.example/")]);

    const notification = await click({ sessionId: "s 1&x", project: "a b#c" });

    expect(notification.close).toHaveBeenCalledTimes(1);
    // The session rides in the URL so the cold-started page can still arrive
    // at it: there is no window to post the message to.
    expect(clients.openWindow).toHaveBeenCalledWith(notificationArrivalPath("a b#c", "s 1&x"));
    expect(notificationArrivalPath("a b#c", "s 1&x")).toBe(
      "/project/a%20b%23c/iterm?notification=s%201%26x",
    );
    expect(projectTerminalsPath("a b#c")).toBe("/project/a%20b%23c/iterm");
  });

  it("opens the project's terminals when the notification carries no session", async () => {
    const { clients, click } = loadWorker([]);

    await click({ project: "pavilio" });

    expect(clients.openWindow).toHaveBeenCalledWith(projectTerminalsPath("pavilio"));
  });

  it("still posts when the browser refuses to focus the window", async () => {
    const only = fakeClient(`${ORIGIN}/`);
    only.focus.mockRejectedValue(new Error("not allowed to focus"));
    const { click } = loadWorker([only]);

    await click({ sessionId: "s1", project: "pavilio" });

    expect(only.postMessage).toHaveBeenCalledWith({
      type: NOTIFICATION_CLICK_MESSAGE_TYPE,
      sessionId: "s1",
      project: "pavilio",
    });
  });

  it("opens the panel root for a notification that carries no project", async () => {
    const { clients, click } = loadWorker([]);

    await click(undefined);

    expect(clients.openWindow).toHaveBeenCalledWith("/");
  });
});
