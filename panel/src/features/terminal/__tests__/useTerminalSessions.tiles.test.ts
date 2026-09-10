import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalSessions, type SessionMeta } from "../useTerminalSessions";
import {
  expandPreset,
  getLayoutPresets,
  isValidLayout,
  readingOrder,
  type TileLayout,
} from "../tileLayout";

function session(id: string, project = "vector"): SessionMeta {
  return {
    id,
    name: id,
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

const GRID_KEY = "panel-terminal-grid-vector";
const LEGACY_KEY = "panel-terminal-layout-vector";

const idsOf = (layout: TileLayout) => readingOrder(layout).map((t) => t.sessionId);

const defaultFor = (ids: string[]): TileLayout =>
  expandPreset(ids, getLayoutPresets(ids.length)[0]);

const presetFor = (count: number, label: string) =>
  getLayoutPresets(count).find((p) => p.label === label)!;

describe("useTerminalSessions tiling", () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initialises the tiling from panel-terminal-grid-<project>", async () => {
    const stored: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 48, h: 32 },
      { sessionId: "b", x: 0, y: 32, w: 48, h: 16 },
    ];
    localStorage.setItem(GRID_KEY, JSON.stringify(stored));
    mockFetchSessions([session("a"), session("b")]);

    const { result } = await setup("vector");

    expect(result.current.tiles).toEqual(stored);
  });

  it("resolves the default preset when localStorage has no entry", async () => {
    mockFetchSessions([session("a"), session("b")]);

    const { result } = await setup("vector");

    expect(result.current.tiles).toEqual(defaultFor(["a", "b"]));
    // Nothing is persisted until the user actually chooses a shape.
    expect(localStorage.getItem(GRID_KEY)).toBeNull();
  });

  it("removes the superseded column-model keys on init", async () => {
    localStorage.setItem("panel-terminal-columns-vector", JSON.stringify([1, 2]));
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([[{ sessionId: "a", weight: 1 }]]),
    );
    mockFetchSessions([session("a")]);

    await setup("vector");

    expect(localStorage.getItem("panel-terminal-columns-vector")).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("reconciles a stored tiling against the sessions the server reports", async () => {
    // Stored shape covers three sessions; the server now reports two (A closed).
    localStorage.setItem(
      GRID_KEY,
      JSON.stringify([
        { sessionId: "A", x: 0, y: 0, w: 48, h: 16 },
        { sessionId: "B", x: 0, y: 16, w: 48, h: 16 },
        { sessionId: "C", x: 0, y: 32, w: 48, h: 16 },
      ]),
    );
    mockFetchSessions([session("B"), session("C")]);

    const { result } = await setup("vector");

    expect(result.current.sessions.map((s) => s.id)).toEqual(["B", "C"]);
    expect(isValidLayout(result.current.tiles)).toBe(true);
    expect(idsOf(result.current.tiles)).toEqual(["B", "C"]);
  });

  it("createSession puts the new session into the tiling in the same cycle", async () => {
    // Regression from the column model: createSession appended only to the order,
    // leaving the layout stale, so the new session was missing from the grid until
    // the next poll caught up.
    localStorage.setItem(
      GRID_KEY,
      JSON.stringify([
        { sessionId: "A", x: 0, y: 0, w: 24, h: 48 },
        { sessionId: "B", x: 24, y: 0, w: 24, h: 48 },
      ]),
    );
    const existing = [session("A"), session("B")];
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => existing })
      .mockResolvedValueOnce({ ok: true, json: async () => session("C") });

    const { result } = await setup("vector");

    await act(async () => {
      await result.current.createSession({});
    });

    expect(result.current.sessions.map((s) => s.id)).toEqual(["A", "B", "C"]);
    expect(isValidLayout(result.current.tiles)).toBe(true);
    expect([...idsOf(result.current.tiles)].sort()).toEqual(["A", "B", "C"]);
    // The last tile in reading order splits; the first stays whole.
    expect(result.current.tiles.find((t) => t.sessionId === "A")).toMatchObject({
      x: 0,
      y: 0,
      w: 24,
      h: 48,
    });
  });

  it("persists a chosen shape and drops the key when the layout is reset", async () => {
    mockFetchSessions([session("A"), session("B")]);
    const { result } = await setup("vector");
    expect(localStorage.getItem(GRID_KEY)).toBeNull();

    act(() => result.current.applyPreset(presetFor(2, "2 rows")));

    expect(localStorage.getItem(GRID_KEY)).toBe(JSON.stringify(result.current.tiles));

    act(() => result.current.applyPreset({ label: "reset", slots: [] }));

    expect(localStorage.getItem(GRID_KEY)).toBeNull();
    // The sentinel resolves back to the default preset for the live count.
    expect(result.current.tiles).toEqual(defaultFor(["A", "B"]));
  });

  it("deleteSession hands the closed terminal's space back to the survivors", async () => {
    // A close used to touch only the sessions list: the tile stayed in the layout as
    // an invisible hole, and the per-project surface has no poll to heal it.
    localStorage.setItem(
      GRID_KEY,
      JSON.stringify([
        { sessionId: "A", x: 0, y: 0, w: 24, h: 48 },
        { sessionId: "B", x: 24, y: 0, w: 24, h: 48 },
      ]),
    );
    mockFetchSessions([session("A"), session("B")]);
    const { result } = await setup("vector");

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({}) });
    await act(async () => {
      await result.current.deleteSession("A");
    });

    expect(result.current.sessions.map((s) => s.id)).toEqual(["B"]);
    expect(isValidLayout(result.current.tiles)).toBe(true);
    expect(result.current.tiles).toEqual([{ sessionId: "B", x: 0, y: 0, w: 48, h: 48 }]);
  });

  it("a terminal opened after closing every other one gets the whole grid", async () => {
    // Greg's report: resize a few, close them all, open a new one -> it appeared as a
    // sliver because the dead tiles still held the rest of the grid.
    localStorage.setItem(
      GRID_KEY,
      JSON.stringify([
        { sessionId: "A", x: 0, y: 0, w: 30, h: 20 },
        { sessionId: "B", x: 30, y: 0, w: 18, h: 20 },
        { sessionId: "C", x: 0, y: 20, w: 16, h: 28 },
        { sessionId: "D", x: 16, y: 20, w: 32, h: 28 },
      ]),
    );
    mockFetchSessions([session("A"), session("B"), session("C"), session("D")]);
    const { result } = await setup("vector");

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({}) });
    for (const id of ["A", "B", "C", "D"]) {
      await act(async () => {
        await result.current.deleteSession(id);
      });
    }

    expect(result.current.sessions).toEqual([]);
    // Nothing left to shape: the sentinel is empty and the key is gone.
    expect(localStorage.getItem(GRID_KEY)).toBeNull();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => session("E"),
    });
    await act(async () => {
      await result.current.createSession({});
    });

    expect(result.current.tiles).toEqual([{ sessionId: "E", x: 0, y: 0, w: 48, h: 48 }]);
  });

  it("commits a placement without disturbing the sessions list", async () => {
    mockFetchSessions([session("A"), session("B")]);
    const { result } = await setup("vector");

    const placed: TileLayout = [
      { sessionId: "B", x: 0, y: 0, w: 48, h: 24 },
      { sessionId: "A", x: 0, y: 24, w: 48, h: 24 },
    ];
    act(() => result.current.placeTiles(placed));

    expect(result.current.tiles).toEqual(placed);
    // Reading order drives the tab strip, so the order follows the grid.
    expect(result.current.sessions.map((s) => s.id)).toEqual(["B", "A"]);
  });
});
