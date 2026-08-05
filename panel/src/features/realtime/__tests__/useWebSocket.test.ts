import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useWebSocket", () => {
  it("exposes the latest message", () => {
    const { result } = renderHook(() => useWebSocket());
    act(() => last().deliver({ type: "file-change", path: "/a.md" }));
    expect(result.current.lastMessage).toEqual({
      type: "file-change",
      path: "/a.md",
    });
  });

  it("reconnects when no frame arrives for longer than the stale window", () => {
    renderHook(() => useWebSocket());
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(40_000);
    });

    expect(FakeWebSocket.instances[0].closed).toBe(true);
    act(() => {
      vi.advanceTimersByTime(2_000); // reconnect backoff
    });
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
  });

  it("stays connected while server pings keep arriving", () => {
    renderHook(() => useWebSocket());
    for (let i = 0; i < 6; i++) {
      act(() => {
        vi.advanceTimersByTime(10_000);
        last().deliver({ type: "ping" });
      });
    }
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].closed).toBe(false);
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

  it("checks staleness immediately when the tab becomes visible", () => {
    renderHook(() => useWebSocket());

    // Background: timers are throttled in real browsers, so simulate the gap
    // without letting the watchdog interval run.
    visibility = "hidden";
    act(() => {
      vi.setSystemTime(Date.now() + 300_000);
      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(FakeWebSocket.instances[0].closed).toBe(true);
  });

  it("does not reconnect after unmount", () => {
    const { unmount } = renderHook(() => useWebSocket());
    act(() => unmount());
    const count = FakeWebSocket.instances.length;
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeWebSocket.instances).toHaveLength(count);
  });

  it("leaves no timer behind after unmount, even mid-reconnect", () => {
    const { unmount } = renderHook(() => useWebSocket());
    // Stall the socket so a reconnect timer is pending at unmount time.
    act(() => {
      vi.advanceTimersByTime(40_000);
    });
    act(() => unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});
