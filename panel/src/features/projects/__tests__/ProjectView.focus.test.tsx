import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { installMatchMedia } from "../../../test-utils";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import { HAMBURGER, cssPx, leftPadding } from "../../shell/__tests__/hamburgerGeometry";

vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));
vi.mock("../../shell/LeftSidebar", () => ({ __esModule: true, default: () => <div /> }));
vi.mock("../../shell/RightSidebar", () => ({ __esModule: true, default: () => <div /> }));
// The terminal surface is its own feature; here it only has to prove it is
// still mounted, strip and cells, whichever layout is on.
vi.mock("../../terminal/ProjectTerminalsSurface", () => ({
  __esModule: true,
  default: ({ projectName }: { projectName: string }) => (
    <div data-testid="terminals-surface">
      <div data-testid="terminal-strip">{projectName}</div>
      <div data-testid="terminal-cell" />
    </div>
  ),
}));

import ProjectView from "../ProjectView";
import { refreshProjects } from "../useProjects";
import { Layout, FloatingActionProvider } from "../../shell/Layout";
import { BreadcrumbActionsProvider } from "../../shell/Breadcrumbs";
import { TerminalDrawerProvider } from "../../terminal/useTerminalDrawer";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function project(name: string) {
  return {
    name,
    path: `/p/projects/${name}`,
    hasIndex: true,
    hasNotes: true,
    hasProgress: false,
    hasPlans: false,
    hasWiki: false,
    latestProgressDate: null,
    kind: "client",
    lastActivity: null,
    repos: [],
    archived: false,
  };
}

beforeEach(() => {
  installMatchMedia();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      if (url === "/api/projects") return json([project("pavilio")]);
      if (url === "/api/projects/pavilio") return json(project("pavilio"));
      if (url === "/api/archive") return json([]);
      if (url.startsWith("/api/scripts")) return json({ scripts: [] });
      if (url.startsWith("/api/files/index")) return json([]);
      return json({}, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderShell(entry = "/project/pavilio/iterm") {
  const utils = render(
    <MemoryRouter initialEntries={[entry]}>
      <FloatingActionProvider>
        <TerminalDrawerProvider>
          <BreadcrumbActionsProvider>
            <Layout>
              <Routes>
                <Route path="/project/:name/:section" element={<ProjectView />} />
              </Routes>
            </Layout>
          </BreadcrumbActionsProvider>
        </TerminalDrawerProvider>
      </FloatingActionProvider>
    </MemoryRouter>,
  );
  return utils;
}

const flush = () =>
  act(async () => {
    refreshProjects();
    await new Promise((r) => setTimeout(r, 20));
  });

const breadcrumbRow = () => screen.queryByRole("navigation", { name: "Breadcrumb" });
const titleRow = () => screen.queryByTestId("project-title-row");
const tabRow = () => screen.getByTestId("project-tabs-bar");

describe("ProjectView focus layout", () => {
  it("normal layout shows breadcrumb row, title row, tabs, strip and cells", async () => {
    renderShell();
    await flush();

    expect(breadcrumbRow()).toBeInTheDocument();
    expect(titleRow()).toBeInTheDocument();
    expect(within(titleRow()!).getByRole("heading", { name: "pavilio" })).toBeInTheDocument();
    // The title row carries today's time next to the name.
    expect(within(titleRow()!).getByRole("link")).toHaveAttribute(
      "href",
      "/project/pavilio/time",
    );
    expect(within(tabRow()).getByRole("link", { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByTestId("terminal-strip")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-cell")).toBeInTheDocument();
  });

  it("focus layout hides breadcrumb and title rows and keeps tabs, strip and cells", async () => {
    writePreference(preferences.focusLayout, true);
    renderShell();
    await flush();

    expect(breadcrumbRow()).not.toBeInTheDocument();
    expect(titleRow()).not.toBeInTheDocument();
    expect(within(tabRow()).getByRole("link", { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByTestId("terminal-strip")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-cell")).toBeInTheDocument();
    // With no breadcrumb row above it, the sticky tab row pins to the top.
    expect(tabRow().className).toMatch(/(?:^|\s)top-0(?:\s|$)/);
    expect(tabRow().className).not.toMatch(/(?:^|\s)top-9(?:\s|$)/);
  });

  it("toggle sits in the breadcrumb row normally and at the end of the tab row in focus", async () => {
    renderShell();
    await flush();

    const normal = screen.getAllByTestId("focus-layout-toggle");
    expect(normal).toHaveLength(1);
    expect(breadcrumbRow()).toContainElement(normal[0]);
    expect(tabRow()).not.toContainElement(normal[0]);
    expect(normal[0]).toHaveAttribute("aria-pressed", "false");
    expect(normal[0]).toHaveAccessibleName("Focus layout");

    act(() => normal[0].click());

    const focused = screen.getAllByTestId("focus-layout-toggle");
    expect(focused).toHaveLength(1);
    expect(tabRow()).toContainElement(focused[0]);
    // The right end: the row's last child.
    expect(tabRow().lastElementChild).toBe(focused[0]);
    expect(focused[0]).toHaveAttribute("aria-pressed", "true");
    expect(focused[0]).toHaveAccessibleName("Exit focus layout");
    expect(breadcrumbRow()).not.toBeInTheDocument();
  });

  it("below md the rows render and no toggle is shown", async () => {
    installMatchMedia({ mobile: true });
    writePreference(preferences.focusLayout, true);
    renderShell();
    await flush();

    expect(breadcrumbRow()).toBeInTheDocument();
    expect(titleRow()).toBeInTheDocument();
    expect(screen.queryByTestId("focus-layout-toggle")).not.toBeInTheDocument();
    expect(screen.getByTestId("terminal-strip")).toBeInTheDocument();
  });

  it("tab row is inset past the hamburger when focus is on and the sidebar is collapsed", async () => {
    writePreference(preferences.leftSidebarExpanded, false);
    writePreference(preferences.focusLayout, true);
    const { unmount } = renderShell();
    await flush();

    const row = tabRow();
    expect(row).toHaveClass("tab-row-hamburger-inset");
    // jsdom does no layout, so add up what does it: the page's padding plus
    // the stylesheet's inset must clear the fixed button's right edge.
    const view = screen.getByTestId("project-view");
    const firstTabLeft =
      leftPadding(view) + cssPx(".tab-row-hamburger-inset", "padding-left");
    expect(firstTabLeft).toBeGreaterThan(HAMBURGER.left + HAMBURGER.width);
    unmount();

    // Sidebar expanded: the hamburger sits over the sidebar, not the tabs.
    writePreference(preferences.leftSidebarExpanded, true);
    const expanded = renderShell();
    await flush();
    expect(tabRow()).not.toHaveClass("tab-row-hamburger-inset");
    expanded.unmount();

    // Focus off: the breadcrumb row is the top row, the tabs need no inset.
    writePreference(preferences.leftSidebarExpanded, false);
    writePreference(preferences.focusLayout, false);
    renderShell();
    await flush();
    expect(tabRow()).not.toHaveClass("tab-row-hamburger-inset");
  });
});
