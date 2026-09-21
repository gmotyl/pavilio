import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWideMode } from "../useWideMode";

describe("useWideMode", () => {
  // The one deliberate behavior change of the preferences migration: a view
  // with nothing stored used to open compact.
  it("defaults to wide", () => {
    const { result } = renderHook(() => useWideMode("viewer"));
    expect(result.current[0]).toBe(true);
  });

  it("toggles wide mode", () => {
    const { result } = renderHook(() => useWideMode("viewer"));
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
  });

  it("persists per key", () => {
    const { result, unmount } = renderHook(() => useWideMode("repos"));
    act(() => result.current[1]());
    unmount();

    const { result: r2 } = renderHook(() => useWideMode("repos"));
    expect(r2.current[0]).toBe(false);

    const { result: r3 } = renderHook(() => useWideMode("notes"));
    expect(r3.current[0]).toBe(true);
  });
});
