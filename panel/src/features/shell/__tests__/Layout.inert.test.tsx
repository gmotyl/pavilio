import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Layout, FloatingActionProvider } from "../Layout";
import { TerminalDrawerProvider } from "../../terminal/useTerminalDrawer";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";

vi.mock("../LeftSidebar", () => ({ __esModule: true, default: () => <button type="button">Projects</button> }));
vi.mock("../RightSidebar", () => ({ __esModule: true, default: () => <button type="button">Explorer</button> }));
vi.mock("../Breadcrumbs", () => ({ Breadcrumbs: () => <div /> }));

function setup(expanded: { left: boolean; right: boolean }) {
  writePreference(preferences.leftSidebarExpanded, expanded.left);
  writePreference(preferences.rightSidebarExpanded, expanded.right);
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

// A collapsed sidebar is only moved off-screen (a 0px width, or a translate on a phone): without
// `inert` its controls stay in the tab order, and Tab lands on a button nobody can see.
describe("Layout collapsed sidebars", () => {
  beforeEach(() => localStorage.clear());

  it("are inert, so their controls leave the tab order", () => {
    setup({ left: false, right: false });
    expect(screen.getByTestId("layout-sidebar-left")).toHaveAttribute("inert");
    expect(screen.getByTestId("layout-sidebar-right")).toHaveAttribute("inert");
  });

  it("are not inert while expanded", () => {
    setup({ left: true, right: true });
    expect(screen.getByTestId("layout-sidebar-left")).not.toHaveAttribute("inert");
    expect(screen.getByTestId("layout-sidebar-right")).not.toHaveAttribute("inert");
  });
});
