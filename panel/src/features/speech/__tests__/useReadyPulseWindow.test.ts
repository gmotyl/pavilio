import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useReadyPulseWindow, READY_PULSE_MS } from "../useReadyPulseWindow";

type Props = { active: boolean; key: string | null };

const mount = (initialProps: Props) =>
  renderHook(({ active, key }: Props) => useReadyPulseWindow(active, key), { initialProps });

const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe("useReadyPulseWindow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pulses at once when active with a key, and stops after READY_PULSE_MS", () => {
    const { result } = mount({ active: true, key: "u1" });
    expect(result.current).toBe(true);

    advance(READY_PULSE_MS - 1);
    expect(result.current).toBe(true);

    advance(1);
    expect(result.current).toBe(false);
  });

  it.each([
    { trigger: "a new key", via: null, to: { active: true, key: "u2" } },
    {
      trigger: "re-entering active for the same key",
      via: { active: false, key: "u1" },
      to: { active: true, key: "u1" },
    },
  ])("$trigger restarts a full window", ({ via, to }) => {
    const { result, rerender, unmount } = mount({ active: true, key: "u1" });
    advance(READY_PULSE_MS);
    expect(result.current).toBe(false);

    if (via) rerender(via);
    rerender(to);
    expect(result.current).toBe(true);

    // The fresh window is a full one, not the remainder of the first.
    advance(READY_PULSE_MS - 1);
    expect(result.current).toBe(true);

    // A timer that fired after unmount would warn about updating an unmounted
    // hook, so the running window's timer goes with it.
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { off: "inactive", to: { active: false, key: "u1" } },
    { off: "a null key", to: { active: true, key: null } },
  ])("is off at once when $off, mid-window", ({ to }) => {
    const { result, rerender } = mount({ active: true, key: "u1" });
    advance(3_000);
    expect(result.current).toBe(true);

    rerender(to);
    expect(result.current).toBe(false);
  });
});
