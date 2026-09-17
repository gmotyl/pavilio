import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useReadyPulseWindow, READY_PULSE_MS } from "../useReadyPulseWindow";

describe("useReadyPulseWindow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pulses immediately when active with a key", () => {
    const { result } = renderHook(() => useReadyPulseWindow(true, "u1"));

    expect(result.current).toBe(true);
  });

  it("stops after READY_PULSE_MS", () => {
    const { result } = renderHook(() => useReadyPulseWindow(true, "u1"));

    act(() => {
      vi.advanceTimersByTime(READY_PULSE_MS - 1);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  it("a new key restarts the window", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string | null }) => useReadyPulseWindow(true, key),
      { initialProps: { key: "u1" as string | null } },
    );

    act(() => {
      vi.advanceTimersByTime(READY_PULSE_MS);
    });
    expect(result.current).toBe(false);

    rerender({ key: "u2" });
    expect(result.current).toBe(true);

    // The fresh window is a full one, not the remainder of the first.
    act(() => {
      vi.advanceTimersByTime(READY_PULSE_MS - 1);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  it("inactive is off at once", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useReadyPulseWindow(active, "u1"),
      { initialProps: { active: true } },
    );

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current).toBe(true);

    rerender({ active: false });
    expect(result.current).toBe(false);
  });

  it("is off with a null key", () => {
    const { result } = renderHook(() => useReadyPulseWindow(true, null));

    expect(result.current).toBe(false);
  });

  it("re-entering active restarts for the same key", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useReadyPulseWindow(active, "u1"),
      { initialProps: { active: true } },
    );

    act(() => {
      vi.advanceTimersByTime(READY_PULSE_MS);
    });
    expect(result.current).toBe(false);

    rerender({ active: false });
    rerender({ active: true });
    expect(result.current).toBe(true);
  });

  it("unmount clears the timer", () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = renderHook(() => useReadyPulseWindow(true, "u1"));

    unmount();
    expect(clear).toHaveBeenCalled();

    // A fired timer after unmount would warn about updating an unmounted hook.
    act(() => {
      vi.advanceTimersByTime(READY_PULSE_MS * 2);
    });
    expect(vi.getTimerCount()).toBe(0);
    clear.mockRestore();
  });
});
