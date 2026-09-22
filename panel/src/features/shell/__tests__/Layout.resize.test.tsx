import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Layout, FloatingActionProvider } from "../Layout";
import { TerminalDrawerProvider } from "../../terminal/useTerminalDrawer";
import { MOBILE_QUERY } from "../../../lib/breakpoints";
import { preferences } from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";

vi.mock("../LeftSidebar", () => ({ __esModule: true, default: () => <div /> }));
vi.mock("../RightSidebar", () => ({ __esModule: true, default: () => <div /> }));
vi.mock("../Breadcrumbs", () => ({ Breadcrumbs: () => <div /> }));

/**
 * Answers only the one query the panel asks. A stub that said `mobile` to every
 * query would also be answering for anything else that reaches `matchMedia`,
 * and a later `matches` read would then be testing the stub.
 */
function stubMatchMedia(mobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query === MOBILE_QUERY ? mobile : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

function setup(opts: { leftExpanded?: boolean; rightExpanded?: boolean } = {}) {
  if (opts.leftExpanded === false) {
    writePreference(preferences.leftSidebarExpanded, false);
  }
  if (opts.rightExpanded === false) {
    writePreference(preferences.rightSidebarExpanded, false);
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

const leftAside = () => screen.getByTestId("layout-sidebar-left");
const rightAside = () => screen.getByTestId("layout-sidebar-right");
const leftRail = () => screen.getByTestId("pane-resize-sidebar-left");
const rightRail = () => screen.getByTestId("pane-resize-sidebar-right");

/** Press the rail and move the pointer `dx`, without letting go. */
function dragTo(handle: HTMLElement, dx: number) {
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500 + dx });
}

/** Drag a rail by `dx` pixels and let go. */
function dragBy(handle: HTMLElement, dx: number) {
  dragTo(handle, dx);
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 500 + dx });
}

const rightToggle = () => screen.getByTestId("sidebar-toggle-right");

