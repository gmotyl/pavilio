import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBusyAccumulator } from "../useBusyAccumulator";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-25T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useBusyAccumulator", () => {
  it("starts at 0", () => {
    const { result } = renderHook(() =>
      useBusyAccumulator({ project: "metro", agentBusy: false }),
    );
    expect(result.current.todayMinutes).toBe(0);
  });

  it("jumps to 15 on busy true → false → true sequence outside window", () => {
    const { result, rerender } = renderHook(
      ({ busy }) => useBusyAccumulator({ project: "metro", agentBusy: busy }),
      { initialProps: { busy: false } },
    );
    act(() => {
      rerender({ busy: true });
    });
    expect(result.current.todayMinutes).toBe(15);
  });

  it("persists open block to localStorage", () => {
    const { rerender } = renderHook(
      ({ busy }) => useBusyAccumulator({ project: "metro", agentBusy: busy }),
      { initialProps: { busy: false } },
    );
    act(() => {
      rerender({ busy: true });
    });
    const raw = localStorage.getItem("pavilio.time.metro");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).open).not.toBeNull();
  });

  it("reloads state when project prop changes (no cross-project bleed)", () => {
    // Seed A with 30 closed minutes, leave B empty.
    localStorage.setItem(
      "pavilio.time.A",
      JSON.stringify({ date: "2026-05-25", closedMinutes: 30, open: null }),
    );
    const { result, rerender } = renderHook(
      ({ project, busy }: { project: string; busy: boolean }) =>
        useBusyAccumulator({ project, agentBusy: busy }),
      { initialProps: { project: "A", busy: false } },
    );
    expect(result.current.todayMinutes).toBe(30);
    // Switch to project B without remounting. Should reflect B's empty state.
    act(() => {
      rerender({ project: "B", busy: false });
    });
    expect(result.current.todayMinutes).toBe(0);
    // And going back to A restores A's 30 minutes.
    act(() => {
      rerender({ project: "A", busy: false });
    });
    expect(result.current.todayMinutes).toBe(30);
  });

  it("does not accumulate or persist when project is empty", () => {
    const { result, rerender } = renderHook(
      ({ busy }) => useBusyAccumulator({ project: "", agentBusy: busy }),
      { initialProps: { busy: false } },
    );
    act(() => {
      rerender({ busy: true });
    });
    expect(result.current.todayMinutes).toBe(0);
    expect(localStorage.getItem("pavilio.time.")).toBeNull();
  });

  it("hydrates from localStorage and force-closes stale open block on mount", () => {
    localStorage.setItem(
      "pavilio.time.metro",
      JSON.stringify({
        date: "2026-05-25",
        closedMinutes: 0,
        open: {
          startMs: Date.UTC(2026, 4, 25, 10, 0),
          lockUntilMs: Date.UTC(2026, 4, 25, 10, 15),
        },
      }),
    );
    const { result } = renderHook(() =>
      useBusyAccumulator({ project: "metro", agentBusy: false }),
    );
    // 15min block was open and lock has expired → should be closed
    expect(result.current.todayMinutes).toBe(15);
  });
});
