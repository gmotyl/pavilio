import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useMobileAccessStatus } from "../useMobileAccessStatus";

const offEnvelope = {
  tailscale: { state: "off", selfHost: "x" },
  lan: { state: "off", lanIp: null },
  host: { wsl: false, wslVmIp: null },
};

beforeEach(() => {
  global.fetch = vi.fn(async () =>
    ({ ok: true, json: async () => offEnvelope }) as Response,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useMobileAccessStatus", () => {
  it("fetches status on mount and polls periodically when enabled", async () => {
    const { result } = renderHook(() => useMobileAccessStatus(true));
    await waitFor(() =>
      expect(result.current.status?.tailscale.state).toBe("off"),
    );
    const initialCalls = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(initialCalls).toBeGreaterThanOrEqual(1);
    await waitFor(
      () =>
        expect(
          (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
        ).toBeGreaterThan(initialCalls),
      { timeout: 3500 },
    );
  }, 5000);

  it("does not poll when disabled prop is false", async () => {
    const { result } = renderHook(() => useMobileAccessStatus(false));
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.status).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("exposes enableLan / disableLan that POST to the LAN endpoints", async () => {
    const { result } = renderHook(() => useMobileAccessStatus(true));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.enableLan();
    });
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit?][] } })
      .mock.calls;
    expect(calls.some(([url, init]) =>
      url === "/api/mobile-access/lan/enable" && init?.method === "POST"
    )).toBe(true);

    await act(async () => {
      await result.current.disableLan();
    });
    const calls2 = (fetch as unknown as { mock: { calls: [string, RequestInit?][] } })
      .mock.calls;
    expect(calls2.some(([url, init]) =>
      url === "/api/mobile-access/lan/disable" && init?.method === "POST"
    )).toBe(true);
  });
});
