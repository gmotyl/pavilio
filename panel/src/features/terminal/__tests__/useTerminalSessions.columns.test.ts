import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalSessions, type SessionMeta } from "../useTerminalSessions";

function session(id: string, project = "vector"): SessionMeta {
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

// Mounts the hook and flushes the mount-time fetchSessions() effect so the
// returned state reflects the post-fetch reconciliation.
async function setup(project: string) {
  let hook!: ReturnType<typeof renderHook<ReturnType<typeof useTerminalSessions>, unknown>>;
  await act(async () => {
    hook = renderHook(() => useTerminalSessions(project));
  });
  return hook;
}

describe("useTerminalSessions columns", () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("columnSizes initializes from localStorage for the given project", async () => {
    localStorage.setItem("panel-terminal-columns-vector", JSON.stringify([1, 2]));
    mockFetchSessions([]);
    const { result } = await setup("vector");
    expect(result.current.columnSizes).toEqual([1, 2]);
  });

  it("columnSizes defaults to [] when localStorage has no entry", async () => {
    mockFetchSessions([]);
    const { result } = await setup("vector");
    expect(result.current.columnSizes).toEqual([]);
  });

  it("fetchSessions reconciles columnSizes via mergeColumnSizes using the pre-merge sessionOrder", async () => {
    // Stored order has 3 sessions across 2 columns; the server now only
    // reports 2 of them (A closed). If the implementation mistakenly used
    // the POST-merge order (["B","C"], length 2) as mergeColumnSizes'
    // `prevOrder`, its sum check (1+2=3 !== 2) would bail out and leave
    // columnSizes at the stale [1, 2] instead of reconciling to [2].
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B", "C"]));
    localStorage.setItem("panel-terminal-columns-vector", JSON.stringify([1, 2]));
    mockFetchSessions([session("B"), session("C")]);
    const { result } = await setup("vector");
    expect(result.current.sessions.map((s) => s.id)).toEqual(["B", "C"]);
    expect(result.current.columnSizes).toEqual([2]);
  });

  it("columnSizes changes persist to panel-terminal-columns-<project>", async () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B"]));
    mockFetchSessions([session("A"), session("B")]);
    const { result } = await setup("vector");
    expect(localStorage.getItem("panel-terminal-columns-vector")).toBeNull();

    act(() => {
      result.current.splitColumn("A", 1);
    });

    expect(result.current.columnSizes.length).toBeGreaterThan(0);
    expect(localStorage.getItem("panel-terminal-columns-vector")).toBe(
      JSON.stringify(result.current.columnSizes),
    );
  });

  it("columnSizes becoming [] removes the localStorage key", async () => {
    localStorage.setItem("panel-terminal-columns-vector", JSON.stringify([1, 1]));
    mockFetchSessions([]);
    const { result } = await setup("vector");
    expect(localStorage.getItem("panel-terminal-columns-vector")).toBe(JSON.stringify([1, 1]));

    act(() => {
      result.current.resetColumns();
    });

    expect(result.current.columnSizes).toEqual([]);
    expect(localStorage.getItem("panel-terminal-columns-vector")).toBeNull();
  });

  it("joinColumn updates both sessionOrder and columnSizes together", async () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B", "C", "D"]));
    localStorage.setItem("panel-terminal-columns-vector", JSON.stringify([2, 2]));
    mockFetchSessions([session("A"), session("B"), session("C"), session("D")]);
    const { result } = await setup("vector");
    expect(result.current.columnSizes).toEqual([2, 2]);

    act(() => {
      result.current.joinColumn("B", "D");
    });

    expect(result.current.sessions.map((s) => s.id)).toEqual(["A", "C", "D", "B"]);
    expect(result.current.columnSizes).toEqual([1, 3]);
  });

  it("splitColumn updates both sessionOrder and columnSizes together", async () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B", "C", "D"]));
    localStorage.setItem("panel-terminal-columns-vector", JSON.stringify([2, 2]));
    mockFetchSessions([session("A"), session("B"), session("C"), session("D")]);
    const { result } = await setup("vector");

    act(() => {
      result.current.splitColumn("B", 1);
    });

    expect(result.current.sessions.map((s) => s.id)).toEqual(["A", "B", "C", "D"]);
    expect(result.current.columnSizes).toEqual([1, 1, 2]);
  });

  it("resetColumns clears columnSizes to [] and removes the localStorage key", async () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B", "C"]));
    localStorage.setItem("panel-terminal-columns-vector", JSON.stringify([2, 3]));
    mockFetchSessions([session("A"), session("B"), session("C")]);
    const { result } = await setup("vector");
    expect(result.current.columnSizes).toEqual([2, 3]);

    act(() => {
      result.current.resetColumns();
    });

    expect(result.current.columnSizes).toEqual([]);
    expect(localStorage.getItem("panel-terminal-columns-vector")).toBeNull();
  });

  it("hasCustomColumns is false when columnSizes is [] and true otherwise", async () => {
    mockFetchSessions([]);
    const { result: emptyResult } = await setup("vector-empty");
    expect(emptyResult.current.hasCustomColumns).toBe(false);

    localStorage.setItem("panel-terminal-columns-vector-custom", JSON.stringify([1, 1]));
    const { result: customResult } = await setup("vector-custom");
    expect(customResult.current.hasCustomColumns).toBe(true);
  });
});
