import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  __resetRealtimeChannelForTests,
  realtimeSubscriberCount,
} from "../channel";
import { useWebSocket } from "../useWebSocket";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;

  readyState = 1; // treat as open immediately; the real one opens async
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  /** Simulate a server frame. */
  deliver(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

let visibility = "visible";

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  __resetRealtimeChannelForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useWebSocket", () => {
  it("starts with no message", () => {
    const { result } = renderHook(() => useWebSocket());

    expect(result.current.lastMessage).toBeNull();
  });

  it("surfaces a frame that arrives while mounted", () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => last().deliver({ type: "file-change", path: "/a.md" }));

    expect(result.current.lastMessage).toEqual({
      type: "file-change",
      path: "/a.md",
    });

    // Consumers key their effects off `lastMessage`, so an identical repeat
    // frame still has to change identity or the refetch never re-runs.
    const first = result.current.lastMessage;
    act(() => last().deliver({ type: "file-change", path: "/a.md" }));
    expect(result.current.lastMessage).toEqual(first);
    expect(result.current.lastMessage).not.toBe(first);
  });

  it("two consumers share one socket", () => {
    const a = renderHook(() => useWebSocket());
    const b = renderHook(() => useWebSocket());

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(realtimeSubscriberCount()).toBe(2);

    act(() => last().deliver({ type: "ping" }));

    expect(a.result.current.lastMessage).toEqual({ type: "ping" });
    expect(b.result.current.lastMessage).toEqual({ type: "ping" });
  });

  it("unmounting releases the subscription without closing the socket", () => {
    const a = renderHook(() => useWebSocket());
    renderHook(() => useWebSocket());
    expect(realtimeSubscriberCount()).toBe(2);

    act(() => a.unmount());

    expect(realtimeSubscriberCount()).toBe(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].closed).toBe(false);
  });

  it("a consumer mounted after a frame starts empty", () => {
    const early = renderHook(() => useWebSocket());
    act(() => last().deliver({ type: "file-change", path: "/a.md" }));
    expect(early.result.current.lastMessage).not.toBeNull();

    const late = renderHook(() => useWebSocket());

    expect(late.result.current.lastMessage).toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("remounting opens no new socket", () => {
    const first = renderHook(() => useWebSocket());
    act(() => first.unmount());

    const second = renderHook(() => useWebSocket());

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].closed).toBe(false);
    expect(second.result.current.lastMessage).toBeNull();
  });

  it("publishes a synthetic file-change after a reconnect, but not on first connect", () => {
    const { result } = renderHook(() => useWebSocket());
    expect(result.current.lastMessage).toBeNull();

    act(() => {
      vi.advanceTimersByTime(40_000); // watchdog closes the stale socket
    });
    act(() => {
      vi.advanceTimersByTime(2_000); // reconnect
    });

    expect(result.current.lastMessage).toMatchObject({
      type: "file-change",
      event: "reconnect",
    });
  });
});
