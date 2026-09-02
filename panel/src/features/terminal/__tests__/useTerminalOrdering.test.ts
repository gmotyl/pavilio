import { StrictMode } from "react";
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

  // Layouts persisted before the uniqueness invariant landed can already name a session
  // twice (a StrictMode-replayed reconcile appended it again), which renders one session in
  // two grid cells. Reading repairs those in place.
  it("repairs a stored layout that names a session twice", () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["a", "b"]));
    localStorage.setItem(
      "panel-terminal-layout-vector",
      JSON.stringify([
        [{ sessionId: "a", weight: 2 }],
        [{ sessionId: "b", weight: 1 }, { sessionId: "a", weight: 1 }],
      ]),
    );
    const { result } = renderHook(() =>
      useTerminalOrdering("vector", [session("a"), session("b")]),
    );
    expect(ids(result.current.columnLayout)).toEqual([["a"], ["b"]]);
    // The first entry wins, keeping its weight.
    expect(result.current.columnLayout[0][0].weight).toBe(2);
  });

  it("writes the repaired layout back to storage", () => {
    localStorage.setItem(
      "panel-terminal-layout-vector",
      JSON.stringify([
        [{ sessionId: "a", weight: 1 }],
        [{ sessionId: "a", weight: 1 }, { sessionId: "b", weight: 1 }],
      ]),
    );
    renderHook(() => useTerminalOrdering("vector", [session("a"), session("b")]));
    expect(JSON.parse(localStorage.getItem("panel-terminal-layout-vector")!)).toEqual([
      [{ sessionId: "a", weight: 1 }],
      [{ sessionId: "b", weight: 1 }],
    ]);
  });

  it("leaves a clean stored layout untouched", () => {
    const clean = [
      [{ sessionId: "a", weight: 1 }],
      [{ sessionId: "b", weight: 3 }],
    ];
    localStorage.setItem("panel-terminal-layout-vector", JSON.stringify(clean));
    const { result } = renderHook(() =>
      useTerminalOrdering("vector", [session("a"), session("b")]),
    );
    expect(result.current.columnLayout).toEqual(clean);
    expect(JSON.parse(localStorage.getItem("panel-terminal-layout-vector")!)).toEqual(clean);
  });

  // An array of non-arrays passes the top-level `Array.isArray` guard, so the shape check
  // lands inside `dedupeLayout`'s `column.filter` — which throws, and `readLayout`'s catch
  // turns that into a warn plus the empty sentinel. Before the de-dupe on read it leaked
  // through as a bogus `ColumnLayout`.
  it("discards an array of non-columns", () => {
    localStorage.setItem("panel-terminal-layout-vector", JSON.stringify([1, 2]));
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

  // `reconcileLayout` rebuilds its columns with `.map().filter()`, and `dedupeLayout`
  // hands back the argument it was given when nothing was dropped — so even a *no-op*
  // reconcile yields a fresh array. Piped straight into `setColumnLayout`, that
  // re-rendered and re-fired the layout-persist effect on every 8s poll tick and every
  // WebSocket refetch. The reducer's `commit` compares structurally and collapses to the
  // state it already held, so the reference survives. Hence `toBe`, not `toEqual`.
  it("keeps the layout reference across a no-op sync", () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["a", "b"]));
    localStorage.setItem(
      "panel-terminal-layout-vector",
      JSON.stringify([[{ sessionId: "a", weight: 1 }], [{ sessionId: "b", weight: 2 }]]),
    );
    const { result } = renderHook(
      () => useTerminalOrdering("vector", [session("a"), session("b")]),
      { wrapper: StrictMode },
    );

    const before = result.current.columnLayout;
    // The id set already stored — nothing about the model actually moves.
    act(() => result.current.syncIds(["a", "b"]));

    expect(result.current.columnLayout).toBe(before);
  });

  // The old `swapSessions` read `sessionOrder`/`columnLayout` out of the render closure
  // (deps `[sessionOrder, columnLayout]`), so two swaps issued in one commit both computed
  // from the same pre-batch snapshot and the second discarded the first — a lost update,
  // landing `['a','b','d','c']`. Sequential dispatches each see the previous transition's
  // result, so both swaps compose.
  it("applies two swaps issued in the same commit", () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["a", "b", "c", "d"]));
    localStorage.setItem(
      "panel-terminal-layout-vector",
      JSON.stringify([
        [{ sessionId: "a", weight: 1 }, { sessionId: "b", weight: 1 }],
        [{ sessionId: "c", weight: 2 }, { sessionId: "d", weight: 1 }],
      ]),
    );
    const { result } = renderHook(
      () =>
        useTerminalOrdering("vector", [
          session("a"),
          session("b"),
          session("c"),
          session("d"),
        ]),
      { wrapper: StrictMode },
    );

    act(() => {
      result.current.swapSessions("a", "b");
      result.current.swapSessions("c", "d");
    });

    expect(result.current.sessionOrder).toEqual(["b", "a", "d", "c"]);
    // `swapInLayout` runs on the custom layout too, so both halves must have moved.
    expect(ids(result.current.columnLayout)).toEqual([
      ["b", "a"],
      ["d", "c"],
    ]);
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

  it("applyPreset([]) resets to the sentinel and drops the stored key", () => {
    const sessions = [session("a"), session("b")];
    const { result } = renderHook(() => useTerminalOrdering("vector", sessions));
    act(() => result.current.applyPreset([1, 1]));
    expect(localStorage.getItem("panel-terminal-layout-vector")).not.toBeNull();
    act(() => result.current.applyPreset([]));
    expect(result.current.columnLayout).toEqual([]);
    expect(localStorage.getItem("panel-terminal-layout-vector")).toBeNull();
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

  // StrictMode double-invokes state updaters and reducers. A `setColumnLayout` call nested
  // inside a `setSessionOrder` updater is therefore replayed, which is how one session came
  // to render in two grid cells. The state transition must be a pure function of
  // {order, layout} + action so that a replayed invocation is indistinguishable from one.
  it("appends exactly one layout entry for a new session under StrictMode", () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["a", "b"]));
    localStorage.setItem(
      "panel-terminal-layout-vector",
      JSON.stringify([[{ sessionId: "a", weight: 1 }], [{ sessionId: "b", weight: 1 }]]),
    );
    const { result } = renderHook(
      () => useTerminalOrdering("vector", [session("a"), session("b"), session("c")]),
      { wrapper: StrictMode },
    );

    act(() => result.current.appendId("c"));

    expect(result.current.sessionOrder).toEqual(["a", "b", "c"]);
    const flat = result.current.columnLayout.flat().map((entry) => entry.sessionId);
    expect(flat.filter((id) => id === "c")).toHaveLength(1);
    expect(flat).toEqual(["a", "b", "c"]);
    expect(ids(result.current.columnLayout)).toEqual([["a"], ["b", "c"]]);
  });

  // The real sequence when a terminal is created: the create call appends the id
  // optimistically, then the refetch syncs the server's id set over the top. Both
  // reconcile the layout, so a non-idempotent transition appends the id twice.
  it("does not duplicate a session when sync follows append for the same id", () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["a", "b"]));
    localStorage.setItem(
      "panel-terminal-layout-vector",
      JSON.stringify([[{ sessionId: "a", weight: 1 }], [{ sessionId: "b", weight: 1 }]]),
    );
    const { result } = renderHook(
      () => useTerminalOrdering("vector", [session("a"), session("b"), session("c")]),
      { wrapper: StrictMode },
    );

    act(() => result.current.appendId("c"));
    act(() => result.current.syncIds(["a", "b", "c"]));

    expect(result.current.sessionOrder).toEqual(["a", "b", "c"]);
    const flat = result.current.columnLayout.flat().map((entry) => entry.sessionId);
    expect(flat).toEqual(["a", "b", "c"]);
    expect(
      JSON.parse(localStorage.getItem("panel-terminal-layout-vector")!),
    ).toEqual([
      [{ sessionId: "a", weight: 1 }],
      [{ sessionId: "b", weight: 1 }, { sessionId: "c", weight: 1 }],
    ]);
  });

  // The scope swap is adjusted during render, not in an effect: an effect would only queue
  // the swap while the persist effects run in that same commit, writing the previous scope's
  // order and layout under the NEW scope's keys.
  it("swapping scope loads the new scope's stored state without cross-writing keys", () => {
    const vectorLayout = [
      [{ sessionId: "a", weight: 1 }],
      [{ sessionId: "b", weight: 1 }],
    ];
    const metroLayout = [[{ sessionId: "z", weight: 3 }]];
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["a", "b"]));
    localStorage.setItem("panel-terminal-layout-vector", JSON.stringify(vectorLayout));
    localStorage.setItem("panel-terminal-order-metro", JSON.stringify(["z"]));
    localStorage.setItem("panel-terminal-layout-metro", JSON.stringify(metroLayout));

    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) => useTerminalOrdering(scope, []),
      { initialProps: { scope: "vector" }, wrapper: StrictMode },
    );
    expect(result.current.sessionOrder).toEqual(["a", "b"]);

    rerender({ scope: "metro" });

    expect(result.current.sessionOrder).toEqual(["z"]);
    expect(result.current.columnLayout).toEqual(metroLayout);
    // Neither scope's keys may hold the other scope's data.
    expect(JSON.parse(localStorage.getItem("panel-terminal-order-metro")!)).toEqual(["z"]);
    expect(JSON.parse(localStorage.getItem("panel-terminal-layout-metro")!)).toEqual(
      metroLayout,
    );
    expect(JSON.parse(localStorage.getItem("panel-terminal-order-vector")!)).toEqual([
      "a",
      "b",
    ]);
    expect(JSON.parse(localStorage.getItem("panel-terminal-layout-vector")!)).toEqual(
      vectorLayout,
    );
  });
});