describe("resizing the shell's sidebars", () => {
  beforeEach(() => {
    // jsdom implements neither of these
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    stubMatchMedia(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("an expanded sidebar renders a resize handle on desktop", () => {
    setup();

    for (const handle of [leftRail(), rightRail()]) {
      expect(handle).toHaveAttribute("role", "separator");
      expect(handle).toHaveAttribute("aria-orientation", "vertical");
    }
    // The INNER edge, and the two sides are mirror images: the left sidebar's
    // seam with <main> is on its right, the right sidebar's on its left. Both
    // carrying "right" would still render two rails and still drag — it would
    // just grow the right sidebar backwards.
    expect(leftRail()).toHaveAttribute("data-edge", "right");
    expect(rightRail()).toHaveAttribute("data-edge", "left");

    // The applied width comes from the hook, in pixels — these two numbers are
    // the declared defaults of `shell.leftSidebar.width` and
    // `shell.rightSidebar.width`. A `var()` here would be a width the hook
    // cannot start a drag from, since it takes its starting point from React
    // state and never a measurement.
    expect(leftAside().style.width).toBe("240px");
    expect(rightAside().style.width).toBe("264px");
    expect(leftAside().style.width).not.toMatch(/var\(/);

    // The rail is absolutely positioned and `.sidebar` is not positioned on
    // desktop, so without this it would resolve against `.layout-container`
    // and sit in the middle of the page.
    expect(leftAside().className).toMatch(/\brelative\b/);
    expect(rightAside().className).toMatch(/\brelative\b/);
    // And it lives outside the sidebar's own scrolling body, so it does not
    // scroll away with the project list.
    expect(leftAside().contains(leftRail())).toBe(true);
    expect(rightAside().contains(rightRail())).toBe(true);
  });

  it("dragging a sidebar handle changes and persists that sidebar's width", () => {
    setup();

    dragBy(leftRail(), 40);
    expect(leftAside().style.width).toBe("280px");
    expect(readPreference(preferences.leftSidebarWidth)).toBe(280);

    // Leftward, because this rail's inner edge faces the other way — the same
    // gesture "outward from <main>" is a negative dx on this side.
    dragBy(rightRail(), -40);
    expect(rightAside().style.width).toBe("304px");
    expect(readPreference(preferences.rightSidebarWidth)).toBe(304);
  });

  it("resizing one sidebar leaves the other alone", () => {
    // Two declarations, not one. Everything below passes if the sides share a
    // key ONLY in the sense that it would then read a single number — which is
    // exactly what each half here refuses.
    writePreference(preferences.rightSidebarWidth, 320);
    setup();

    // A stored right-hand width must not reach the left, which has its own
    // default...
    expect(leftAside().style.width).toBe("240px");
    expect(rightAside().style.width).toBe("320px");

    // ...and dragging the left must not reach the right.
    dragBy(leftRail(), -40);
    expect(leftAside().style.width).toBe("200px");
    expect(rightAside().style.width).toBe("320px");
    expect(readPreference(preferences.leftSidebarWidth)).toBe(200);
    expect(readPreference(preferences.rightSidebarWidth)).toBe(320);
  });

  it("a collapsed sidebar renders no handle", () => {
    setup({ leftExpanded: false });

    // Width 0: there is no inner edge to grab, and a rail on a zero-width box
    // would be a grab target hovering over <main>.
    expect(screen.queryByTestId("pane-resize-sidebar-left")).toBeNull();
    expect(leftAside().style.width).toBe("0px");
    // The other side is untouched — collapsing is per-sidebar too.
    expect(rightRail()).toBeInTheDocument();
    expect(rightAside().style.width).toBe("264px");
  });

  it("a sidebar drops its width transition for the length of the drag", () => {
    // `.sidebar` in `index.css` carries `transition: width 250ms cubic-bezier`
    // for the COLLAPSE, and that is the same node the inline pixel width lands
    // on. Left alone, every pointermove would ease the width over 250ms and
    // restart the next frame — the aside, and the rail under the user's
    // finger, trail the pointer and overshoot the release.
    //
    // It has to be the inline style. `index.css` declares no `@layer`, so
    // `.sidebar` is an UNLAYERED author rule while Tailwind v4's utilities
    // live in `@layer utilities`; unlayered beats layered outright, so a
    // `transition-none` class would lose to the rule it is meant to cancel.
    setup();

    expect(leftAside().style.transition).toBe("");

    dragTo(leftRail(), 40);
    expect(leftAside().style.transition).toBe("none");
    // Only the pane being dragged. The other sidebar is not moving, so there
    // is nothing for it to lag behind.
    expect(rightAside().style.transition).toBe("");

    fireEvent.pointerUp(leftRail(), { pointerId: 1, clientX: 540 });
    // ...and the moment the pointer lifts the stylesheet is back in charge,
    // so collapsing still animates.
    expect(leftAside().style.transition).toBe("");
    expect(leftAside().style.width).toBe("280px");

    dragTo(rightRail(), -40);
    expect(rightAside().style.transition).toBe("none");
    expect(leftAside().style.transition).toBe("");
    fireEvent.pointerUp(rightRail(), { pointerId: 1, clientX: 460 });
    expect(rightAside().style.transition).toBe("");
  });

  it("collapsing keeps the stylesheet's transition", () => {
    // The collapse is the reason `.sidebar` has a width transition at all. No
    // drag is in flight when a sidebar is toggled, so nothing inline may
    // shadow it — a blanket `transition: none` would fix the lag by killing
    // the animation it was added for.
    setup({ leftExpanded: false });

    expect(leftAside().style.width).toBe("0px");
    expect(leftAside().style.transition).toBe("");
    expect(leftAside().className).toMatch(/\bsidebar-collapsed\b/);
  });

  it("the right toggle stays on the sidebar's seam as it is resized", () => {
    // The button is viewport-anchored and absolute, so its offset has to be
    // derived from the sidebar's LIVE width. Frozen at the old fixed 264 it
    // would sit 164px inside a sidebar dragged to 440, floating over the file
    // tree instead of on its edge.
    setup();

    expect(rightToggle().style.right).toBe("252px");

    dragBy(rightRail(), -40);
    expect(rightAside().style.width).toBe("304px");
    expect(rightToggle().style.right).toBe("292px");

    dragBy(rightRail(), -600);
    expect(rightAside().style.width).toBe("440px");
    expect(rightToggle().style.right).toBe("428px");
  });

  it("the drag stops at the widths each sidebar was given", () => {
    // Nothing else pins LEFT_BOUNDS or RIGHT_BOUNDS: both could be widened to
    // {min: 20, max: 4000} and the rest of the suite would stay green —
    // including a left floor that turns the project rows into a column of
    // ellipses, and a right ceiling that takes <main>'s larger half.
    setup();

    dragBy(leftRail(), 600);
    expect(leftAside().style.width).toBe("400px");
    expect(readPreference(preferences.leftSidebarWidth)).toBe(400);

    dragBy(leftRail(), -600);
    expect(leftAside().style.width).toBe("180px");
    expect(readPreference(preferences.leftSidebarWidth)).toBe(180);

    // The right sidebar holds file TREES, which indent: a higher floor to keep
    // a nested filename readable, a wider ceiling because a deep path is the
    // reason you widen it at all.
    dragBy(rightRail(), -600);
    expect(rightAside().style.width).toBe("440px");
    expect(readPreference(preferences.rightSidebarWidth)).toBe(440);

    dragBy(rightRail(), 600);
    expect(rightAside().style.width).toBe("200px");
    expect(readPreference(preferences.rightSidebarWidth)).toBe(200);
  });

  it("mobile sidebars have no handle and keep a fixed width", () => {
    stubMatchMedia(true);
    setup();

    expect(screen.queryByTestId("pane-resize-sidebar-left")).toBeNull();
    expect(screen.queryByTestId("pane-resize-sidebar-right")).toBeNull();

    // On a phone both sidebars are `position: fixed` overlays that `index.css`
    // pins at `width: 280px !important`, and they slide in and out on a
    // transform rather than on their width. So the honest thing to write here
    // is NO width at all: a px width from the hook would be a desktop habit
    // stamped onto a box whose width the phone does not take from this
    // property, and with no rail there would be nothing to undo it with.
    //
    // jsdom loads no stylesheet, so the 280px itself cannot be read back. What
    // is asserted is the class that carries it and the absence of anything
    // competing with it.
    expect(leftAside().style.width).toBe("");
    expect(rightAside().style.width).toBe("");
    expect(leftAside().className).toMatch(/\bsidebar\b/);
    expect(rightAside().className).toMatch(/\bsidebar\b/);
  });
});
