/**
 * A cold start's dismiss, end to end through the REAL arrival rule and the
 * REAL terminal pool — only xterm and the socket constructor are faked.
 *
 * `useNotifier.test.tsx` mocks the arrival rule and asserts the call; that
 * cannot see the timing that matters on a cold start. The page the worker
 * opens settles the tap as soon as the session list arrives, which is before
 * the cell has acquired its terminal (the notifier renders before the layout)
 * and possibly before the activity channel has said the session is waiting.
 * The plain rule would no-op there and leave the LED lit; these tests pin that
 * the dismiss waits until it can land, keeps it alive until the channel says
 * it took effect, and lets go cleanly when it never can.
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../terminal/useAllTerminalSessions", () => ({
  useAllTerminalSessions: vi.fn(),
}));

// jsdom cannot host xterm; the pool only needs something to hold.
vi.mock("@xterm/xterm", () => {
  class FakeTerminal {
    cols = 80;
    rows = 24;
    buffer = { active: { viewportY: 0, baseY: 0, getLine: () => undefined } };
    modes = { bracketedPasteMode: false };
    loadAddon = vi.fn();
    open = vi.fn();
    write = vi.fn();
    focus = vi.fn();
    scrollLines = vi.fn();
    dispose = vi.fn();
    refresh = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
  }
  return { Terminal: FakeTerminal };
});
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = vi.fn(); } }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { ARRIVAL_DISMISS_WAIT_MS } from "../notificationClickTarget";
import { useNotifier } from "../useNotifier";
import { useAllTerminalSessions } from "../../terminal/useAllTerminalSessions";
import type { SessionMeta } from "../../terminal/useTerminalSessions";
import {
  __setWebSocketCtorForTests,
  acquireTerminal,
  destroyTerminal,
} from "../../terminal/terminalInstances";
import {
  _activityListenerCountForTests,
  _applyEventForTests,
  _resetForTests,
} from "../../terminal/useTerminalActivityChannel";

/** A terminal socket that stays CONNECTING until a test opens it. */
class FakeWebSocket {
  static created: FakeWebSocket[] = [];
  readyState = 0;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
  });
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.created.push(this);
  }
}

function dismissFrames(socket: FakeWebSocket): number {
  return socket.send.mock.calls.filter(
    ([frame]) => typeof frame === "string" && JSON.parse(frame).type === "dismiss-attention",
  ).length;
}

function withSessions(sessions: SessionMeta[]): void {
  vi.mocked(useAllTerminalSessions).mockReturnValue({
    sessions,
    refresh: vi.fn(),
    reorder: vi.fn(),
    tiles: [],
    placeTiles: vi.fn(),
    applyPreset: vi.fn(),
  } as unknown as ReturnType<typeof useAllTerminalSessions>);
}

const s1: SessionMeta = {
  id: "s1",
  name: "term-s1",
  project: "pavilio",
  cwd: "/tmp",
  pid: 1,
  createdAt: "2026-10-03T00:00:00.000Z",
};

function renderAt(url: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  return renderHook(
    () => {
      const navigate = useNavigate();
      const location = useLocation();
      useNotifier({ navigate, location });
      return { ...location, navigate };
    },
    { wrapper },
  );
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Subscribers to s1's activity. Other parts of the page subscribe too (the
 * notifier, the cell's terminal), so a test reads this while the wait is live
 * and expects exactly one fewer once it is over.
 */
function listeners(): number {
  return _activityListenerCountForTests("s1");
}

function publish(state: "idle" | "busy" | "attention", at: number): void {
  act(() => {
    _applyEventForTests(
      state === "attention"
        ? { sessionId: "s1", state, at, attentionSinceAt: at }
        : { sessionId: "s1", state, at },
    );
  });
}

/**
 * A cold start up to the first dismiss: the tap is settled, the cell's socket
 * opens while the channel already says s1 is waiting, and one dismiss goes out.
 */
async function coldStartUntilFirstDismiss() {
  withSessions([]);
  const rendered = renderAt("/project/pavilio/iterm?notification=s1");
  withSessions([s1]);
  rendered.rerender();
  await advance(0);
  act(() => {
    acquireTerminal("s1");
  });
  const socket = FakeWebSocket.created[0];
  publish("attention", 1);
  socket.readyState = 1;
  await advance(250);
  expect(dismissFrames(socket)).toBe(1);
  return { ...rendered, socket, live: listeners() };
}

beforeEach(() => {
  vi.useFakeTimers();
  _resetForTests();
  FakeWebSocket.created.length = 0;
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true } as Response)));
  __setWebSocketCtorForTests(FakeWebSocket as unknown as new (url: string) => WebSocket);
});

