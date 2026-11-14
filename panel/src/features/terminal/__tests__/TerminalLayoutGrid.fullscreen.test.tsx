/**
 * The fullscreen controls as they render: the cell header's ⛶ after the
 * maximise control, its exit state, and their presence on each real surface.
 * `TerminalView` is a stand-in here; `TerminalFullscreenLayer.test.tsx` mounts
 * the real one for what the layer shows.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TerminalLayoutGrid } from "../TerminalLayoutGrid";
import { TerminalToolbar } from "../TerminalToolbar";
import type { SessionMeta } from "../useTerminalSessions";
import { INERT_SPEECH } from "./speech.harness";
import { installMatchMedia } from "../../../test-utils";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";

vi.mock("../useTerminalConnection", () => ({
  useTerminalConnection: () => "connected",
}));
vi.mock("../TerminalActivityLed", () => ({
  TerminalActivityLed: () => <span data-testid="activity-led" />,
}));
vi.mock("../TerminalView", () => ({
  TerminalView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`terminal-view-${sessionId}`} />
  ),
}));
vi.mock("../useOsUsers", () => ({ useOsUsers: () => ({ users: [] }) }));
vi.mock("../useDefaultTerminalUsers", () => ({
  useDefaultTerminalUsers: () => ({ defaultUsers: {}, setDefaultUser: async () => {} }),
}));

// The surfaces' data sources, so the real surfaces can be mounted.
const SESSIONS = vi.hoisted(() => [
  { id: "fs-a", name: "a", project: "vector", cwd: "/v", pid: 1, createdAt: "2026-11-14T00:00:00Z" },
  { id: "fs-b", name: "b", project: "vector", cwd: "/v", pid: 2, createdAt: "2026-11-14T00:00:01Z" },
]);
vi.mock("../useTerminalSessions", async (orig) => ({
  ...(await orig<typeof import("../useTerminalSessions")>()),
  useTerminalSessions: () => ({
    sessions: SESSIONS,
    focusedId: "fs-a",
    setFocusedId: () => {},
    createSession: async () => {},
    deleteSession: () => {},
    updateSession: () => {},
    reorder: () => {},
    tiles: [],
    placeTiles: () => {},
    applyPreset: () => {},
    minimisedIds: [],
    minimise: () => {},
    restore: () => {},
  }),
}));
vi.mock("../useAllTerminalSessions", () => ({
  useAllTerminalSessions: () => ({
    sessions: SESSIONS,
    refresh: async () => {},
    reorder: () => {},
    tiles: [],
    placeTiles: () => {},
    applyPreset: () => {},
    minimisedIds: [],
    minimise: () => {},
    restore: () => {},
  }),
}));
vi.mock("../useTerminalMaximized", () => ({
  useTerminalMaximized: () => [false, () => {}, () => {}],
}));
vi.mock("../../projects/useProjects", () => ({
  useProjects: () => [{ name: "vector", repos: [] }],
}));

const { default: ProjectTerminalsSurface } = await import("../ProjectTerminalsSurface");
const { TerminalsPage } = await import("../TerminalsPage");
const { default: TerminalDrawer } = await import("../TerminalDrawer");
const { TerminalDrawerProvider } = await import("../useTerminalDrawer");
const { TerminalSpeechHost } = await import("../TerminalSpeechHost");

beforeAll(() => {
  installMatchMedia();
});
beforeEach(() => {
  installMatchMedia();
});

function makeSession(id: string): SessionMeta {
  return { id, name: id, project: "ch", cwd: "/tmp", pid: 1, createdAt: "2026-11-14T00:00:00Z" };
}

function renderGrid(props: Partial<Parameters<typeof TerminalLayoutGrid>[0]> = {}) {
  const sessions = props.sessions ?? [makeSession("c-a"), makeSession("c-b")];
  return render(
    <TerminalLayoutGrid
      sessions={sessions}
      focusedId={sessions[0].id}
      maximized={false}
      onFocus={vi.fn()}
      onExit={vi.fn()}
      speech={INERT_SPEECH}
      fullscreenCellId={null}
      onToggleCellFullscreen={vi.fn()}
      {...props}
    />,
  );
}

const settle = () => act(async () => {});

describe("TerminalLayoutGrid — fullscreen controls", () => {
  it("cell header order is label, minimise, maximise, fullscreen, kill", async () => {
    const onToggleCellFullscreen = vi.fn();
    const onFocus = vi.fn();
    renderGrid({ onToggleCellFullscreen, onFocus });
    await settle();

    const kill = screen.getByTestId("terminal-cell-kill-c-a");
    const group = kill.parentElement!;
    const header = Array.from(group.parentElement!.children) as HTMLElement[];
    // The label precedes the control group in the header row.
    const label = header.find((el) => el.textContent?.includes("ch · c-a"))!;
    expect(header.indexOf(label)).toBeLessThan(header.indexOf(group));

    // The window controls close the group, in this order (mockup check 4).
    const ids = (Array.from(group.children) as HTMLElement[]).map((el) => el.dataset.testid);
    expect(ids.slice(-4)).toEqual([
      "terminal-cell-minimise-c-a",
      "terminal-cell-maximise-c-a",
      "terminal-cell-fullscreen-c-a",
      "terminal-cell-kill-c-a",
    ]);

    const fullscreen = screen.getByTestId("terminal-cell-fullscreen-c-a");
    expect(fullscreen).toHaveAccessibleName("Fullscreen");
    expect(fullscreen.querySelector("svg.lucide-maximize")).not.toBeNull();
    fireEvent.click(fullscreen);
    expect(onToggleCellFullscreen).toHaveBeenCalledWith("c-a");
    // Entering fullscreen is not a click on the cell body.
    expect(onFocus).not.toHaveBeenCalled();
  });

  it("fullscreen icon reads as exit while its layer is open", async () => {
    const sessions = [makeSession("x-a"), makeSession("x-b")];
    renderGrid({ sessions, fullscreenCellId: "x-a" });
    render(
      <TerminalToolbar
        sessions={sessions}
        focusedId="x-a"
        maximized={false}
        currentProject="ch"
        onFocus={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onToggleMaximize={vi.fn()}
        onReorder={vi.fn()}
        fullscreen
        onToggleFullscreen={vi.fn()}
      />,
    );
    await settle();

    // The open cell's control is the exit ⤡ (mockup check 6) ...
    const exit = screen.getByTestId("terminal-cell-fullscreen-x-a");
    expect(exit).toHaveAccessibleName("Exit fullscreen");
    expect(exit).toHaveAttribute("aria-pressed", "true");
    expect(exit.querySelector("svg.lucide-minimize-2")).not.toBeNull();
    expect(exit.querySelector("svg.lucide-maximize")).toBeNull();
    // ... while every other cell still offers to enter.
    const other = screen.getByTestId("terminal-cell-fullscreen-x-b");
    expect(other).toHaveAccessibleName("Fullscreen");
    expect(other).toHaveAttribute("aria-pressed", "false");
    expect(other.querySelector("svg.lucide-maximize")).not.toBeNull();

    // The toolbar's control, with its layer open, is the same exit icon.
    const toolbarExit = screen.getByTestId("terminal-toolbar-fullscreen");
    expect(toolbarExit).toHaveAccessibleName("Exit fullscreen");
    expect(toolbarExit).toHaveAttribute("aria-pressed", "true");
    expect(toolbarExit.querySelector("svg.lucide-minimize-2")).not.toBeNull();
  });

  it("controls appear on project tab, global view and drawer, not on mobile", async () => {
    writePreference(preferences.terminalDrawerOpen, true);
    const mount = () => {
      const tab = render(
        <MemoryRouter initialEntries={["/project/vector/iterm"]}>
          <TerminalSpeechHost>
            <div data-testid="surface-tab">
              <ProjectTerminalsSurface projectName="vector" active />
            </div>
          </TerminalSpeechHost>
        </MemoryRouter>,
      );
      const page = render(
        <MemoryRouter initialEntries={["/terminals"]}>
          <TerminalSpeechHost>
            <div data-testid="surface-page">
              <TerminalsPage />
            </div>
          </TerminalSpeechHost>
        </MemoryRouter>,
      );
      const drawer = render(
        <MemoryRouter initialEntries={["/project/vector/memo"]}>
          <TerminalSpeechHost>
            <TerminalDrawerProvider>
              <TerminalDrawer />
            </TerminalDrawerProvider>
          </TerminalSpeechHost>
        </MemoryRouter>,
      );
      return [tab, page, drawer];
    };
    const count = (root: HTMLElement | null, selector: string) =>
      root ? root.querySelectorAll(selector).length : 0;

    // Desktop: every surface's toolbar and every cell header carry them.
    let views = mount();
    await settle();
    for (const root of [
      screen.getByTestId("surface-tab"),
      screen.getByTestId("surface-page"),
      screen.getByTestId("terminal-drawer"),
    ]) {
      expect(count(root, '[data-testid="terminal-toolbar-fullscreen"]')).toBe(1);
      expect(count(root, '[data-testid^="terminal-cell-fullscreen-"]')).toBe(2);
    }
    // And they work: the drawer's toolbar control lifts the drawer's container.
    const drawer = screen.getByTestId("terminal-drawer");
    fireEvent.click(drawer.querySelector('[data-testid="terminal-toolbar-fullscreen"]')!);
    expect(drawer.querySelector('[data-terminal-fullscreen="terminal"]')).not.toBeNull();
    views.forEach((v) => v.unmount());

    // Below md: none of them, anywhere (the drawer stands down entirely).
    installMatchMedia({ mobile: true });
    views = mount();
    await settle();
    expect(screen.queryByTestId("terminal-drawer")).toBeNull();
    for (const root of [screen.getByTestId("surface-tab"), screen.getByTestId("surface-page")]) {
      expect(count(root, '[data-testid="terminal-toolbar-fullscreen"]')).toBe(0);
      expect(count(root, '[data-testid^="terminal-cell-fullscreen-"]')).toBe(0);
    }
    views.forEach((v) => v.unmount());
  });
});
