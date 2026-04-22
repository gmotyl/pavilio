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
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("sends mobile-nudge when tab becomes visible and ws is open", () => {
    const { ws, sent } = fakeWs(1);
    const reopen = vi.fn();
    renderHook(() =>
      useMobileReconnect({
        ws,
        getDims: () => ({ cols: 100, rows: 30 }),
        reopen,
      }),
    );
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
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
      }),
    );
    // No "message" events pushed → lastMessageAt stays at init.
    act(() => {
      vi.advanceTimersByTime(26_000);
    });
    expect(reopen).toHaveBeenCalled();
  });
});
