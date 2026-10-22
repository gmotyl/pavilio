import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Layout, FloatingActionProvider } from "../Layout";
import { TerminalDrawerProvider } from "../../terminal/useTerminalDrawer";
import { preferences } from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";
import { dragBy, installMatchMedia } from "../../../test-utils";

vi.mock("../LeftSidebar", () => ({ __esModule: true, default: () => <div /> }));
vi.mock("../RightSidebar", () => ({ __esModule: true, default: () => <div /> }));
vi.mock("../Breadcrumbs", () => ({ Breadcrumbs: () => <div /> }));

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

const rightToggle = () => screen.getByTestId("sidebar-toggle-right");

/**
 * Wiring only. The rail itself — separator semantics, drag, clamp, the hidden
 * rail on a phone, the in-flight flag — is owned by `useResizablePane.test.tsx`
 * and `PaneResizer.test.tsx`. What only the shell can get wrong is which edge,
 * which key and which bounds each side gets, the toggle that rides the seam,
 * and what it does with the width and the transition around a drag, a
 * collapse and a phone.
 */
describe("resizing the shell's sidebars", () => {
  beforeEach(() => {
    // jsdom implements neither of these
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("each sidebar drags from its own inner edge, within its own bounds, into its own key", () => {
    const viewport = installMatchMedia();
    setup();

    // The INNER edge, and the two sides are mirror images: the left sidebar's
    // seam with <main> is on its right, the right sidebar's on its left. Both
    // carrying "right" would still render two rails and still drag — it would
    // just grow the right sidebar backwards.
    expect(leftRail()).toHaveAttribute("data-edge", "right");
    expect(rightRail()).toHaveAttribute("data-edge", "left");
    // The rail is absolutely positioned and `.sidebar` is not positioned on
    // desktop, so without `relative` it would resolve against
    // `.layout-container` and sit in the middle of the page. And it lives
    // outside the sidebar's scrolling body, so it does not scroll away.
    for (const [aside, rail] of [
      [leftAside(), leftRail()],
      [rightAside(), rightRail()],
    ]) {
      expect(aside.className).toMatch(/\brelative\b/);
      expect(aside.contains(rail)).toBe(true);
    }
    // The declared defaults, in pixels: a `var()` here would be a width the
    // hook cannot start a drag from.
    expect(leftAside().style.width).toBe("240px");
    expect(rightAside().style.width).toBe("264px");

    // Two declarations, not one: dragging the left must not reach the right.
    dragBy(leftRail(), 40);
    expect(leftAside().style.width).toBe("280px");
    expect(readPreference(preferences.leftSidebarWidth)).toBe(280);
    expect(readPreference(preferences.rightSidebarWidth)).toBe(264);

    // Leftward grows the right sidebar — its inner edge faces the other way.
    // The toggle is viewport-anchored, so its offset has to follow the LIVE
    // width or it floats over the file tree.
    dragBy(rightRail(), -40);
    expect(rightAside().style.width).toBe("304px");
    expect(readPreference(preferences.rightSidebarWidth)).toBe(304);
    expect(readPreference(preferences.leftSidebarWidth)).toBe(280);
    expect(rightToggle().style.right).toBe("292px");

    // LEFT_BOUNDS and RIGHT_BOUNDS: nothing else pins them. The right sidebar
    // holds indenting file trees, so a higher floor and a wider ceiling.
    dragBy(leftRail(), 600);
    expect(readPreference(preferences.leftSidebarWidth)).toBe(400);
    dragBy(leftRail(), -600);
    expect(readPreference(preferences.leftSidebarWidth)).toBe(180);
    dragBy(rightRail(), -600);
    expect(readPreference(preferences.rightSidebarWidth)).toBe(440);
    expect(rightToggle().style.right).toBe("428px");
    dragBy(rightRail(), 600);
    expect(readPreference(preferences.rightSidebarWidth)).toBe(200);
    expect(rightToggle().style.right).toBe("188px");

    // On a phone both sidebars are fixed overlays that `index.css` pins at
    // `width: 280px !important` and slides on a transform, so the honest
    // width to write is none: a px width would be a desktop habit with no
    // rail to undo it. jsdom loads no stylesheet, so the class carrying the
    // 280px is what can be read back.
    viewport.setMobile(true);
    for (const aside of [leftAside(), rightAside()]) {
      expect(aside.style.width).toBe("");
      expect(aside.className).toMatch(/\bsidebar\b/);
    }
  });

  it("a drag suppresses the stylesheet's transition only while it is in flight", () => {
    // `.sidebar` carries `transition: width 250ms` for the COLLAPSE and
    // `.sidebar-toggle` carries `transition: all 150ms`, which covers `right`.
    // Left alone, every pointermove eases over that and restarts next frame:
    // the aside, the rail and the toggle trail the pointer and overshoot the
    // release. It has to be inline: `index.css` declares no `@layer`, so its
    // unlayered rules beat a Tailwind `transition-none` in `@layer utilities`.
    installMatchMedia();
    setup({ leftExpanded: false });

    // A collapsed sidebar has no inner edge to grab — a rail on a zero-width
    // box would hover over <main> — and keeps the transition the collapse
    // animates with.
    expect(screen.queryByTestId("pane-resize-sidebar-left")).toBeNull();
    expect(leftAside().style.width).toBe("0px");
    expect(leftAside().style.transition).toBe("");
    expect(leftAside().className).toMatch(/\bsidebar-collapsed\b/);

    expect(rightAside().style.transition).toBe("");
    expect(rightToggle().style.transition).toBe("");

    dragTo(rightRail(), -40);
    expect(rightAside().style.transition).toBe("none");
    expect(rightToggle().style.transition).toBe("none");
    // Only the pane being dragged.
    expect(leftAside().style.transition).toBe("");

    fireEvent.pointerUp(rightRail(), { pointerId: 1, clientX: 460 });
    // The pointer is up, so the stylesheet is in charge again.
    expect(rightAside().style.transition).toBe("");
    expect(rightToggle().style.transition).toBe("");
    expect(rightAside().style.width).toBe("304px");
    expect(rightToggle().style.right).toBe("292px");

    // And the left sidebar, once expanded, suppresses its own the same way.
    act(() => {
      writePreference(preferences.leftSidebarExpanded, true);
    });
    dragTo(leftRail(), 40);
    expect(leftAside().style.transition).toBe("none");
    expect(rightAside().style.transition).toBe("");
    fireEvent.pointerUp(leftRail(), { pointerId: 1, clientX: 540 });
    expect(leftAside().style.transition).toBe("");
    expect(leftAside().style.width).toBe("280px");
  });
});
