import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { cssRule, DRAWER_GAP, HAMBURGER } from "./hamburgerGeometry";
import { Layout, FloatingActionProvider } from "../Layout";
import { TerminalDrawerProvider } from "../../terminal/useTerminalDrawer";
import { MOBILE_QUERY } from "../../../lib/breakpoints";
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

/** The seam inset the RIGHT toggle still applies — `Layout`'s own constant. */
const TOGGLE_SEAM_INSET = 12;

interface Options {
  leftWidth?: number;
  leftExpanded?: boolean;
  drawer?: "left" | "right";
  drawerWidth?: number;
}

function setup(opts: Options = {}) {
  if (opts.leftWidth) {
    writePreference(preferences.leftSidebarWidth, opts.leftWidth);
  }
  if (opts.leftExpanded === false) {
    writePreference(preferences.leftSidebarExpanded, false);
  }
  if (opts.drawer) {
    writePreference(preferences.terminalDrawerOpen, true);
    writePreference(preferences.terminalDrawerSide, opts.drawer);
    if (opts.drawerWidth) {
      writePreference(preferences.terminalDrawerWidth, opts.drawerWidth);
    }
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

/**
 * Everything about the button that a render could place somewhere else: its
 * inline style, and where it hangs in the tree.
 *
 * Those are the only two inputs a component has to a position — the third is
 * the stylesheet rule, which is a constant and is asserted separately. The old
 * `sidebar-toggle-left` failed on the first of them: an inline `left` computed
 * from a frozen 228 that no longer matched the sidebar it was meant to straddle.
 */
function placement() {
  const el = screen.getByTestId("sidebar-hamburger");
  const ancestry: string[] = [];
  for (let node = el.parentElement; node; node = node.parentElement) {
    ancestry.push(node.dataset.testid ?? node.className ?? node.tagName);
  }
  return { style: el.getAttribute("style"), ancestry: ancestry.join(" < ") };
}

const leftAside = () => screen.getByTestId("layout-sidebar-left");
const collapsed = () => leftAside().className.includes("sidebar-collapsed");

/** Controllable matchMedia stub — jsdom has none, so desktop is the default. */
function installMatchMedia(mobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: () => ({
      matches: mobile,
      media: MOBILE_QUERY,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

describe("SidebarHamburger", () => {
  beforeEach(() => localStorage.clear());

  it("the hamburger toggles the left sidebar", () => {
    setup();
    // The computed toggle it replaces is gone, not merely relabelled.
    expect(screen.queryByTestId("sidebar-toggle-left")).not.toBeInTheDocument();

    expect(collapsed()).toBe(false);
    fireEvent.click(screen.getByTestId("sidebar-hamburger"));
    expect(collapsed()).toBe(true);
    fireEvent.click(screen.getByTestId("sidebar-hamburger"));
    expect(collapsed()).toBe(false);
  });

  it("the hamburger does not move when the sidebar width changes", () => {
    // The regression this control exists to prevent. `TOGGLE_BASE_LEFT_EXPANDED`
    // was a frozen `240 - 12` from when the sidebar had one width; dragged to
    // 400 the old button sat 172px inside the pane it was supposed to straddle.
    const narrow = setup({ leftWidth: 180 });
    expect(leftAside()).toHaveStyle({ width: "180px" });
    const atNarrow = placement();
    expect(atNarrow.style).toBeNull();
    narrow.unmount();

    setup({ leftWidth: 400 });
    // The sidebar really did change — otherwise this compares two identical
    // renders and would pass however the button is positioned.
    expect(leftAside()).toHaveStyle({ width: "400px" });
    expect(placement()).toEqual(atNarrow);
    // Nor is it inside the box whose width moved.
    expect(leftAside().contains(screen.getByTestId("sidebar-hamburger"))).toBe(
      false,
    );

    // With no inline geometry, the stylesheet is the only thing left that
    // places it — so the rule has to be anchored to the viewport rather than
    // to anything a sidebar owns.
    const rule = cssRule(".sidebar-hamburger");
    expect(rule).toMatch(/position:\s*fixed/);
    expect(rule).not.toMatch(/--sidebar/);
  });

  it("the hamburger does not move when a drawer docks on the left", () => {
    const bare = setup();
    const withoutDrawer = placement();
    bare.unmount();

    setup({ drawer: "left", drawerWidth: 400 });
    expect(screen.getByTestId("terminal-drawer")).toBeInTheDocument();
    expect(placement()).toEqual(withoutDrawer);
  });

  it("a COLLAPSED sidebar's left-docked drawer reserves the hamburger's corner", () => {
    // The only state in which the AC can fail, and the one its first version
    // never entered: with the sidebar EXPANDED the drawer starts at the
    // sidebar's width — 180 at its narrowest — so the button's 40px right edge
    // is behind it and the overlap is geometrically impossible. Collapsed, the
    // drawer's origin is x=0 and its header row begins under the button.
    //
    // Reserved rather than dodged: the button may not move (AC2, and the whole
    // reason this control exists), so the header yields instead — the same move
    // `<HamburgerSlot>` makes in the sidebar's own header row.
    setup({ leftExpanded: false, drawer: "left", drawerWidth: 400 });
    expect(collapsed()).toBe(true);

    const gap = screen.getByTestId("terminal-drawer-hamburger-gap");
    const header = screen.getByTestId("terminal-drawer-header");
    const close = screen.getByTestId("terminal-drawer-close");
    const resize = screen.getByTestId("terminal-drawer-resize");

    // The reservation comes BEFORE the header in the row, so the header box —
    // the drag surface, and the title inside it — begins after it rather than
    // under the button. A spacer rendered inside the header instead would
    // leave the header still claiming a strip it cannot be clicked on.
    expect(gap.nextElementSibling).toBe(header);
    expect(header.contains(gap)).toBe(false);
    // And it clears the button whole: this row starts at the viewport edge, so
    // the reserved box has to span the button's offset as well as its width.
    // Held against the rule that positions the button, not against a copy.
    expect(DRAWER_GAP.width).toBe(HAMBURGER.left + HAMBURGER.width);

    // Still true, and still worth saying: the ✕ and the rail live at the far
    // end of a drawer whose near end is the end the corner threatens.
    expect(header.className).toContain("justify-between");
    expect(header.lastElementChild).toBe(close);
    expect(resize.dataset.edge).toBe("right");
    expect(resize.className).toContain("right-0");
    // AC3's first half: the hamburger takes no correction for any of it.
    expect(screen.getByTestId("sidebar-hamburger").getAttribute("style")).toBeNull();

    fireEvent.click(close);
    expect(screen.queryByTestId("terminal-drawer")).not.toBeInTheDocument();
  });

  it("reserves nothing where the hamburger cannot reach the drawer", () => {
    // The reservation answers one geometry; it is not a permanent indent. An
    // expanded sidebar puts the drawer's origin at its width — 240 by default,
    // 180 at the floor — and a right dock puts it a viewport away.
    const expanded = setup({ drawer: "left", drawerWidth: 400 });
    expect(collapsed()).toBe(false);
    expect(leftAside()).toHaveStyle({ width: "240px" });
    expect(
      screen.queryByTestId("terminal-drawer-hamburger-gap"),
    ).not.toBeInTheDocument();
    expanded.unmount();

    setup({ leftExpanded: false, drawer: "right", drawerWidth: 400 });
    expect(collapsed()).toBe(true);
    expect(screen.getByTestId("terminal-drawer").dataset.side).toBe("right");
    expect(
      screen.queryByTestId("terminal-drawer-hamburger-gap"),
    ).not.toBeInTheDocument();
  });

  it("the hamburger is clickable while the sidebar is collapsed", () => {
    setup({ leftExpanded: false });
    const el = screen.getByTestId("sidebar-hamburger");
    expect(collapsed()).toBe(true);
    // `.sidebar` is `overflow: hidden` and `.sidebar-collapsed` is
    // `pointer-events: none`, so a hamburger rendered inside the aside would be
    // clipped away and dead exactly when it is the only way back.
    expect(leftAside().contains(el)).toBe(false);

    fireEvent.click(el);
    expect(collapsed()).toBe(false);
  });

  it("the hamburger is present on a mobile viewport", () => {
    installMatchMedia(true);
    setup({ leftExpanded: false });
    const el = screen.getByTestId("sidebar-hamburger");

    // Not behind the `hidden md:block` wrapper the right toggle sits in: on a
    // phone an edge swipe is the only other way to open the sidebar, and an
    // edge swipe is undiscoverable.
    expect(el.closest(".hidden")).toBeNull();

    fireEvent.click(el);
    expect(collapsed()).toBe(false);
  });

  it("the right toggle keeps its drawer offset", () => {
    setup({ drawer: "right", drawerWidth: 400 });
    expect(screen.getByTestId("sidebar-toggle-right")).toHaveStyle({
      right: `${preferences.rightSidebarWidth.default - TOGGLE_SEAM_INSET + 400}px`,
    });
  });
});
