import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Layout, FloatingActionProvider } from "../Layout";
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

  it("orders the sidebars around main so the drawer can take either side", () => {
    setup(true);
    expect(screen.getByTestId("layout-sidebar-left")).toHaveStyle({ order: "1" });
    expect(screen.getByTestId("layout-main")).toHaveStyle({ order: "3" });
    expect(screen.getByTestId("layout-sidebar-right")).toHaveStyle({ order: "5" });
  });

  it("places the drawer after main when docked right", () => {
    setup(true, "right");
    expect(screen.getByTestId("terminal-drawer")).toHaveStyle({ order: "4" });
  });

  it("places the drawer before main when docked left", () => {
    setup(true, "left");
    expect(screen.getByTestId("terminal-drawer")).toHaveStyle({ order: "2" });
  });
});
