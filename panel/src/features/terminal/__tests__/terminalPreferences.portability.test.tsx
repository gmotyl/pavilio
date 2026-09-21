import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { preferences } from "../../../preferences/declarations";
import {
  PREFERENCE_PATCH_DEBOUNCE_MS,
  readPreference,
} from "../../../preferences/store";
import { storageKey } from "../../../preferences/types";
import { mockFetchResponses } from "../../../test-utils";

/**
 * The portability boundary, for the one task that migrates both tiers at once.
 *
 * Four of the values here name a LIVE SESSION — the focused terminal, the
 * session order, the grid's tiling, the armed cell. A session id means nothing
 * on another machine, and the workspace preferences file is committed and
 * carried to one, so none of them may ever reach the server. The drawer's side
 * and width are the opposite case: they are a genuine choice about the panel's
 * shape and belong in that file.
 *
 * So the assertions are deliberately two-sided. A session-keyed change must
 * issue NO PATCH and leave the document exactly as it booted; a portable change
 * must issue exactly ONE and touch no browser storage. Asserting only that the
 * value round-trips would pass with every declaration on the wrong tier.
 */

vi.mock("../../projects/useITermShortcuts", () => ({
  useITermShortcuts: vi.fn(),
}));
vi.mock("../../projects/useProjects", () => ({
  useProjects: () => [{ name: "vector", repos: [] }],
}));
// The real surface mounts xterm; this task is about what its hooks persist.
vi.mock("../TerminalsSurface", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => (
    <div data-testid="surface">{String(props.currentProject)}</div>
  ),
}));

import ProjectTerminalsSurface from "../ProjectTerminalsSurface";
import { SpeechHostProvider } from "../../speech/SpeechHostProvider";
import { TerminalDrawerProvider, useTerminalDrawer } from "../useTerminalDrawer";
import { useTerminalSessions } from "../useTerminalSessions";
import { useTerminalOrdering } from "../useTerminalOrdering";
import { useTerminalMaximized } from "../useTerminalMaximized";
import { setStoredArmedSession } from "../../speech/voices";

const SESSIONS = [
  { id: "s1", name: "vector-1", project: "vector", cwd: "/", pid: 1, createdAt: "" },
  { id: "s2", name: "vector-2", project: "vector", cwd: "/", pid: 2, createdAt: "" },
];

function doc(): Record<string, unknown> {
  return (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__!;
}

function preferencePatches(mockFetch: ReturnType<typeof mockFetchResponses>): string[] {
  return mockFetch.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.startsWith("/api/preferences"));
}

/** One debounce window plus slack — long enough for any queued PATCH to have left. */
async function afterDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS * 2));
  });
}

function drawerWrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/project/vector/notes"]}>
      <TerminalDrawerProvider>{children}</TerminalDrawerProvider>
    </MemoryRouter>
  );
}

