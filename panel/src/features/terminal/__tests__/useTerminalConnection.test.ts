import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub out xterm + its addons: terminalInstances (the real store this hook
// subscribes to) constructs a Terminal on acquire, and jsdom does not
// implement the surface xterm expects. Mirrors terminalInstances.test.ts.
vi.mock("@xterm/xterm", () => {
  class FakeTerminal {
    cols = 80;
    rows = 24;
    loadAddon = vi.fn();
    open = vi.fn();
    write = vi.fn();
    focus = vi.fn();
    scrollLines = vi.fn();
    dispose = vi.fn();
    refresh = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    onData = vi.fn((_cb: (data: string) => void) => ({ dispose: vi.fn() }));
  }
  return { Terminal: FakeTerminal };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {},
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// Subscription bookkeeping. The real `onConnectionChange` still does the work
// (state transitions are driven through the actual store, not faked), this
// only counts subscribe/unsubscribe pairs so the StrictMode symmetry
// assertion has something to look at.
const { subscribeCalls, unsubscribeCalls } = vi.hoisted(() => ({
  subscribeCalls: [] as string[],
  unsubscribeCalls: [] as string[],
}));

vi.mock("../terminalInstances", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../terminalInstances")>();
  return {
    ...actual,
    onConnectionChange: (
      sessionId: string,
      cb: (state: import("../terminalInstances").ConnectionState) => void,
    ) => {
      subscribeCalls.push(sessionId);
      const off = actual.onConnectionChange(sessionId, cb);
      return () => {
        unsubscribeCalls.push(sessionId);
        off();
      };
    },
  };
});

import {
  __setWebSocketCtorForTests,
  acquireTerminal,
  destroyTerminal,
  type ConnectionState,
} from "../terminalInstances";
import { useTerminalConnection } from "../useTerminalConnection";

interface FakeWs {
  url: string;
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
}

const createdSockets: FakeWs[] = [];

class FakeWebSocket implements FakeWs {
  url: string;
  readyState = 1; // OPEN
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
  });
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    createdSockets.push(this);
  }
}

