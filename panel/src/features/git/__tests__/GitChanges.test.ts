import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { statusLabel, statusColor } from "../GitChanges";
import { useGitChanges } from "../useGitChanges";
import { mockFetchResponses } from "../../../test-utils";

vi.mock("../../realtime/useWebSocket", () => ({ useWebSocket: () => ({ lastMessage: null }) }));

describe("statusLabel", () => {
  it.each([
    ["??", "U"], // untracked
    ["M", "M"],
    ["D", "D"],
    ["A", "A"],
    ["R", "R"], // unknown status passes through
  ])("maps %s to %s", (status, label) => {
    expect(statusLabel(status)).toBe(label);
  });
});

describe("statusColor", () => {
  it.each([
    ["??", "var(--green)"], // untracked
    ["M", "var(--yellow)"], // modified
    ["D", "var(--red)"], // deleted
    ["X", "var(--text-tertiary)"], // unknown
  ])("colours %s as %s", (status, color) => {
    expect(statusColor(status)).toBe(color);
  });
});

describe("useGitChanges checkout", () => {
  it("checkout passes track through to the request", async () => {
    const mock = mockFetchResponses({
      "/api/git/status": [],
      "/api/git/branch": { branch: "main" },
      "/api/git/suggest-message": { suggestion: "" },
      "/api/git/branches": { current: "main", branches: ["main"] },
      "/api/git/checkout": { branch: "x" },
    });
    const { result } = renderHook(() => useGitChanges("/r/repo"));
    await waitFor(() => expect(result.current.branch).toBe("main"));
    const checkoutBodies = () =>
      (mock.mock.calls as unknown as [string, RequestInit][])
        .filter(([url]) => url === "/api/git/checkout")
        .map(([, init]) => JSON.parse(String(init.body)));

    await act(() => result.current.checkout("origin/x", { track: true }));
    expect(checkoutBodies()).toEqual([{ branch: "origin/x", repo: "/r/repo", track: true }]);

    await act(() => result.current.checkout("dev"));
    expect(checkoutBodies()[1]).toEqual({ branch: "dev", repo: "/r/repo" });
    expect(Object.keys(checkoutBodies()[1])).not.toContain("track");
  });
});
