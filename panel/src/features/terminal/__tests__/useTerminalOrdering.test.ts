import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalOrdering } from "../useTerminalOrdering";
import type { SessionMeta } from "../useTerminalSessions";
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

const GRID_KEY = (scope: string) => `panel-terminal-grid-${scope}`;
const LEGACY_KEY = (scope: string) => `panel-terminal-layout-${scope}`;

const defaultFor = (ids: string[]): TileLayout =>
  expandPreset(ids, getLayoutPresets(ids.length)[0]);

const idsOf = (layout: TileLayout) => readingOrder(layout).map((t) => t.sessionId);

describe("useTerminalOrdering", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("initialises order and tiles from the scope's stored key", () => {
    const stored: TileLayout = [
      { sessionId: "b", x: 0, y: 0, w: 12, h: 6 },
      { sessionId: "a", x: 0, y: 6, w: 12, h: 6 },
    ];
    localStorage.setItem(GRID_KEY("vector"), JSON.stringify(stored));

    const { result } = renderHook(() =>
      useTerminalOrdering("vector", [session("a"), session("b")]),
    );

    expect(result.current.tiles).toEqual(stored);
    expect(result.current.sessionOrder).toEqual(["b", "a"]);
    expect(result.current.orderedSessions.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("falls back to the default preset when stored tiles are invalid", () => {
    localStorage.setItem(
      GRID_KEY("vector"),
      // Leaves the bottom half of the grid uncovered.
      JSON.stringify([{ sessionId: "a", x: 0, y: 0, w: 12, h: 6 }]),
    );

    const { result } = renderHook(() =>
      useTerminalOrdering("vector", [session("a"), session("b")]),
    );

    expect(isValidLayout(result.current.tiles)).toBe(true);
    expect(result.current.tiles).toEqual(defaultFor(["a", "b"]));
  });

  it("discards a layout written by the column model and starts from the default", () => {
    localStorage.setItem(
      LEGACY_KEY("vector"),
      JSON.stringify([[{ sessionId: "a", weight: 1 }], [{ sessionId: "b", weight: 2 }]]),
    );

    const { result } = renderHook(() =>
      useTerminalOrdering("vector", [session("a"), session("b")]),
    );

    expect(result.current.tiles).toEqual(defaultFor(["a", "b"]));
    expect(localStorage.getItem(LEGACY_KEY("vector"))).toBeNull();
  });

  it("persists tiles under the grid key after a placement", () => {
    const { result } = renderHook(() =>
      useTerminalOrdering("vector", [session("a"), session("b")]),
    );

    const placed: TileLayout = [
      { sessionId: "b", x: 0, y: 0, w: 12, h: 6 },
      { sessionId: "a", x: 0, y: 6, w: 12, h: 6 },
    ];
    act(() => result.current.placeTiles(placed));

    expect(JSON.parse(localStorage.getItem(GRID_KEY("vector"))!)).toEqual(placed);
    expect(result.current.sessionOrder).toEqual(["b", "a"]);
  });

  it("applies a preset and persists it", () => {
    const { result } = renderHook(() =>
      useTerminalOrdering("vector", [session("a"), session("b"), session("c")]),
    );
    const rows = getLayoutPresets(3).find((p) => p.label === "3 rows")!;

    act(() => result.current.applyPreset(rows));

    expect(result.current.tiles).toEqual(expandPreset(["a", "b", "c"], rows));
    expect(JSON.parse(localStorage.getItem(GRID_KEY("vector"))!)).toHaveLength(3);
  });

  it("swaps in another scope's tiles when the scope changes", () => {
    const other: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 12, h: 4 },
      { sessionId: "b", x: 0, y: 4, w: 12, h: 8 },
    ];
    localStorage.setItem(GRID_KEY("metro"), JSON.stringify(other));

    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) =>
        useTerminalOrdering(scope, [session("a"), session("b")]),
      { initialProps: { scope: "vector" } },
    );

    expect(result.current.tiles).toEqual(defaultFor(["a", "b"]));
    rerender({ scope: "metro" });
    expect(result.current.tiles).toEqual(other);
  });

  it("renders the default preset when localStorage is unavailable", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });

    try {
      const { result } = renderHook(() =>
        useTerminalOrdering("vector", [session("a"), session("b")]),
      );
      expect(result.current.tiles).toEqual(defaultFor(["a", "b"]));
    } finally {
      getItem.mockRestore();
    }
  });

  it("keeps one tile per live session under StrictMode's double invoke", () => {
    // A custom shape is stored first: without one the scope sits on the empty-layout
    // sentinel and simply re-defaults, which would not exercise reconciliation.
    localStorage.setItem(
      GRID_KEY("vector"),
      JSON.stringify([
        { sessionId: "a", x: 0, y: 0, w: 12, h: 8 },
        { sessionId: "b", x: 0, y: 8, w: 12, h: 4 },
      ]),
    );

    const { result, rerender } = renderHook(
      ({ list }: { list: SessionMeta[] }) => useTerminalOrdering("vector", list),
      { wrapper: StrictMode, initialProps: { list: [session("a"), session("b")] } },
    );

    rerender({ list: [session("a"), session("b"), session("c")] });
    act(() => result.current.syncIds(["a", "b", "c"]));

    expect(isValidLayout(result.current.tiles)).toBe(true);
    expect([...idsOf(result.current.tiles)].sort()).toEqual(["a", "b", "c"]);
  });

  it("re-defaults instead of reconciling while no custom shape is stored", () => {
    const { result, rerender } = renderHook(
      ({ list }: { list: SessionMeta[] }) => useTerminalOrdering("vector", list),
      { initialProps: { list: [session("a"), session("b")] } },
    );

    rerender({ list: [session("a"), session("b"), session("c")] });
    act(() => result.current.syncIds(["a", "b", "c"]));

    expect(result.current.tiles).toEqual(defaultFor(["a", "b", "c"]));
    expect(localStorage.getItem(GRID_KEY("vector"))).toBeNull();
  });
});
