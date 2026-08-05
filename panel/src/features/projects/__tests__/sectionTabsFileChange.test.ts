import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// The plans and context tabs used to fetch on mount only, so a file an agent
// wrote while you sat on the tab stayed invisible until a reload. Both now
// refresh on the same `file-change` frame the file index listens for.
let lastMessage: { type: string } | null = null;
vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage }),
}));

const { usePlansTree } = await import("../usePlansTree");
const { useProjectContext } = await import("../useProjectContext");

beforeEach(() => {
  lastMessage = null;
  global.fetch = vi.fn(
    async () => ({ ok: true, json: async () => ({ project: "p", sources: [] }) }) as Response,
  );
});
afterEach(() => vi.restoreAllMocks());

const calls = () => (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

describe.each([
  ["usePlansTree", (name: string) => usePlansTree(name)],
  ["useProjectContext", (name: string) => useProjectContext(name)],
])("%s", (_label, hook) => {
  it("refetches when a file-change arrives", async () => {
    const { rerender } = renderHook(() => hook("pavilio"));
    await waitFor(() => expect(calls()).toBe(1));

    lastMessage = { type: "file-change" };
    await act(async () => {
      rerender();
    });

    await waitFor(() => expect(calls()).toBe(2));
  });

  it("ignores unrelated frames", async () => {
    const { rerender } = renderHook(() => hook("pavilio"));
    await waitFor(() => expect(calls()).toBe(1));

    lastMessage = { type: "agent-change" };
    await act(async () => {
      rerender();
    });

    expect(calls()).toBe(1);
  });
});