afterEach(() => {
  destroyTerminal("s1");
  __setWebSocketCtorForTests(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a cold start's dismiss against the real pool", () => {
  it("is sent exactly once, when the session is in attention and its socket is open", async () => {
    withSessions([]);
    const { result, rerender } = renderAt("/project/pavilio/iterm?notification=s1");

    // The list arrives: the tap is settled, but there is no cell socket yet and
    // the channel has not said anything about s1.
    withSessions([s1]);
    rerender();
    await advance(0);
    expect(result.current.search).toBe("");
    await advance(500);

    // The cell mounts and starts connecting.
    act(() => {
      acquireTerminal("s1");
    });
    const socket = FakeWebSocket.created[0];
    const live = listeners();
    await advance(500);
    expect(dismissFrames(socket)).toBe(0);

    // The channel reports the session waiting while the socket is still connecting.
    act(() => {
      _applyEventForTests({ sessionId: "s1", state: "attention", at: 1, attentionSinceAt: 1 });
    });
    expect(dismissFrames(socket)).toBe(0);

    // The socket opens: the next look lands the dismiss.
    socket.readyState = 1;
    await advance(250);
    expect(dismissFrames(socket)).toBe(1);

    // The same episode republished is not a reason to send again.
    publish("attention", 1);
    await advance(1000);
    expect(dismissFrames(socket)).toBe(1);

    // The channel says it took effect: the wait is over.
    publish("idle", 2);
    expect(listeners()).toBe(live - 1);

    // And never again, however long the page stays.
    await advance(ARRIVAL_DISMISS_WAIT_MS * 2);
    publish("attention", 3);
    expect(dismissFrames(socket)).toBe(1);
  });

  it("sends again when the attach repaint swallowed the first dismiss", async () => {
    const { socket, live } = await coldStartUntilFirstDismiss();

    // The socket's resize made the server repaint: it was busy when the dismiss
    // arrived, dropped it, and settled back into attention.
    publish("busy", 2);
    expect(dismissFrames(socket)).toBe(1);
    publish("attention", 3);
    await advance(0);
    expect(dismissFrames(socket)).toBe(2);

    // This one lands.
    publish("idle", 4);
    expect(listeners()).toBe(live - 1);

    publish("busy", 5);
    publish("attention", 6);
    await advance(ARRIVAL_DISMISS_WAIT_MS);
    expect(dismissFrames(socket)).toBe(2);
  });

  it("sends at most three dismisses however often it flaps", async () => {
    const { socket, live } = await coldStartUntilFirstDismiss();

    for (let i = 0; i < 6; i++) {
      publish("busy", 10 + i * 2);
      publish("attention", 11 + i * 2);
      await advance(250);
    }
    expect(dismissFrames(socket)).toBe(3);
    await advance(ARRIVAL_DISMISS_WAIT_MS);
    expect(dismissFrames(socket)).toBe(3);
    expect(listeners()).toBe(live - 1);
  });

  it("stops waiting when the user leaves the arrived project", async () => {
    withSessions([]);
    const { result, rerender } = renderAt("/project/pavilio/iterm?notification=s1");
    withSessions([s1]);
    rerender();
    await advance(0);
    act(() => {
      acquireTerminal("s1");
    });
    const socket = FakeWebSocket.created[0];
    const live = listeners();

    // Moving within the project keeps the wait.
    act(() => {
      result.current.navigate("/project/pavilio/notes");
    });
    expect(listeners()).toBe(live);

    // Leaving it ends the wait.
    act(() => {
      result.current.navigate("/project/other/iterm");
    });
    expect(listeners()).toBe(live - 1);

    publish("attention", 1);
    socket.readyState = 1;
    await advance(1000);
    expect(dismissFrames(socket)).toBe(0);
  });

  it("gives up after the wait in silence and leaves nothing running", async () => {
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    withSessions([]);
    const { rerender } = renderAt("/project/pavilio/iterm?notification=s1");
    withSessions([s1]);
    rerender();
    await advance(0);
    const live = listeners();

    // Never ready: no socket and no attention for the whole wait.
    await advance(ARRIVAL_DISMISS_WAIT_MS);
    expect(vi.getTimerCount()).toBe(0);
    expect(listeners()).toBe(live - 1);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    // Ready only after it gave up: nothing is still listening to send.
    act(() => {
      acquireTerminal("s1");
    });
    const socket = FakeWebSocket.created[0];
    socket.readyState = 1;
    act(() => {
      _applyEventForTests({ sessionId: "s1", state: "attention", at: 1, attentionSinceAt: 1 });
    });
    await advance(1000);
    expect(dismissFrames(socket)).toBe(0);
  });

  it("stops waiting when the page unmounts", async () => {
    withSessions([]);
    const { rerender, unmount } = renderAt("/project/pavilio/iterm?notification=s1");
    withSessions([s1]);
    rerender();
    await advance(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(listeners()).toBe(0);

    act(() => {
      acquireTerminal("s1");
    });
    const socket = FakeWebSocket.created[0];
    socket.readyState = 1;
    act(() => {
      _applyEventForTests({ sessionId: "s1", state: "attention", at: 1, attentionSinceAt: 1 });
    });
    await advance(1000);
    expect(dismissFrames(socket)).toBe(0);
  });
});
