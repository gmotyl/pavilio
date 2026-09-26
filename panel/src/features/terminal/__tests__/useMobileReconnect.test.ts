import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The hook reports its own automatic reopens to the reconnect log. Stub the
// pool module rather than importing xterm into this jsdom-only test.
const reportAutoBlankReopen = vi.hoisted(() => vi.fn());
const reportAutoReturnReopen = vi.hoisted(() => vi.fn());
vi.mock("../terminalInstances", () => ({
  reportAutoBlankReopen,
  reportAutoReturnReopen,
}));

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
    reportAutoReturnReopen.mockClear();
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

  // Reopening a live socket over content is exactly the unasked repaint the
  // blank gate exists for, and ADR 0017 leaves that case alone.
  it("does not reopen an OPEN socket on return with content on screen", () => {
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
    expect(reportAutoReturnReopen).not.toHaveBeenCalled();
    expect(reportAutoBlankReopen).not.toHaveBeenCalled();
  });

  // The nudge resizes the PTY twice, so the TUI fully redraws — visible as a
  // flicker. It is only worth that when the buffer has nothing to repaint from.
  it("still nudges an OPEN socket when the viewport is blank", () => {
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
    expect(reportAutoReturnReopen).not.toHaveBeenCalled();
    // Nothing was reopened here, so neither reporter may fire: a row on the
    // nudge path would inflate the unasked-reopen counts with non-reopens.
    expect(reportAutoBlankReopen).not.toHaveBeenCalled();
  });

  // ADR 0017: a CLOSED socket produces no output, so a reopen has nothing to
  // scroll away — the gate was never protecting this case. Returning to the
  // application is the consent that repairs it, whatever is on screen.
  it("reopens a CLOSED socket on return with content on screen", () => {
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
    expect(reopen).toHaveBeenCalledTimes(1);
    expect(reportAutoReturnReopen).toHaveBeenCalledTimes(1);
    expect(reportAutoReturnReopen).toHaveBeenCalledWith(ws);
    // Nothing goes out over a dead socket — send() on CLOSED throws.
    expect(sent).toEqual([]);
  });

  // The row must name the reason a reader would recognise. With a closed
  // socket the blank viewport is incidental: the return is what reopened it,
  // and attributing it to `auto-blank` would hide the trigger under review.
  it("reports auto-return rather than auto-blank when the viewport is blank", () => {
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
    expect(reportAutoReturnReopen).toHaveBeenCalledTimes(1);
    expect(reportAutoReturnReopen).toHaveBeenCalledWith(ws);
    expect(reportAutoBlankReopen).not.toHaveBeenCalled();
  });

  // Both the return path and the blank gate can see the same closed socket;
  // only one of them may act on it, or the session is rebuilt twice.
  it("reopens only once when the viewport is blank and the socket is closed", () => {
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

  // No socket at all is the same stranded state as a closed one: there is
  // nothing that will ever repair it, and nothing on screen it can spoil.
  it("reopens and reports auto-return when there is no socket", () => {
    const reopen = vi.fn();
    renderHook(() =>
      useMobileReconnect({
        ws: null,
        getDims: () => ({ cols: 100, rows: 30 }),
        reopen,
        isViewportBlank: () => false,
      }),
    );
    becomeVisible();
    expect(reopen).toHaveBeenCalledTimes(1);
    expect(reportAutoReturnReopen).toHaveBeenCalledTimes(1);
    expect(reportAutoReturnReopen).toHaveBeenCalledWith(null);
  });

  // The row has to describe the socket that prompted the reopen, not its
  // replacement. `reopen` here swaps the socket the way the pool does, so a
  // report made afterwards would read CONNECTING off the fresh one — the
  // recorded readyState, not just the call order, is what pins the ordering.
  it("reports before reopening", () => {
    const { ws } = fakeWs(3); // CLOSED
    const order: string[] = [];
    const seenReadyState: number[] = [];
    reportAutoReturnReopen.mockImplementation((socket: WebSocket | null) => {
      order.push("report");
      seenReadyState.push(socket ? socket.readyState : -1);
    });
    const reopen = vi.fn(() => {
      order.push("reopen");
      // The pool hands the cell a brand-new socket; the old reference is the
      // only thing the report could still have described.
      Object.assign(ws, { readyState: 0 }); // CONNECTING
    });
    renderHook(() =>
      useMobileReconnect({
        ws,
        getDims: () => ({ cols: 100, rows: 30 }),
        reopen,
        isViewportBlank: () => false,
      }),
    );
    becomeVisible();
    expect(order).toEqual(["report", "reopen"]);
    expect(seenReadyState).toEqual([3]);
    reportAutoReturnReopen.mockReset();
  });

  it("still does not reopen a silent foregrounded socket with content on screen", () => {
    // The flicker fix: reopening over live content interrupts work, so a stale
    // socket with a non-blank viewport is left for the manual Reconnect button.
    // A return did not happen here — the tab was foregrounded the whole time.
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
    expect(reportAutoReturnReopen).not.toHaveBeenCalled();
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
  // A CONNECTING socket is the case the blank gate still owns: the return path
  // takes only the sockets that are CLOSED or absent.
  it("reports the blank-gated refocus reopen to the log", () => {
    const { ws } = fakeWs(0); // CONNECTING
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
    expect(reportAutoReturnReopen).not.toHaveBeenCalled();
  });
});
