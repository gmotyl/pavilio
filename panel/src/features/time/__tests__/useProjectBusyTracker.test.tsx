import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../terminal/useAllTerminalSessions", () => ({
  useAllTerminalSessions: vi.fn(),
}));

vi.mock("../../terminal/useTerminalActivityChannel", () => ({
  useAggregateActivityState: vi.fn(),
}));

import { useAllTerminalSessions } from "../../terminal/useAllTerminalSessions";
import { useAggregateActivityState } from "../../terminal/useTerminalActivityChannel";
import { useProjectBusyTracker } from "../useProjectBusyTracker";

const useAllTerminalSessionsMock = useAllTerminalSessions as unknown as ReturnType<
  typeof vi.fn
>;
const useAggregateActivityStateMock = useAggregateActivityState as unknown as ReturnType<
  typeof vi.fn
>;

interface FakeSession {
  id: string;
  project: string;
}

function setSessions(sessions: FakeSession[]): void {
  useAllTerminalSessionsMock.mockReturnValue({
    sessions,
    refresh: vi.fn(),
    reorder: vi.fn(),
    swapOrder: vi.fn(),
  });
}

function setAggregateState(state: "idle" | "busy" | "attention"): void {
  useAggregateActivityStateMock.mockReturnValue({
    state,
    attentionSinceAt: null,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-25T12:00:00Z"));
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ entry: {} }),
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  setSessions([]);
  setAggregateState("idle");
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useProjectBusyTracker", () => {
  it("idle baseline — no sessions busy → 0 minutes, no POST", () => {
    setSessions([{ id: "s1", project: "metro" }]);
    setAggregateState("idle");
    const { result } = renderHook(() => useProjectBusyTracker("metro"));
    expect(result.current.todayMinutes).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("busy starts accumulation → todayMinutes = 15", () => {
    setSessions([{ id: "s1", project: "metro" }]);
    setAggregateState("idle");
    const { result, rerender } = renderHook(() =>
      useProjectBusyTracker("metro"),
    );
    expect(result.current.todayMinutes).toBe(0);
    setAggregateState("busy");
    act(() => {
      rerender();
    });
    expect(result.current.todayMinutes).toBe(15);
  });

  it("block close fires POST /api/time/append with busy_block payload", async () => {
    setSessions([{ id: "s1", project: "metro" }]);
    setAggregateState("idle");
    const { rerender } = renderHook(() => useProjectBusyTracker("metro"));
    // flip to busy → opens 15min block
    setAggregateState("busy");
    act(() => {
      rerender();
    });
    // flip back to idle so no new busy events extend the lock
    setAggregateState("idle");
    act(() => {
      rerender();
    });
    // Advance past the 15-minute lock window; periodic tick (every 60s) will close the block.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16 * 60_000);
    });
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/time/append");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.project).toBe("metro");
    expect(body.entry.type).toBe("busy_block");
    expect(body.entry.minutes).toBe(15);
    expect(body.entry.minutes % 15).toBe(0);
    expect(typeof body.entry.start).toBe("string");
    expect(typeof body.entry.end).toBe("string");
    expect(body.entry.date).toBe("2026-05-25");
    expect(() => new Date(body.entry.start).toISOString()).not.toThrow();
    expect(() => new Date(body.entry.end).toISOString()).not.toThrow();
  });

  it("a busy session in another project does not advance this project's minutes", () => {
    // sessions belong to project "other"; only its sessions are busy
    setSessions([
      { id: "s-other", project: "other" },
      { id: "s-metro", project: "metro" },
    ]);
    // useAggregateActivityState is called with metro's session IDs only.
    // The mock returns whatever we set, but production code passes ONLY metro session ids
    // → so a busy "other" session does not affect this hook.
    // We assert this by having the mock return based on the ids it received:
    useAggregateActivityStateMock.mockImplementation((ids: readonly string[]) => {
      // "busy" only when the caller passed an "other" session id
      const hasOther = ids.includes("s-other");
      return {
        state: hasOther ? "busy" : "idle",
        attentionSinceAt: null,
      };
    });
    const { result } = renderHook(() => useProjectBusyTracker("metro"));
    expect(result.current.todayMinutes).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
