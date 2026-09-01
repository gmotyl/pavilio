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

describe("useTerminalSessions columnLayout", () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("columnLayout initializes from panel-terminal-layout-<project> in localStorage", async () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["a", "b"]));
    localStorage.setItem(
      "panel-terminal-layout-vector",
      JSON.stringify([[{ sessionId: "a", weight: 1 }, { sessionId: "b", weight: 2 }]]),
    );
    mockFetchSessions([session("a"), session("b")]);
    const { result } = await setup("vector");
    expect(result.current.columnLayout).toEqual([
      [{ sessionId: "a", weight: 1 }, { sessionId: "b", weight: 2 }],
    ]);
  });

  it("columnLayout defaults to [] when localStorage has no entry", async () => {
    mockFetchSessions([]);
    const { result } = await setup("vector");
    expect(result.current.columnLayout).toEqual([]);
  });

  it("the old panel-terminal-columns-<project> key is removed on init", async () => {
    localStorage.setItem("panel-terminal-columns-vector", JSON.stringify([1, 2]));
    mockFetchSessions([]);
    await setup("vector");
    expect(localStorage.getItem("panel-terminal-columns-vector")).toBeNull();
  });

  it("fetchSessions reconciles columnLayout via reconcileLayout using the pre-merge sessionOrder", async () => {
    // Stored order has 3 sessions across 2 columns; the server now only
    // reports 2 of them (A closed). If the implementation mistakenly used
    // the POST-merge order (["B","C"]) as reconcileLayout's `prevOrder`, its
    // added-session detection would misfire and B/C would be re-appended as
    // stray weight-1 entries instead of the stored layout being reconciled.
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B", "C"]));
    localStorage.setItem(
      "panel-terminal-layout-vector",
      JSON.stringify([
        [{ sessionId: "A", weight: 1 }],
        [{ sessionId: "B", weight: 1 }, { sessionId: "C", weight: 1 }],
      ]),
    );
    mockFetchSessions([session("B"), session("C")]);
    const { result } = await setup("vector");
    expect(result.current.sessions.map((s) => s.id)).toEqual(["B", "C"]);
    expect(result.current.columnLayout).toEqual([
      [{ sessionId: "B", weight: 1 }, { sessionId: "C", weight: 1 }],
    ]);
  });

  it("createSession reconciles columnLayout the same way fetchSessions does", async () => {
    // Regression: createSession used to append only to sessionOrder, leaving
    // columnLayout stale — the new session was silently missing from the
    // grid until the next fetchSessions poll caught up.
    localStorage.setItem(
      "panel-terminal-order-vector",
      JSON.stringify(["A", "B", "C", "D"]),
    );
    localStorage.setItem(
      "panel-terminal-layout-vector",
      JSON.stringify([
        [{ sessionId: "A", weight: 1 }, { sessionId: "B", weight: 1 }],
        [{ sessionId: "C", weight: 1 }, { sessionId: "D", weight: 1 }],
      ]),
    );
    const existing = [session("A"), session("B"), session("C"), session("D")];
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => existing })
      .mockResolvedValueOnce({ ok: true, json: async () => session("E") });

    const { result } = await setup("vector");
    expect(result.current.columnLayout).toEqual([
      [{ sessionId: "A", weight: 1 }, { sessionId: "B", weight: 1 }],
      [{ sessionId: "C", weight: 1 }, { sessionId: "D", weight: 1 }],
    ]);

    await act(async () => {
      await result.current.createSession({});
    });

    expect(result.current.sessions.map((s) => s.id)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
    expect(result.current.columnLayout).toEqual([
      [{ sessionId: "A", weight: 1 }, { sessionId: "B", weight: 1 }],
      [{ sessionId: "C", weight: 1 }, { sessionId: "D", weight: 1 }, { sessionId: "E", weight: 1 }],
    ]);
  });

  it("columnLayout changes persist to panel-terminal-layout-<project>, removed when empty", async () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B"]));
    mockFetchSessions([session("A"), session("B")]);
    const { result } = await setup("vector");
    expect(localStorage.getItem("panel-terminal-layout-vector")).toBeNull();

    act(() => {
      result.current.applyPreset([1, 1]);
    });

    expect(result.current.columnLayout.length).toBeGreaterThan(0);
    expect(localStorage.getItem("panel-terminal-layout-vector")).toBe(
      JSON.stringify(result.current.columnLayout),
    );

    act(() => {
      result.current.applyPreset([]);
    });

    expect(result.current.columnLayout).toEqual([]);
    expect(localStorage.getItem("panel-terminal-layout-vector")).toBeNull();
  });

  it("mergeColumn applies mergeInColumn without touching sessionOrder", async () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B", "C"]));
    localStorage.setItem(
      "panel-terminal-layout-vector",
      JSON.stringify([
        [{ sessionId: "A", weight: 1 }, { sessionId: "B", weight: 1 }],
        [{ sessionId: "C", weight: 1 }],
      ]),
    );
    mockFetchSessions([session("A"), session("B"), session("C")]);
    const { result } = await setup("vector");

    act(() => {
      result.current.mergeColumn("B", "A");
    });

    expect(result.current.sessions.map((s) => s.id)).toEqual(["A", "B", "C"]);
    expect(result.current.columnLayout).toEqual([
      [{ sessionId: "B", weight: 2 }],
      [{ sessionId: "C", weight: 1 }],
      [{ sessionId: "A", weight: 1 }],
    ]);
  });

  it("joinColumn applies joinOtherColumn", async () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B", "C", "D"]));
    localStorage.setItem(
      "panel-terminal-layout-vector",
      JSON.stringify([
        [{ sessionId: "A", weight: 1 }, { sessionId: "B", weight: 1 }],
        [{ sessionId: "C", weight: 1 }, { sessionId: "D", weight: 1 }],
      ]),
    );
    mockFetchSessions([session("A"), session("B"), session("C"), session("D")]);
    const { result } = await setup("vector");

    act(() => {
      result.current.joinColumn("B", "D");
    });

    expect(result.current.sessions.map((s) => s.id)).toEqual(["A", "B", "C", "D"]);
    expect(result.current.columnLayout).toEqual([
      [{ sessionId: "A", weight: 1 }],
      [{ sessionId: "C", weight: 1 }, { sessionId: "D", weight: 1 }, { sessionId: "B", weight: 1 }],
    ]);
  });

  it("splitColumn applies splitToNewColumn", async () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B", "C", "D"]));
    localStorage.setItem(
      "panel-terminal-layout-vector",
      JSON.stringify([
        [{ sessionId: "A", weight: 1 }, { sessionId: "B", weight: 1 }],
        [{ sessionId: "C", weight: 1 }, { sessionId: "D", weight: 1 }],
      ]),
    );
    mockFetchSessions([session("A"), session("B"), session("C"), session("D")]);
    const { result } = await setup("vector");

    act(() => {
      result.current.splitColumn("B", 1);
    });

    expect(result.current.sessions.map((s) => s.id)).toEqual(["A", "B", "C", "D"]);
    expect(result.current.columnLayout).toEqual([
      [{ sessionId: "A", weight: 1 }],
      [{ sessionId: "B", weight: 1 }],
      [{ sessionId: "C", weight: 1 }, { sessionId: "D", weight: 1 }],
    ]);
  });

  it("applyPreset sets columnLayout via expandPreset against the current sessionOrder", async () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B", "C"]));
    mockFetchSessions([session("A"), session("B"), session("C")]);
    const { result } = await setup("vector");

    act(() => {
      result.current.applyPreset([1, 2]);
    });

    expect(result.current.columnLayout).toEqual([
      [{ sessionId: "A", weight: 1 }],
      [{ sessionId: "B", weight: 1 }, { sessionId: "C", weight: 1 }],
    ]);
  });

  // Regression: `columnLayout` is `[]` until the user picks a preset — the
  // "no custom layout stored" sentinel. The grid resolves that sentinel to the
  // default preset for rendering AND for its live Ctrl+drag preview, so the
  // preview looked right while every commit callback ran the pure function
  // against a literal `[]`, hit its "id not found" no-op path and changed
  // nothing. The Ctrl+drag ops resolve the same default the grid renders, so
  // the first Ctrl+drag materializes a concrete layout instead of dying.
  it("mergeColumn resolves the default preset when no layout is stored", async () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B", "C"]));
    mockFetchSessions([session("A"), session("B"), session("C")]);
    const { result } = await setup("vector");
    expect(result.current.columnLayout).toEqual([]);

    // Default preset for 3 sessions is [1, 2] => [[A], [B, C]]; C onto B is a
    // same-column merge.
    act(() => {
      result.current.mergeColumn("C", "B");
    });

    expect(result.current.columnLayout).toEqual([
      [{ sessionId: "A", weight: 1 }],
      [{ sessionId: "C", weight: 2 }],
      [{ sessionId: "B", weight: 1 }],
    ]);
  });

  it("joinColumn resolves the default preset when no layout is stored", async () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B", "C"]));
    mockFetchSessions([session("A"), session("B"), session("C")]);
    const { result } = await setup("vector");

    // [[A], [B, C]] — A onto C is a cross-column join that empties column 0.
    act(() => {
      result.current.joinColumn("A", "C");
    });

    expect(result.current.columnLayout).toEqual([
      [
        { sessionId: "B", weight: 1 },
        { sessionId: "C", weight: 1 },
        { sessionId: "A", weight: 1 },
      ],
    ]);
  });

  it("splitColumn resolves the default preset when no layout is stored", async () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B", "C"]));
    mockFetchSessions([session("A"), session("B"), session("C")]);
    const { result } = await setup("vector");

    // [[A], [B, C]] — C out to a new column at the leftmost gutter.
    act(() => {
      result.current.splitColumn("C", 0);
    });

    expect(result.current.columnLayout).toEqual([
      [{ sessionId: "C", weight: 1 }],
      [{ sessionId: "A", weight: 1 }],
      [{ sessionId: "B", weight: 1 }],
    ]);
  });

  it("a resolved Ctrl+drag layout persists, so the sentinel is only spent on a real change", async () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B", "C"]));
    mockFetchSessions([session("A"), session("B"), session("C")]);
    const { result } = await setup("vector");
    expect(localStorage.getItem("panel-terminal-layout-vector")).toBeNull();

    act(() => {
      result.current.mergeColumn("C", "B");
    });

    expect(localStorage.getItem("panel-terminal-layout-vector")).toBe(
      JSON.stringify(result.current.columnLayout),
    );
  });

  // Deliberate asymmetry: plain drag is the one op that is fully expressible
  // through sessionOrder, which the default resolution already reads — so it
  // stays a no-op on the layout and leaves the "no custom layout" sentinel
  // intact, keeping later session-count changes on the preset track.
  it("swapSessions leaves the layout sentinel untouched when no layout is stored", async () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B", "C"]));
    mockFetchSessions([session("A"), session("B"), session("C")]);
    const { result } = await setup("vector");

    act(() => {
      result.current.swapSessions("A", "C");
    });

    expect(result.current.sessions.map((s) => s.id)).toEqual(["C", "B", "A"]);
    expect(result.current.columnLayout).toEqual([]);
    expect(localStorage.getItem("panel-terminal-layout-vector")).toBeNull();
  });

  it("swapSessions updates both sessionOrder and columnLayout together", async () => {
    localStorage.setItem("panel-terminal-order-vector", JSON.stringify(["A", "B", "C"]));
    localStorage.setItem(
      "panel-terminal-layout-vector",
      JSON.stringify([
        [{ sessionId: "A", weight: 1 }, { sessionId: "B", weight: 1 }],
        [{ sessionId: "C", weight: 1 }],
      ]),
    );
    mockFetchSessions([session("A"), session("B"), session("C")]);
    const { result } = await setup("vector");

    act(() => {
      result.current.swapSessions("A", "C");
    });

    expect(result.current.sessions.map((s) => s.id)).toEqual(["C", "B", "A"]);
    expect(result.current.columnLayout).toEqual([
      [{ sessionId: "C", weight: 1 }, { sessionId: "B", weight: 1 }],
      [{ sessionId: "A", weight: 1 }],
    ]);
  });
});
