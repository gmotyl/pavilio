import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVisualViewport } from "../useVisualViewport";

describe("useVisualViewport", () => {
  let listeners: Record<string, EventListener[]> = {};
  let mockViewport: { height: number; offsetTop: number; addEventListener: any; removeEventListener: any };

  beforeEach(() => {
    vi.useFakeTimers();
    listeners = {};
    mockViewport = {
      height: 800,
      offsetTop: 0,
      addEventListener: vi.fn((type: string, cb: EventListener) => {
        (listeners[type] ||= []).push(cb);
      }),
      removeEventListener: vi.fn((type: string, cb: EventListener) => {
        listeners[type] = (listeners[type] || []).filter(x => x !== cb);
      }),
    };
    Object.defineProperty(window, "visualViewport", { value: mockViewport, configurable: true, writable: true });
    document.documentElement.style.removeProperty("--vv-height");
    document.documentElement.style.removeProperty("--vv-offset-top");
  });

  afterEach(() => {
    vi.useRealTimers();
    // Reset visualViewport to undefined so the next test sets it again fresh
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true, writable: true });
  });

  it("sets --vv-height and --vv-offset-top on mount", () => {
    renderHook(() => useVisualViewport());
    expect(document.documentElement.style.getPropertyValue("--vv-height")).toBe("800px");
    expect(document.documentElement.style.getPropertyValue("--vv-offset-top")).toBe("0px");
  });

  it("updates CSS vars on resize (debounced)", () => {
    renderHook(() => useVisualViewport());
    mockViewport.height = 500;
    mockViewport.offsetTop = 100;
    act(() => {
      listeners["resize"]?.forEach(cb => cb(new Event("resize")));
    });
    // Before debounce elapses, still old values
    expect(document.documentElement.style.getPropertyValue("--vv-height")).toBe("800px");
    act(() => { vi.advanceTimersByTime(100); });
    expect(document.documentElement.style.getPropertyValue("--vv-height")).toBe("500px");
    expect(document.documentElement.style.getPropertyValue("--vv-offset-top")).toBe("100px");
  });

  it("also updates on scroll events", () => {
    renderHook(() => useVisualViewport());
    mockViewport.height = 600;
    act(() => {
      listeners["scroll"]?.forEach(cb => cb(new Event("scroll")));
      vi.advanceTimersByTime(100);
    });
    expect(document.documentElement.style.getPropertyValue("--vv-height")).toBe("600px");
  });

  it("cleans up listeners on unmount", () => {
    const { unmount } = renderHook(() => useVisualViewport());
    unmount();
    expect(mockViewport.removeEventListener).toHaveBeenCalledTimes(2);
  });

  it("no-ops when visualViewport is unavailable", () => {
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true, writable: true });
    expect(() => renderHook(() => useVisualViewport())).not.toThrow();
    expect(document.documentElement.style.getPropertyValue("--vv-height")).toBe("");
  });
});
