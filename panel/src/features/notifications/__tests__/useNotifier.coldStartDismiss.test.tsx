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
 * the dismiss waits until it can land, sends once, and lets go cleanly when it
 * never can.
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
import { _applyEventForTests, _resetForTests } from "../../terminal/useTerminalActivityChannel";

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
      return location;
    },
    { wrapper },
  );
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
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

    // And never again, however long the page stays.
    await advance(ARRIVAL_DISMISS_WAIT_MS * 2);
    act(() => {
      _applyEventForTests({ sessionId: "s1", state: "attention", at: 2, attentionSinceAt: 2 });
    });
    expect(dismissFrames(socket)).toBe(1);
  });

  it("gives up after the wait in silence and leaves nothing running", async () => {
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    withSessions([]);
    const { rerender } = renderAt("/project/pavilio/iterm?notification=s1");
    withSessions([s1]);
    rerender();
    await advance(0);

    // Never ready: no socket and no attention for the whole wait.
    await advance(ARRIVAL_DISMISS_WAIT_MS);
    expect(vi.getTimerCount()).toBe(0);
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
