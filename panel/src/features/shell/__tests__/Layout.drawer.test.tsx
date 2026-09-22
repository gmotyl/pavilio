import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Layout, FloatingActionProvider } from "../Layout";
import { LAYOUT_ORDER } from "../Layout/order";
import { TerminalDrawerProvider } from "../../terminal/useTerminalDrawer";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";

vi.mock("../LeftSidebar", () => ({ __esModule: true, default: () => <div /> }));
vi.mock("../RightSidebar", () => ({ __esModule: true, default: () => <div /> }));
vi.mock("../Breadcrumbs", () => ({ Breadcrumbs: () => <div /> }));
vi.mock("../../terminal/ProjectTerminalsSurface", () => ({
  __esModule: true,
  default: ({ projectName }: { projectName: string }) => (
    <div data-testid="surface">{projectName}</div>
  ),
}));

/** The inline offsets the RIGHT toggle uses — the only ones left in the shell.
 *  The left side is `sidebar-hamburger` now, placed by the stylesheet against
 *  the viewport; `SidebarHamburger.test.tsx` owns the claim that nothing moves
 *  it.
 *
 *  Not a constant in `Layout` any more: the right sidebar's default width less
 *  the 12px the toggle sits inside its seam. Derived from the declaration
 *  rather than copied from it, so changing the default cannot leave this
 *  arithmetic quietly asserting the old seam. */
const TOGGLE_BASE_RIGHT_EXPANDED = preferences.rightSidebarWidth.default - 12;
const TOGGLE_BASE_COLLAPSED = 8;

function setup(
  open: boolean,
  side: "left" | "right" = "right",
  opts: {
    width?: number;
    leftExpanded?: boolean;
    rightExpanded?: boolean;
    rightSidebarWidth?: number;
  } = {},
) {
  // The drawer's open intent, side and width are portable preferences now,
  // not raw localStorage keys.
  if (open) writePreference(preferences.terminalDrawerOpen, true);
  writePreference(preferences.terminalDrawerSide, side);
  if (opts.width) {
    writePreference(preferences.terminalDrawerWidth, opts.width);
  }
  if (opts.leftExpanded === false) {
    writePreference(preferences.leftSidebarExpanded, false);
  }
  if (opts.rightExpanded === false) {
    writePreference(preferences.rightSidebarExpanded, false);
  }
  if (opts.rightSidebarWidth) {
    writePreference(preferences.rightSidebarWidth, opts.rightSidebarWidth);
  }
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

describe("Layout data-panel-region contract", () => {
  beforeEach(() => localStorage.clear());

  // TerminalDrawer measures the sidebars via these attributes to place its
  // drop-zone hint, so Layout must keep providing them.
  it("marks both sidebars with the region attribute the drawer queries", () => {
    setup(true);
    expect(screen.getByTestId("layout-sidebar-left")).toHaveAttribute(
      "data-panel-region",
      "sidebar-left",
    );
    expect(screen.getByTestId("layout-sidebar-right")).toHaveAttribute(
      "data-panel-region",
      "sidebar-right",
    );
    expect(
      document.querySelectorAll("[data-panel-region^='sidebar-']"),
    ).toHaveLength(2);
  });
});

describe("Layout sidebar toggles vs a docked drawer", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the right toggle at its base offset when the drawer is closed", () => {
    setup(false);
    expect(screen.getByTestId("sidebar-toggle-right")).toHaveStyle({
      right: `${TOGGLE_BASE_RIGHT_EXPANDED}px`,
    });
    // There is no left toggle to offset any more, in any drawer state.
    expect(screen.queryByTestId("sidebar-toggle-left")).not.toBeInTheDocument();
  });

  it("pushes the right toggle out past a drawer docked right", () => {
    setup(true, "right", { width: 400 });
    expect(screen.getByTestId("sidebar-toggle-right")).toHaveStyle({
      right: `${TOGGLE_BASE_RIGHT_EXPANDED + 400}px`,
    });
    // The left corner has a drawer nowhere near it, and takes no correction
    // for one either — an inline style here would be the old defect returning.
    expect(screen.getByTestId("sidebar-hamburger")).not.toHaveAttribute("style");
  });

  it("leaves both controls alone when the drawer docks left", () => {
    // The mirror of the case above, and the one the left toggle used to answer
    // with an offset: this drawer is on the other side of <main> from the right
    // toggle, and the hamburger's corner is clear of its header and rail.
    setup(true, "left", { width: 400 });
    expect(screen.getByTestId("sidebar-toggle-right")).toHaveStyle({
      right: `${TOGGLE_BASE_RIGHT_EXPANDED}px`,
    });
    expect(screen.getByTestId("sidebar-hamburger")).not.toHaveAttribute("style");
  });

  it("stacks the drawer offset on a RESIZED sidebar's seam, not on 264", () => {
    // The two offsets are independent and they compose: the toggle sits 12px
    // inside whatever width the user dragged the sidebar to, and the drawer
    // then pushes that whole thing outward. Every other case here leaves the
    // sidebar at its default, where a re-frozen 252 would still pass.
    setup(true, "right", { width: 400, rightSidebarWidth: 360 });
    expect(screen.getByTestId("sidebar-toggle-right")).toHaveStyle({
      right: `${360 - 12 + 400}px`,
    });
  });

  it("offsets from the collapsed base when the sidebar is collapsed", () => {
    setup(true, "right", { width: 400, rightExpanded: false });
    expect(screen.getByTestId("sidebar-toggle-right")).toHaveStyle({
      right: `${TOGGLE_BASE_COLLAPSED + 400}px`,
    });
  });
});
