import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGitViewMode } from "../useGitViewMode";
import { preferences } from "../../../preferences/declarations";
import { storageKey } from "../../../preferences/types";

describe("useGitViewMode", () => {
  it("defaults to flat", () => {
    const { result } = renderHook(() => useGitViewMode());
    expect(result.current[0]).toBe("flat");
  });

  it("switches to tree mode", () => {
    const { result } = renderHook(() => useGitViewMode());
    act(() => result.current[1]("tree"));
    expect(result.current[0]).toBe("tree");
  });

  it("persists across remounts", () => {
    const { result, unmount } = renderHook(() => useGitViewMode());
    act(() => result.current[1]("tree"));
    unmount();

    const { result: r2 } = renderHook(() => useGitViewMode());
    expect(r2.current[0]).toBe("tree");
  });

  it("falls back to flat for invalid stored value", () => {
    // The stored value now lives in the injected preferences document, not in
    // `localStorage`, but the fallback it triggers is the same one.
    (
      globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }
    ).__PAVILIO_PREFS__![storageKey(preferences.gitViewMode)] = "garbage";
    const { result } = renderHook(() => useGitViewMode());
    expect(result.current[0]).toBe("flat");
  });
});
