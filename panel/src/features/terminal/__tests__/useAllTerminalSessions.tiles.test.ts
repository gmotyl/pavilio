import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAllTerminalSessions } from "../useAllTerminalSessions";
import type { SessionMeta } from "../useTerminalSessions";
import { GRID, getLayoutPresets, readingOrder, type TileLayout } from "../tileLayout";

vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));

function session(id: string, project: string): SessionMeta {
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

const idsOf = (layout: TileLayout) => readingOrder(layout).map((t) => t.sessionId);

const presetFor = (count: number, label: string) =>
  getLayoutPresets(count).find((p) => p.label === label)!;

const GRID_KEY = "panel-terminal-grid-__all__";

describe("useAllTerminalSessions tiling", () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initialises the tiling from panel-terminal-grid-__all__", async () => {
    const stored: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 48, h: 32 },
      { sessionId: "b", x: 0, y: 32, w: 48, h: 16 },
    ];
    localStorage.setItem(GRID_KEY, JSON.stringify(stored));
    mockFetchSessions([session("a", "vector"), session("b", "metro")]);

    const { result } = await setup();

    expect(result.current.tiles).toEqual(stored);
  });

  it("commits and persists a placement made on the global tab", async () => {
    mockFetchSessions([
      session("a", "vector"),
      session("b", "metro"),
      session("c", "vector"),
    ]);
    const { result } = await setup();

    // No custom shape yet: the grid resolves the default preset for three.
    expect(result.current.tiles).toEqual(
      expandDefault(["a", "b", "c"]),
    );

    const placed: TileLayout = [
      { sessionId: "a", x: 0, y: 0, w: 48, h: 16 },
      { sessionId: "b", x: 0, y: 16, w: 48, h: 16 },
      { sessionId: "c", x: 0, y: 32, w: 48, h: 16 },
    ];
    act(() => result.current.placeTiles(placed));

    expect(result.current.tiles).toEqual(placed);
    expect(JSON.parse(localStorage.getItem(GRID_KEY)!)).toEqual(placed);
  });

  it("applyPreset covers every cross-project session", async () => {
    mockFetchSessions([
      session("a", "vector"),
      session("b", "metro"),
      session("c", "ch"),
    ]);
    const { result } = await setup();

    act(() => result.current.applyPreset(presetFor(3, "3 rows")));

    expect(idsOf(result.current.tiles)).toEqual(["a", "b", "c"]);
    expect(result.current.tiles.every((t) => t.w === GRID && t.h === GRID / 3)).toBe(
      true,
    );
  });

  it("keeps a custom layout across a poll refresh", async () => {
    mockFetchSessions([session("a", "vector"), session("b", "metro")]);
    const { result } = await setup();

    act(() => result.current.applyPreset(presetFor(2, "2 rows")));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.tiles.map((t) => t.h)).toEqual([GRID / 2, GRID / 2]);
    expect(idsOf(result.current.tiles)).toEqual(["a", "b"]);
  });

  it("drops a closed session from the tiling on refresh", async () => {
    mockFetchSessions([session("a", "vector"), session("b", "metro")]);
    const { result } = await setup();

    act(() => result.current.applyPreset(presetFor(2, "2 rows")));
    mockFetchSessions([session("a", "vector")]);
    await act(async () => {
      await result.current.refresh();
    });

    expect(idsOf(result.current.tiles)).toEqual(["a"]);
    // The survivor absorbs the freed rectangle rather than leaving a hole.
    expect(result.current.tiles[0]).toMatchObject({ x: 0, y: 0, w: 48, h: 48 });
  });

  // The user's second symptom: "dragging panels on the terminals view is not
  // persisted — I change it and when I go back it is forgotten." This pins the round
  // trip: commit a shape, tear the hook down, mount a fresh instance against the same
  // storage and the same session list, and get the same grid back.
  it("a global-scope layout survives unmount and remount", async () => {
    const live = [session("a", "vector"), session("b", "metro"), session("c", "ch")];
    mockFetchSessions(live);
    const first = await setupStrict();

    // "3 rows" is deliberately NOT the default for three sessions, so a remount that
    // forgot the layout would produce a visibly different shape rather than
    // accidentally matching.
    act(() => first.result.current.applyPreset(presetFor(3, "3 rows")));
    const committed = first.result.current.tiles;
    const persisted = localStorage.getItem(GRID_KEY);
    expect(persisted).not.toBeNull();

    first.unmount();

    // Storage is intentionally left alone across the boundary — that is the
    // navigate-away-and-back the report described.
    expect(localStorage.getItem(GRID_KEY)).toBe(persisted);

    mockFetchSessions(live);
    const second = await setupStrict();

    expect(second.result.current.tiles).toEqual(committed);
    expect(second.result.current.sessions.map((s) => s.id)).toEqual(["a", "b", "c"]);
    const flat = idsOf(second.result.current.tiles);
    expect(new Set(flat).size).toBe(flat.length);
  });

  // Every WebSocket message refetches on this page, on top of the 8s poll — so a
  // re-sync of an id set that did not change is the steady state, not an edge case.
  it("a re-sync of an unchanged id set does not alter the stored layout", async () => {
    const live = [session("a", "vector"), session("b", "metro"), session("c", "ch")];
    mockFetchSessions(live);
    const { result } = await setupStrict();

    act(() => result.current.applyPreset(presetFor(3, "3 rows")));
    const afterCommit = localStorage.getItem(GRID_KEY);
    const committedTiles = result.current.tiles;

    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await result.current.refresh();
      });
    }

    expect(localStorage.getItem(GRID_KEY)).toBe(afterCommit);
    // An unchanged sync must bail out to the same state reference rather than rebuild
    // the tiling — that is what keeps the persist effect from firing on every tick.
    expect(result.current.tiles).toBe(committedTiles);
    expect(idsOf(result.current.tiles)).toEqual(["a", "b", "c"]);
  });
});

function expandDefault(ids: string[]): TileLayout {
  const preset = getLayoutPresets(ids.length)[0];
  return preset.slots.map((slot, i) => ({ sessionId: ids[i], ...slot }));
}
