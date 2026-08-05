import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMobileReconnect } from "../useMobileReconnect";

function fakeWs(state: number) {
  const sent: string[] = [];
  return {
    ws: {
      readyState: state,
      send: (m: string) => sent.push(m),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as WebSocket,
    sent,
  };
}

describe("useMobileReconnect", () => {
  // The synthetic ws uses vi.fn() for addEventListener, so the hook's internal
  // "message" listener is stubbed; the watchdog tests exploit that fact to
  // simulate silence (no message events ever reach the ref).
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  function becomeVisible() {
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  // The nudge resizes the PTY twice, so the TUI fully redraws — visible as a
  // flicker. It is only worth that when the buffer has nothing to repaint from.
  it("does not nudge a healthy terminal that still has content", () => {
    const { ws, sent } = fakeWs(1);
    const reopen = vi.fn();
    renderHook(() =>
      useMobileReconnect({
        ws,
        getDims: () => ({ cols: 100, rows: 30 }),
        reopen,
        isViewportBlank: () => false,
      }),
    );
    becomeVisible();
    expect(sent).toEqual([]);
    expect(reopen).not.toHaveBeenCalled();
  });

  it("sends mobile-nudge when the viewport came back blank", () => {
    const { ws, sent } = fakeWs(1);
    const reopen = vi.fn();
    renderHook(() =>
      useMobileReconnect({
        ws,
        getDims: () => ({ cols: 100, rows: 30 }),
        reopen,
        isViewportBlank: () => true,
      }),
    );
    becomeVisible();
    expect(sent.some((m) => JSON.parse(m).type === "mobile-nudge")).toBe(true);
    expect(reopen).not.toHaveBeenCalled();
  });


  it("calls reopen when ws is closed on visibility return", () => {
    const { ws } = fakeWs(3); // CLOSED
    const reopen = vi.fn();
    renderHook(() =>
      useMobileReconnect({
        ws,
        getDims: () => ({ cols: 100, rows: 30 }),
        reopen,
        isViewportBlank: () => false,
      }),
    );
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it("watchdog triggers reopen after >25s of ws silence when visible", () => {
    const { ws } = fakeWs(1);
    const reopen = vi.fn();
    renderHook(() =>
      useMobileReconnect({
        ws,
        getDims: () => ({ cols: 100, rows: 30 }),
        reopen,
        isViewportBlank: () => false,
      }),
    );
    // No "message" events pushed → lastMessageAt stays at init.
    act(() => {
      vi.advanceTimersByTime(26_000);
    });
    expect(reopen).toHaveBeenCalled();
  });

  it("does not reopen while ws is still connecting (watchdog gates on OPEN)", () => {
    const { ws } = fakeWs(0); // CONNECTING
    const reopen = vi.fn();
    renderHook(() =>
      useMobileReconnect({
        ws,
        getDims: () => ({ cols: 100, rows: 30 }),
        reopen,
        isViewportBlank: () => false,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(26_000);
    });
    expect(reopen).not.toHaveBeenCalled();
  });
});
