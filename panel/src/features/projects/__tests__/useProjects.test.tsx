import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { jsonResponse, stubFetch } from "../../../test-utils";

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

  it("applies only the latest refetch, whatever order the responses arrive in", async () => {
    const pending: ((r: Response) => void)[] = [];
    stubFetch({ "/api/projects": () => new Promise<Response>((r) => pending.push(r)) }, []);
    const { result, rerender } = renderHook(() => useProjects());
    await waitFor(() => expect(pending).toHaveLength(1));
    ws.lastMessage = { type: "projects-change" };
    rerender();
    await waitFor(() => expect(pending).toHaveLength(2));
    const project = (present: boolean) => [{ name: "a", repos: [{ name: "r", path: "/r", present }] }];
    await act(async () => pending[1](jsonResponse(project(true))));
    await act(async () => pending[0](jsonResponse(project(false))));
    expect(result.current[0]?.repos[0]?.present).toBe(true);
  });
});