describe("the terminal tier boundary", () => {
  let mockFetch: ReturnType<typeof mockFetchResponses>;

  beforeEach(() => {
    mockFetch = mockFetchResponses({
      "/api/terminal/sessions": SESSIONS,
      "/api/preferences": { ok: true },
    });
  });

  it("declares the session-keyed values non-portable and the drawer's shape portable", () => {
    expect(preferences.terminalFocus.portable).toBe(false);
    expect(preferences.terminalOrder.portable).toBe(false);
    expect(preferences.terminalGrid.portable).toBe(false);
    expect(preferences.speechArmedCell.portable).toBe(false);

    expect(preferences.terminalDrawerOpen.portable).toBe(true);
    expect(preferences.terminalDrawerSide.portable).toBe(true);
    expect(preferences.terminalDrawerWidth.portable).toBe(true);
    expect(preferences.terminalMaximized.portable).toBe(true);
  });

  it("changing the focused terminal issues no preferences PATCH", async () => {
    const { result } = renderHook(() => useTerminalSessions("vector"));
    await waitFor(() => expect(result.current.sessions).toHaveLength(2));

    act(() => result.current.setFocusedId("s2"));
    await afterDebounce();

    expect(preferencePatches(mockFetch)).toEqual([]);
    expect(Object.keys(doc())).toEqual(["version"]);
    // It is remembered — on this machine only.
    expect(readPreference(preferences.terminalFocus, "vector")).toBe("s2");
    expect(localStorage.getItem(storageKey(preferences.terminalFocus, "vector"))).toBe('"s2"');
  });

  it("the terminal order and grid stay in localStorage", async () => {
    const { result } = renderHook(() => useTerminalOrdering("vector", SESSIONS));

    act(() => result.current.syncIds(["s1", "s2"]));
    act(() => result.current.reorder("s2", "s1"));
    act(() =>
      // A full tiling of the 48x48 grid: `orderingReducer` rejects a layout
      // that does not cover it, and would leave nothing stored.
      result.current.placeTiles([
        { sessionId: "s2", x: 0, y: 0, w: 24, h: 48 },
        { sessionId: "s1", x: 24, y: 0, w: 24, h: 48 },
      ]),
    );
    await afterDebounce();

    expect(preferencePatches(mockFetch)).toEqual([]);
    expect(Object.keys(doc())).toEqual(["version"]);
    expect(readPreference(preferences.terminalOrder, "vector")).toEqual(["s2", "s1"]);
    expect(localStorage.getItem(storageKey(preferences.terminalGrid, "vector"))).toContain("s2");
  });

  it("the armed speech cell stays in localStorage", async () => {
    expect(setStoredArmedSession("s1")).toBe("s1");
    await afterDebounce();

    expect(preferencePatches(mockFetch)).toEqual([]);
    expect(Object.keys(doc())).toEqual(["version"]);
    expect(localStorage.getItem(storageKey(preferences.speechArmedCell))).toBe('"s1"');
  });

  it("changing the drawer's side issues exactly one PATCH and touches no browser storage", async () => {
    const { result } = renderHook(() => useTerminalDrawer(), { wrapper: drawerWrapper });

    act(() => result.current.setSide("right"));
    await afterDebounce();

    expect(preferencePatches(mockFetch)).toEqual(["/api/preferences"]);
    expect(doc()[storageKey(preferences.terminalDrawerSide)]).toBe("right");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("changing the drawer's width issues exactly one PATCH and touches no browser storage", async () => {
    const { result } = renderHook(() => useTerminalDrawer(), { wrapper: drawerWrapper });

    act(() => result.current.setWidth(600));
    await afterDebounce();

    expect(preferencePatches(mockFetch)).toEqual(["/api/preferences"]);
    expect(doc()[storageKey(preferences.terminalDrawerWidth)]).toBe(600);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("maximizing is portable, and per project", async () => {
    const { result } = renderHook(() => useTerminalMaximized("vector"));

    act(() => result.current[1]());
    await afterDebounce();

    expect(preferencePatches(mockFetch)).toEqual(["/api/preferences"]);
    expect(doc()[storageKey(preferences.terminalMaximized, "vector")]).toBe(true);
    // Another project is untouched.
    expect(readPreference(preferences.terminalMaximized, "atlas")).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it("writes nothing on a cold render of the terminal surface", async () => {
    render(
      <MemoryRouter initialEntries={["/project/vector/iterm"]}>
        <SpeechHostProvider>
          <TerminalDrawerProvider>
            <ProjectTerminalsSurface projectName="vector" active />
          </TerminalDrawerProvider>
        </SpeechHostProvider>
      </MemoryRouter>,
    );
    await screen.findByTestId("surface");
    await afterDebounce();

    // A mount that only READS leaves the document exactly as it booted.
    expect(Object.keys(doc())).toEqual(["version"]);
    expect(preferencePatches(mockFetch)).toEqual([]);
  });

  it("an unresolved project never reaches the store", async () => {
    // `ProjectView` renders `projectName={name || ""}`, so a blank scope is a
    // real render, not a hypothetical — and `storageKey` throws on one.
    expect(() =>
      render(
        <MemoryRouter initialEntries={["/project//iterm"]}>
          <SpeechHostProvider>
            <TerminalDrawerProvider>
              <ProjectTerminalsSurface projectName="" active />
            </TerminalDrawerProvider>
          </SpeechHostProvider>
        </MemoryRouter>,
      ),
    ).not.toThrow();
    await afterDebounce();

    expect(Object.keys(doc())).toEqual(["version"]);
    expect(preferencePatches(mockFetch)).toEqual([]);
  });
});
