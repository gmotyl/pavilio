import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSidebarState } from "../useSidebarState";
import { preferences } from "../../../preferences/declarations";
import { subscribePreference } from "../../../preferences/store";

describe("useSidebarState", () => {
  it("defaults to expanded (true)", () => {
    const { result } = renderHook(() => useSidebarState("leftSidebar"));
    expect(result.current.expanded).toBe(true);
  });

  it("toggles collapsed/expanded", () => {
    const { result } = renderHook(() => useSidebarState("leftSidebar"));
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
  });

  /**
   * Two toggles in ONE tick. The migration replaced the functional state
   * updater with a closure read, so the second call saw the value the first
   * one had already replaced and the pair collapsed into a single flip.
   */
  it("composes two toggles in one tick", () => {
    const { result } = renderHook(() => useSidebarState("leftSidebar"));
    act(() => {
      result.current.toggle();
      result.current.toggle();
    });
    expect(result.current.expanded).toBe(true);
  });

  /**
   * The idempotence guard has to compare against the LATEST value. Comparing a
   * captured `expanded` makes the second call in a tick look like a change, so
   * it writes again — and a write is now a PATCH, not a `setItem`. Counted on
   * notifications rather than on PATCHes, because the debounce would collapse
   * two PATCHes into one and hide it.
   */
  it("setExpanded guards on the LATEST value, not a captured one", () => {
    const { result } = renderHook(() => useSidebarState("leftSidebar"));
    let heard = 0;
    const off = subscribePreference(
      preferences.leftSidebarExpanded,
      undefined,
      () => {
        heard += 1;
      },
    );
    act(() => {
      result.current.setExpanded(false);
      result.current.setExpanded(false);
    });
    off();
    expect(result.current.expanded).toBe(false);
    expect(heard).toBe(1);
  });

  it("persists state per key", () => {
    const { result, unmount } = renderHook(() => useSidebarState("rightSidebar"));
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(false);
    unmount();

    const { result: r2 } = renderHook(() => useSidebarState("rightSidebar"));
    expect(r2.current.expanded).toBe(false);

    const { result: r3 } = renderHook(() => useSidebarState("leftSidebar"));
    expect(r3.current.expanded).toBe(true);
  });
});
