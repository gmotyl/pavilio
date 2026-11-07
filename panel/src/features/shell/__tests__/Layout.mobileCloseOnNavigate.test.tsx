import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { SessionMeta } from "../../terminal/useTerminalSessions";
import { Layout, FloatingActionProvider } from "../Layout";
import { TerminalDrawerProvider } from "../../terminal/useTerminalDrawer";
import { TerminalSpeechHost } from "../../terminal/TerminalSpeechHost";
import { useSidebarState } from "../useSidebarState";
import { preferences } from "../../../preferences/declarations";
import { installMatchMedia } from "../../../test-utils";

/**
 * The REAL `LeftSidebar` inside the real `Layout`: the rule under test lives in
 * `Layout` (close on navigation), and the rows that navigate — or deliberately
 * do not — live in the sidebar. Stubbing either half would test nothing.
 */
vi.mock("../RightSidebar", () => ({ __esModule: true, default: () => <div /> }));
vi.mock("../Breadcrumbs", () => ({ Breadcrumbs: () => <div /> }));

vi.mock("../../speech/useSpeechHost", () =>
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useSpeechHost()),
);
vi.mock("../../projects/useProjects", () =>
  import("./leftSidebar.harness").then((m) =>
    m.mockShellDeps.useProjects(() => [
      { name: "vector", repos: [] },
      { name: "atlas", repos: [] },
    ]),
  ),
);
vi.mock("../../terminal/useAllTerminalSessions", () =>
  import("./leftSidebar.harness").then((m) =>
    m.mockShellDeps.useAllTerminalSessions((): SessionMeta[] => [
      {
        id: "a1",
        project: "atlas",
        name: "atlas-1",
        cwd: "/repo/atlas",
        pid: 4244,
        createdAt: "2026-01-01T00:00:02.000Z",
      },
    ]),
  ),
);
vi.mock("../../projects/useArchivedProjects", () =>
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useArchivedProjects()),
);
/**
 * Local rather than the harness's: the sidebar calls `toggle`, which the
 * harness stub does not provide, and this file taps the star.
 */
const toggleFavorite = vi.fn();
vi.mock("../../projects/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: () => false,
    toggle: (name: string) => toggleFavorite(name),
    favorites: [],
  }),
}));
vi.mock("../../mobile-access/useMobileAccessStatus", () =>
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useMobileAccessStatus()),
);
vi.mock("../../auto-sync/useAutoSyncStatus", () =>
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useAutoSyncStatus()),
);
vi.mock("../../git/useGitStatus", () =>
  import("./leftSidebar.harness").then((m) => m.mockShellDeps.useGitStatus()),
);

/**
 * Creating a terminal NAVIGATES once the server answers (to the project's
 * iterm view). A promise that never settles pins the tap itself: the sidebar
 * must not close because a button was pressed, only because the route moved.
 */
const createTerminalSession = vi.fn(() => new Promise<never>(() => {}));
vi.mock("../../terminal/createTerminalSession", () => ({
  createTerminalSession: () => createTerminalSession(),
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function setup(initialPath = "/project/vector/iterm") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <FloatingActionProvider>
        <TerminalDrawerProvider>
          <TerminalSpeechHost>
            <Layout>
              <LocationProbe />
            </Layout>
          </TerminalSpeechHost>
        </TerminalDrawerProvider>
      </FloatingActionProvider>
    </MemoryRouter>,
  );
}

const hamburger = () => screen.getByTestId("sidebar-hamburger");
const isOpen = () => hamburger().getAttribute("aria-expanded") === "true";
const location = () => screen.getByTestId("location").textContent;

/** The project-name `NavLink` inside a project's row. */
const projectLink = (name: string) =>
  within(screen.getByTestId(`sidebar-project-row-${name}`)).getByRole("link", {
    name,
  });

function openSidebar() {
  fireEvent.click(hamburger());
  expect(isOpen()).toBe(true);
}

type Doc = Record<string, unknown>;

/** Every preference key written through the portable document, as written. */
function spyPreferenceWrites(): string[] {
  const written: string[] = [];
  const holder = globalThis as { __PAVILIO_PREFS__?: Doc };
  holder.__PAVILIO_PREFS__ = new Proxy(holder.__PAVILIO_PREFS__!, {
    set(target, key, value) {
      written.push(String(key));
      return Reflect.set(target, key, value);
    },
    deleteProperty(target, key) {
      written.push(String(key));
      return Reflect.deleteProperty(target, key);
    },
  });
  return written;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  createTerminalSession.mockClear();
  toggleFavorite.mockClear();
});

describe("Layout closes the mobile left sidebar on navigation", () => {
  beforeEach(() => {
    installMatchMedia({ mobile: true });
  });

  it("mobile: tapping a project name closes the left sidebar", () => {
    setup();
    openSidebar();

    fireEvent.click(projectLink("atlas"));

    expect(location()).toBe("/project/atlas/iterm");
    expect(hamburger()).toHaveAttribute("aria-expanded", "false");
  });

  it("mobile: tapping a session row closes the left sidebar", () => {
    setup();
    openSidebar();
    fireEvent.click(screen.getByTestId("sidebar-project-expand-atlas"));
    // The chevron alone is not a navigation.
    expect(isOpen()).toBe(true);

    fireEvent.click(screen.getByTestId("sidebar-session-a1"));

    expect(location()).toBe("/project/atlas/iterm");
    expect(hamburger()).toHaveAttribute("aria-expanded", "false");
  });

  it("mobile: tapping the current project closes the left sidebar", () => {
    setup("/project/vector/iterm");
    openSidebar();

    // Same path as the one already shown: only `location.key` moves.
    fireEvent.click(projectLink("vector"));

    expect(location()).toBe("/project/vector/iterm");
    expect(hamburger()).toHaveAttribute("aria-expanded", "false");
  });

  it("mobile: non-navigating sidebar controls keep it open", () => {
    setup();
    openSidebar();

    fireEvent.click(screen.getByTestId("sidebar-project-expand-atlas"));
    fireEvent.click(screen.getByTestId("sidebar-project-favorite-atlas"));
    fireEvent.click(screen.getByTestId("sidebar-project-create-terminal-atlas"));

    expect(toggleFavorite).toHaveBeenCalledWith("atlas");
    expect(createTerminalSession).toHaveBeenCalledTimes(1);
    expect(location()).toBe("/project/vector/iterm");
    expect(isOpen()).toBe(true);
  });

  it("mobile: mounting Layout with the sidebar already open does not close it", () => {
    // The fold is shared module state, so another consumer can have opened it
    // before this Layout mounts — the mount is not a navigation.
    const other = renderHook(() => useSidebarState("leftSidebar"));
    act(() => other.result.current.setExpanded(true));

    setup();

    expect(isOpen()).toBe(true);
  });
});

describe("Layout leaves the desktop left sidebar alone on navigation", () => {
  it("desktop: navigating from the sidebar keeps it expanded and writes no preference", () => {
    installMatchMedia();
    setup("/project/vector");
    expect(isOpen()).toBe(true);
    const written = spyPreferenceWrites();

    fireEvent.click(projectLink("atlas"));
    expect(location()).toBe("/project/atlas");
    fireEvent.click(projectLink("atlas"));

    expect(isOpen()).toBe(true);
    expect(written).not.toContain(preferences.leftSidebarExpanded.key);
  });
});