describe("useTerminalConnection", () => {
  const acquired: string[] = [];

  /** Acquire a pooled instance and remember it for teardown. */
  function attach(sessionId: string) {
    acquired.push(sessionId);
    return acquireTerminal(sessionId);
  }

  /** Every fake socket ever opened for a session, oldest first. */
  function socketsFor(sessionId: string): FakeWs[] {
    return createdSockets.filter((s) => s.url.endsWith(`/${sessionId}`));
  }

  /** The socket the session is currently talking to. */
  function currentSocket(sessionId: string): FakeWs {
    const all = socketsFor(sessionId);
    return all[all.length - 1];
  }

  /** Simulate the browser delivering a close event on a fake socket. */
  function closeSocket(ws: FakeWs): void {
    ws.readyState = 3; // CLOSED
    ws.onclose?.(new Event("close") as CloseEvent);
  }

  /**
   * Render the hook, recording the value of *every* render — the stale-prime
   * bug shows up as a wrong first entry, which `result.current` alone hides.
   */
  function renderConnection(sessionId: string, strict = false) {
    const renders: ConnectionState[] = [];
    const utils = renderHook(
      ({ id }: { id: string }) => {
        const state = useTerminalConnection(id);
        renders.push(state);
        return state;
      },
      {
        initialProps: { id: sessionId },
        ...(strict ? { wrapper: StrictMode } : {}),
      },
    );
    return { ...utils, renders };
  }

  /** Collapse repeated renders of the same value (StrictMode double-invokes). */
  function seq(renders: ConnectionState[]): ConnectionState[] {
    return renders.filter((v, i) => v !== renders[i - 1]);
  }

  beforeEach(() => {
    createdSockets.length = 0;
    subscribeCalls.length = 0;
    unsubscribeCalls.length = 0;
    acquired.length = 0;
    __setWebSocketCtorForTests(
      FakeWebSocket as unknown as new (url: string) => WebSocket,
    );
  });

  afterEach(() => {
    for (const id of acquired) destroyTerminal(id);
    __setWebSocketCtorForTests(null);
  });

  it("primes from the current connection state on mount", () => {
    // No pooled instance in this browser: normal, not a fault.
    expect(renderConnection("never-attached").renders).toEqual(["unattached"]);

    attach("prime-session");
    expect(renderConnection("prime-session").renders).toEqual(["connected"]);

    // The hard case: mounting onto an already-dead socket must not paint
    // once with a healthy value before an event arrives (there is no event).
    closeSocket(currentSocket("prime-session"));
    expect(renderConnection("prime-session").renders).toEqual([
      "disconnected",
    ]);
  });

  it("re-renders when the socket closes", () => {
    attach("close-session");
    const { result, renders } = renderConnection("close-session");
    expect(result.current).toBe("connected");

    act(() => closeSocket(currentSocket("close-session")));

    expect(result.current).toBe("disconnected");
    expect(seq(renders)).toEqual(["connected", "disconnected"]);
  });

  it("re-renders when the socket reconnects", () => {
    const inst = attach("reopen-session");
    const { result, renders } = renderConnection("reopen-session");

    act(() => closeSocket(currentSocket("reopen-session")));
    expect(result.current).toBe("disconnected");

    // reopen() reports "connected" optimistically at the ws identity swap.
    act(() => {
      inst.reopen();
    });
    expect(result.current).toBe("connected");
    const rendersAfterSwap = renders.length;

    // The browser then reports "connected" again on open. That second emit
    // must cost ZERO renders — `seq()` collapses duplicates and so cannot see
    // the difference between "no re-render" and "re-rendered with the same
    // value", which is exactly the regression this pins.
    act(() => {
      currentSocket("reopen-session").onopen?.(new Event("open"));
    });
    expect(renders).toHaveLength(rendersAfterSwap);

    expect(result.current).toBe("connected");
    expect(seq(renders)).toEqual(["connected", "disconnected", "connected"]);
  });

  it("re-renders with unattached when the session is destroyed", () => {
    // "unattached" was only ever observed as a MOUNT-time value for a session
    // this browser never attached. Reaching it as a transition matters just as
    // much: the badge renders nothing for it, so a live terminal being
    // destroyed must clear the warning rather than freeze it as "disconnected".
    attach("destroy-session");
    const { result, renders } = renderConnection("destroy-session");
    expect(result.current).toBe("connected");

    act(() => destroyTerminal("destroy-session"));

    expect(result.current).toBe("unattached");
    expect(seq(renders)).toEqual(["connected", "unattached"]);
  });

  it("resubscribes when the session id changes", () => {
    attach("id-a");
    const inst = attach("id-b");
    closeSocket(currentSocket("id-b"));

    const renders: ConnectionState[] = [];
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => {
        const state = useTerminalConnection(id);
        renders.push(state);
        return state;
      },
      { initialProps: { id: "id-a" } },
    );
    expect(result.current).toBe("connected");

    const before = renders.length;
    rerender({ id: "id-b" });

    // Not one render may show id-a's "connected" after the switch. Asserted
    // against a literal, not against a map over the same slice — that form
    // passes vacuously when the slice is empty and would miss the hook failing
    // to render at all.
    expect(renders.slice(before)).toEqual(["disconnected"]);
    expect(result.current).toBe("disconnected");

    // The old id is no longer listened to...
    act(() => closeSocket(currentSocket("id-a")));
    expect(result.current).toBe("disconnected");

    // ...and the new one is.
    act(() => {
      inst.reopen();
      currentSocket("id-b").onopen?.(new Event("open"));
    });
    expect(result.current).toBe("connected");
  });

  it("unsubscribes on unmount", () => {
    attach("unmount-session");
    const { renders, unmount } = renderConnection("unmount-session");
    const rendersAtUnmount = renders.length;

    unmount();
    act(() => closeSocket(currentSocket("unmount-session")));

    expect(renders).toHaveLength(rendersAtUnmount);
    expect(subscribeCalls).toHaveLength(unsubscribeCalls.length);
  });

  it("subscribes and unsubscribes symmetrically under StrictMode", () => {
    // The panel has no production build — StrictMode is on for every user, so
    // the double effect invocation is the real runtime, not a dev artifact.
    attach("strict-session");
    const { result, renders, unmount } = renderConnection(
      "strict-session",
      true,
    );

    // A dead subscription (unsubscribed and never re-subscribed) shows up here.
    act(() => closeSocket(currentSocket("strict-session")));
    expect(result.current).toBe("disconnected");
    expect(seq(renders)).toEqual(["connected", "disconnected"]);

    unmount();
    expect(subscribeCalls.length).toBeGreaterThan(0);
    expect(unsubscribeCalls).toHaveLength(subscribeCalls.length);
  });
});
