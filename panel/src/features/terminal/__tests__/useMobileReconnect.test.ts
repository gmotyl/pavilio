import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The hook reports its own automatic reopens to the reconnect log. Stub the
// pool module rather than importing xterm into this jsdom-only test.
const reportAutoBlankReopen = vi.hoisted(() => vi.fn());
vi.mock("../terminalInstances", () => ({ reportAutoBlankReopen }));

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
  beforeEach(() => {
    reportAutoBlankReopen.mockClear();
    vi.useFakeTimers();
  });
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


  // A dead socket is not on its own a reason to repaint: reopening scrolls
  // away live output. The socket's own close event marks the session
  // disconnected (see onConnectionChange in terminalInstances.ts) and the UI
  // offers a manual reconnect instead.
  it("does not reopen on refocus when the socket is closed and the viewport has content", () => {
    const { ws, sent } = fakeWs(3); // CLOSED
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
    expect(reopen).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  // Removing the ungated path must not eat the blank-gated one: a terminal
  // that came back empty still refills itself. It must reopen rather than
  // nudge, because send() on a CLOSED socket throws.
  it("still reopens on refocus when the socket is closed and the viewport is blank", () => {
    const { ws, sent } = fakeWs(3); // CLOSED
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
    expect(reopen).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
  });

  it("watchdog does NOT reopen after >25s of silence while content is on screen", () => {
    // The flicker fix: reopening over live content interrupts work, so a stale
    // socket with a non-blank viewport is left for the manual Reconnect button.
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
    expect(reopen).not.toHaveBeenCalled();
  });

  it("watchdog reopens after >25s of silence only when the viewport is blank", () => {
    const { ws } = fakeWs(1);
    const reopen = vi.fn();
    renderHook(() =>
      useMobileReconnect({
        ws,
        getDims: () => ({ cols: 100, rows: 30 }),
        reopen,
        isViewportBlank: () => true,
      }),
    );
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

  // Both blank-gated paths reopen without anyone clicking anything. Unreported,
  // they are invisible in the log — the very gap that makes today's nine
  // manual-only lines unable to answer whether automation would have helped.
  it("reports the blank-gated refocus reopen to the log", () => {
    const { ws } = fakeWs(3); // CLOSED
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
    expect(reopen).toHaveBeenCalledTimes(1);
    expect(reportAutoBlankReopen).toHaveBeenCalledTimes(1);
    // Reported with the socket it holds, and BEFORE the reopen, so the metric
    // describes the state that prompted it rather than the fresh socket.
    expect(reportAutoBlankReopen).toHaveBeenCalledWith(ws);
    expect(reportAutoBlankReopen.mock.invocationCallOrder[0]).toBeLessThan(
      reopen.mock.invocationCallOrder[0],
    );
  });

  it("reports the watchdog's blank-gated reopen to the log", () => {
    const { ws } = fakeWs(1);
    const reopen = vi.fn();
    renderHook(() =>
      useMobileReconnect({
        ws,
        getDims: () => ({ cols: 100, rows: 30 }),
        reopen,
        isViewportBlank: () => true,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(26_000);
    });
    expect(reopen).toHaveBeenCalled();
    expect(reportAutoBlankReopen).toHaveBeenCalledWith(ws);
    // Same ordering contract as the refocus path: reported first, so the
    // metric describes the stale socket rather than its replacement.
    expect(reportAutoBlankReopen.mock.invocationCallOrder[0]).toBeLessThan(
      reopen.mock.invocationCallOrder[0],
    );
  });

  it("reports nothing on the paths that do not reopen", () => {
    const { ws } = fakeWs(1);
    renderHook(() =>
      useMobileReconnect({
        ws,
        getDims: () => ({ cols: 100, rows: 30 }),
        reopen: vi.fn(),
        // Content on screen: the nudge path and the silent watchdog path.
        isViewportBlank: () => false,
      }),
    );
    becomeVisible();
    act(() => {
      vi.advanceTimersByTime(26_000);
    });
    expect(reportAutoBlankReopen).not.toHaveBeenCalled();
  });
});
