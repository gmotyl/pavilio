import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTerminalOrdering } from "../useTerminalOrdering";
import type { SessionMeta } from "../useTerminalSessions";

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

const ids = (layout: { sessionId: string }[][]) =>
  layout.map((column) => column.map((entry) => entry.sessionId));

describe("useTerminalOrdering", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("initialises order and layout from the scope's stored keys", () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["b", "a"]));
    localStorage.setItem(
      "panel-terminal-layout-vector",
      JSON.stringify([[{ sessionId: "b", weight: 1 }], [{ sessionId: "a", weight: 2 }]]),
    );
    const { result } = renderHook(() =>
      useTerminalOrdering("vector", [session("a"), session("b")]),
    );
    expect(result.current.sessionOrder).toEqual(["b", "a"]);
    expect(ids(result.current.columnLayout)).toEqual([["b"], ["a"]]);
    expect(result.current.orderedSessions.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("discards a malformed stored layout", () => {
    localStorage.setItem("panel-terminal-layout-vector", JSON.stringify({ nope: true }));
    const { result } = renderHook(() => useTerminalOrdering("vector", []));
    expect(result.current.columnLayout).toEqual([]);
  });

  it("removes the legacy count-only columns key on mount", () => {
    localStorage.setItem("panel-terminal-columns-vector", JSON.stringify([1, 2]));
    renderHook(() => useTerminalOrdering("vector", []));
    expect(localStorage.getItem("panel-terminal-columns-vector")).toBeNull();
  });

  it("persists a non-empty layout and removes the key when it empties", () => {
    const sessions = [session("a"), session("b")];
    const { result } = renderHook(() => useTerminalOrdering("vector", sessions));
    act(() => result.current.applyPreset([1, 1]));
    expect(localStorage.getItem("panel-terminal-layout-vector")).not.toBeNull();
    act(() => result.current.syncIds([]));
    expect(localStorage.getItem("panel-terminal-layout-vector")).toBeNull();
  });

  // The default preset for 3 sessions is [1, 2] — i.e. [[a], [b, c]] — so "b onto c" is a
  // same-column merge and "a onto c" is a cross-column join, exactly as the grid classifies
  // them. All three ops must resolve the empty-layout sentinel the same way the grid does.
  it("mergeColumn from an empty layout commits a concrete layout", () => {
    const sessions = [session("a"), session("b"), session("c")];
    const { result } = renderHook(() => useTerminalOrdering("vector", sessions));
    expect(result.current.columnLayout).toEqual([]);
    act(() => result.current.mergeColumn("b", "c"));
    expect(ids(result.current.columnLayout)).toEqual([["a"], ["b"], ["c"]]);
    expect(result.current.columnLayout[1][0].weight).toBe(2);
  });

  it("joinColumn from an empty layout commits a concrete layout", () => {
    const sessions = [session("a"), session("b"), session("c")];
    const { result } = renderHook(() => useTerminalOrdering("vector", sessions));
    act(() => result.current.joinColumn("a", "c"));
    expect(ids(result.current.columnLayout)).toEqual([["b", "c", "a"]]);
  });

  it("splitColumn from an empty layout commits a concrete layout", () => {
    const sessions = [session("a"), session("b"), session("c")];
    const { result } = renderHook(() => useTerminalOrdering("vector", sessions));
    act(() => result.current.splitColumn("c", 0));
    expect(ids(result.current.columnLayout)).toEqual([["c"], ["a"], ["b"]]);
  });

  it("applyPreset covers every session before the order has merged", () => {
    const sessions = [session("a"), session("b"), session("c")];
    const { result } = renderHook(() => useTerminalOrdering("vector", sessions));
    expect(result.current.sessionOrder).toEqual([]);
    act(() => result.current.applyPreset([1, 2]));
    expect(ids(result.current.columnLayout)).toEqual([["a"], ["b", "c"]]);
  });

  it("swapSessions leaves an empty layout empty and only reorders", () => {
    const sessions = [session("a"), session("b")];
    const { result } = renderHook(() => useTerminalOrdering("vector", sessions));
    act(() => result.current.syncIds(["a", "b"]));
    act(() => result.current.swapSessions("a", "b"));
    expect(result.current.columnLayout).toEqual([]);
    expect(result.current.sessionOrder).toEqual(["b", "a"]);
  });

  it("syncIds reconciles the layout against the pre-merge order", () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["a", "b"]));
    localStorage.setItem(
      "panel-terminal-layout-vector",
      JSON.stringify([[{ sessionId: "a", weight: 1 }], [{ sessionId: "b", weight: 1 }]]),
    );
    const { result } = renderHook(() =>
      useTerminalOrdering("vector", [session("a"), session("b")]),
    );
    // "b" closed, "c" appeared: b's column drops, c joins the last column.
    act(() => result.current.syncIds(["a", "c"]));
    expect(result.current.sessionOrder).toEqual(["a", "c"]);
    expect(ids(result.current.columnLayout)).toEqual([["a", "c"]]);
  });

  it("appendId adds an unknown id and is a no-op for a known one", () => {
    const { result } = renderHook(() => useTerminalOrdering("vector", []));
    act(() => result.current.syncIds(["a"]));
    act(() => result.current.appendId("b"));
    expect(result.current.sessionOrder).toEqual(["a", "b"]);
    act(() => result.current.appendId("b"));
    expect(result.current.sessionOrder).toEqual(["a", "b"]);
  });

  it("re-initialises when the scope key changes", () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["a"]));
    localStorage.setItem("panel-terminal-order-metro", JSON.stringify(["z"]));
    localStorage.setItem(
      "panel-terminal-layout-metro",
      JSON.stringify([[{ sessionId: "z", weight: 1 }]]),
    );
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) => useTerminalOrdering(scope, []),
      { initialProps: { scope: "vector" } },
    );
    expect(result.current.sessionOrder).toEqual(["a"]);
    rerender({ scope: "metro" });
    expect(result.current.sessionOrder).toEqual(["z"]);
    expect(ids(result.current.columnLayout)).toEqual([["z"]]);
  });
});
