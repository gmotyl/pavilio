import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { stubFetch } from "../../../test-utils";

const ws = vi.hoisted(() => ({ lastMessage: null as { type: string } | null }));
vi.mock("../../realtime/useWebSocket", () => ({ useWebSocket: () => ws }));

import { useProjects } from "../useProjects";

const projectCalls = (fetch: ReturnType<typeof stubFetch>) => fetch.mock.calls.filter(([u]) => String(u) === "/api/projects").length;

describe("useProjects", () => {
  beforeEach(() => {
    ws.lastMessage = null;
  });

  it.each(["file-change", "projects-change"])("refetches on a %s broadcast", async (type) => {
    const fetch = stubFetch({ "/api/projects": [] }, []);
    const { rerender } = renderHook(() => useProjects());
    await waitFor(() => expect(projectCalls(fetch)).toBe(1));
    ws.lastMessage = { type };
    rerender();
    await waitFor(() => expect(projectCalls(fetch)).toBe(2));
  });

  it("ignores unrelated broadcasts", async () => {
    const fetch = stubFetch({ "/api/projects": [] }, []);
    const { rerender } = renderHook(() => useProjects());
    await waitFor(() => expect(projectCalls(fetch)).toBe(1));
    ws.lastMessage = { type: "git-change" };
    rerender();
    await Promise.resolve();
    expect(projectCalls(fetch)).toBe(1);
  });
});
