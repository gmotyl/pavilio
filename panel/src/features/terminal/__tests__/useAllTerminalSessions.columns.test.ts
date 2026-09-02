import { StrictMode } from "react";
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

// Same as setup(), but under <StrictMode> — the panel has no production mode
// (src/main.tsx always wraps <App /> in it), so double-invoked reducers and the
// mount/unmount/remount effect replay are the *only* condition the global
// terminals page ever runs in. Persistence has to hold there, not just in a
// single-pass render.
async function setupStrict() {
  let hook!: ReturnType<
    typeof renderHook<ReturnType<typeof useAllTerminalSessions>, unknown>
  >;
  await act(async () => {
    hook = renderHook(() => useAllTerminalSessions(), { wrapper: StrictMode });
  });
  return hook;
}

const ids = (layout: { sessionId: string }[][]) =>
  layout.map((column) => column.map((entry) => entry.sessionId));

const flatIds = (layout: { sessionId: string }[][]) =>
  layout.flatMap((column) => column.map((entry) => entry.sessionId));

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

  // The user's second symptom: "dragging panels on the terminals view is not
  // persisted — I change it and when I go back it is forgotten." The living spec
  // already requires it to persist, so this pins the round trip: commit a shape,
  // tear the hook down, mount a fresh instance against the same storage and the
  // same session list, and get the same grid back.
  it("a global-scope layout survives unmount and remount", async () => {
    const live = [session("a", "vector"), session("b", "metro"), session("c", "ch")];
    mockFetchSessions(live);
    const first = await setupStrict();

    // [2, 1] — [[a, b], [c]] — is deliberately NOT the default preset for three
    // sessions (that is [1, 2]), so a remount that "forgot" the layout and fell
    // back to the sentinel would produce a visibly different shape rather than
    // accidentally matching.
    act(() => first.result.current.applyPreset([2, 1]));
    expect(ids(first.result.current.columnLayout)).toEqual([["a", "b"], ["c"]]);
    const persisted = localStorage.getItem("panel-terminal-layout-__all__");
    expect(persisted).not.toBeNull();

    first.unmount();

    // Storage is intentionally left alone across the boundary — that is the
    // navigate-away-and-back the report described.
    expect(localStorage.getItem("panel-terminal-layout-__all__")).toBe(persisted);

    mockFetchSessions(live);
    const second = await setupStrict();

    expect(ids(second.result.current.columnLayout)).toEqual([["a", "b"], ["c"]]);
    expect(second.result.current.sessions.map((s) => s.id)).toEqual(["a", "b", "c"]);
    // The remount's own mount-time syncIds must not have re-appended anything.
    const flat = flatIds(second.result.current.columnLayout);
    expect(new Set(flat).size).toBe(flat.length);
  });

  // Every WebSocket message refetches on this page (useAllTerminalSessions'
  // lastMessage effect), on top of the 8s poll — so a re-sync of an id set that
  // did not change is the steady state, not an edge case. It used to reshape the
  // grid: reconcileLayout computed `added` against a stale prev order, so a
  // replayed sync appended ids the layout already held, which is what made a
  // hand-arranged grid look like it had been forgotten.
  it("a re-sync of an unchanged id set does not alter the stored layout", async () => {
    const live = [session("a", "vector"), session("b", "metro"), session("c", "ch")];
    mockFetchSessions(live);
    const { result } = await setupStrict();

    act(() => result.current.applyPreset([2, 1]));
    const afterCommit = localStorage.getItem("panel-terminal-layout-__all__");
    const committedLayout = result.current.columnLayout;

    // refresh() is fetchAll — the exact function the poll interval and the WS
    // effect invoke — so each of these is a genuine second fetch resolving the
    // same id set, followed by a real syncIds dispatch.
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await result.current.refresh();
      });
    }

    expect(ids(result.current.columnLayout)).toEqual([["a", "b"], ["c"]]);
    expect(localStorage.getItem("panel-terminal-layout-__all__")).toBe(afterCommit);
    // An unchanged sync must bail out to the same state reference rather than
    // rebuild the columns — that is what keeps the persist effect from firing on
    // every 8s tick (see orderingReducer's `commit`).
    expect(result.current.columnLayout).toBe(committedLayout);
    const flat = flatIds(result.current.columnLayout);
    expect(flat).toEqual(["a", "b", "c"]);
    expect(new Set(flat).size).toBe(flat.length);
  });
});
