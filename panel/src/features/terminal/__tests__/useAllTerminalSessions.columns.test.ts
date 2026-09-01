import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAllTerminalSessions } from "../useAllTerminalSessions";
import type { SessionMeta } from "../useTerminalSessions";

vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));

function session(id: string, project: string): SessionMeta {
  return {
    id,
    name: id,
    color: null,
    project,
    cwd: "/tmp",
    pid: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function mockFetchSessions(sessions: SessionMeta[]) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => sessions,
  });
}

// Mounts the hook and flushes the mount-time fetchAll() effect so the returned
// state reflects the post-fetch reconciliation.
async function setup() {
  let hook!: ReturnType<
    typeof renderHook<ReturnType<typeof useAllTerminalSessions>, unknown>
  >;
  await act(async () => {
    hook = renderHook(() => useAllTerminalSessions());
  });
  return hook;
}

const ids = (layout: { sessionId: string }[][]) =>
  layout.map((column) => column.map((entry) => entry.sessionId));

describe("useAllTerminalSessions columnLayout", () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initialises columnLayout from panel-terminal-layout-__all__", async () => {
    localStorage.setItem("panel-terminal-order-__all__", JSON.stringify(["a", "b"]));
    localStorage.setItem(
      "panel-terminal-layout-__all__",
      JSON.stringify([[{ sessionId: "a", weight: 2 }], [{ sessionId: "b", weight: 1 }]]),
    );
    mockFetchSessions([session("a", "vector"), session("b", "metro")]);
    const { result } = await setup();
    expect(ids(result.current.columnLayout)).toEqual([["a"], ["b"]]);
  });

  it("mergeColumn commits and persists a concrete layout from the default preset", async () => {
    mockFetchSessions([
      session("a", "vector"),
      session("b", "metro"),
      session("c", "vector"),
    ]);
    const { result } = await setup();
    expect(result.current.columnLayout).toEqual([]);
    // Default preset for 3 is [1, 2] — [[a], [b, c]] — so "b onto c" is a
    // same-column merge, the case the global tab used to drop on the floor.
    act(() => result.current.mergeColumn("b", "c"));
    expect(ids(result.current.columnLayout)).toEqual([["a"], ["b"], ["c"]]);
    expect(localStorage.getItem("panel-terminal-layout-__all__")).not.toBeNull();
  });

  it("applyPreset covers every cross-project session", async () => {
    mockFetchSessions([
      session("a", "vector"),
      session("b", "metro"),
      session("c", "ch"),
    ]);
    const { result } = await setup();
    act(() => result.current.applyPreset([1, 2]));
    expect(ids(result.current.columnLayout)).toEqual([["a"], ["b", "c"]]);
  });

  it("keeps a custom layout across a poll refresh", async () => {
    mockFetchSessions([session("a", "vector"), session("b", "metro")]);
    const { result } = await setup();
    act(() => result.current.applyPreset([1, 1]));
    await act(async () => {
      await result.current.refresh();
    });
    expect(ids(result.current.columnLayout)).toEqual([["a"], ["b"]]);
  });

  it("drops a closed session from the layout on refresh", async () => {
    mockFetchSessions([session("a", "vector"), session("b", "metro")]);
    const { result } = await setup();
    act(() => result.current.applyPreset([1, 1]));
    mockFetchSessions([session("a", "vector")]);
    await act(async () => {
      await result.current.refresh();
    });
    expect(ids(result.current.columnLayout)).toEqual([["a"]]);
  });
});
