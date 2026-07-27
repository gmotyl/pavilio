import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Layout, FloatingActionProvider } from "../Layout";
import { LAYOUT_ORDER } from "../Layout/order";
import { TerminalDrawerProvider } from "../../terminal/useTerminalDrawer";

vi.mock("../LeftSidebar", () => ({ __esModule: true, default: () => <div /> }));
vi.mock("../RightSidebar", () => ({ __esModule: true, default: () => <div /> }));
vi.mock("../Breadcrumbs", () => ({ Breadcrumbs: () => <div /> }));
vi.mock("../../terminal/ProjectTerminalsSurface", () => ({
  __esModule: true,
  default: ({ projectName }: { projectName: string }) => (
    <div data-testid="surface">{projectName}</div>
  ),
}));

function setup(open: boolean, side: "left" | "right" = "right") {
  if (open) localStorage.setItem("panel:terminalDrawer:open", "true");
  localStorage.setItem("panel:terminalDrawer:side", side);
  return render(
    <MemoryRouter initialEntries={["/project/vector/memo"]}>
      <FloatingActionProvider>
        <TerminalDrawerProvider>
          <Layout>
            <div>page content</div>
          </Layout>
        </TerminalDrawerProvider>
      </FloatingActionProvider>
    </MemoryRouter>,
  );
}

describe("Layout terminal drawer slot", () => {
  beforeEach(() => localStorage.clear());

  it("does not render the drawer when closed", () => {
    setup(false);
    expect(screen.queryByTestId("terminal-drawer")).not.toBeInTheDocument();
  });

  it("renders the drawer alongside the page content when open", () => {
    setup(true);
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-drawer")).toBeInTheDocument();
  });

  it("keeps the slot map bracketed: sidebars outside the drawer slots", () => {
    expect(LAYOUT_ORDER.sidebarLeft).toBeLessThan(LAYOUT_ORDER.drawerLeft);
    expect(LAYOUT_ORDER.drawerLeft).toBeLessThan(LAYOUT_ORDER.main);
    expect(LAYOUT_ORDER.main).toBeLessThan(LAYOUT_ORDER.drawerRight);
    expect(LAYOUT_ORDER.drawerRight).toBeLessThan(LAYOUT_ORDER.sidebarRight);
    // Zero-width toggle wrappers keep the default order: 0, so slots start at 1.
    expect(LAYOUT_ORDER.sidebarLeft).toBeGreaterThan(0);
  });

  it("orders the sidebars around main so the drawer can take either side", () => {
    setup(true);
    expect(screen.getByTestId("layout-sidebar-left")).toHaveStyle({
      order: String(LAYOUT_ORDER.sidebarLeft),
    });
    expect(screen.getByTestId("layout-main")).toHaveStyle({
      order: String(LAYOUT_ORDER.main),
    });
    expect(screen.getByTestId("layout-sidebar-right")).toHaveStyle({
      order: String(LAYOUT_ORDER.sidebarRight),
    });
  });

  it("places the drawer after main when docked right", () => {
    setup(true, "right");
    expect(screen.getByTestId("terminal-drawer")).toHaveStyle({
      order: String(LAYOUT_ORDER.drawerRight),
    });
  });

  it("places the drawer before main when docked left", () => {
    setup(true, "left");
    expect(screen.getByTestId("terminal-drawer")).toHaveStyle({
      order: String(LAYOUT_ORDER.drawerLeft),
    });
  });
});
