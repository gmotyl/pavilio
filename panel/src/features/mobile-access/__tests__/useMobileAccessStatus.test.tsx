import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useMobileAccessStatus } from "../useMobileAccessStatus";

beforeEach(() => {
  global.fetch = vi.fn(async () =>
    ({ ok: true, json: async () => ({ state: "off", selfHost: "x" }) }) as Response
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useMobileAccessStatus", () => {
  it("fetches status on mount and polls periodically when enabled", async () => {
    const { result } = renderHook(() => useMobileAccessStatus(true));
    await waitFor(() => expect(result.current.status?.state).toBe("off"));
    const initialCalls = (fetch as any).mock.calls.length;
    expect(initialCalls).toBeGreaterThanOrEqual(1);
    // Real timers, poll interval is 2000ms. Wait up to 3500ms for a second call.
    await waitFor(
      () => expect((fetch as any).mock.calls.length).toBeGreaterThan(initialCalls),
      { timeout: 3500 }
    );
  }, 5000);

  it("does not poll when disabled prop is false", async () => {
    const { result } = renderHook(() => useMobileAccessStatus(false));
    // Brief delay to ensure no fetches are scheduled
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.status).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
