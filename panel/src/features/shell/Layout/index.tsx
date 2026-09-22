import { useContext, useRef, type ReactNode } from "react";
import { PanelRight } from "lucide-react";
import { Breadcrumbs } from "../Breadcrumbs";
import LeftSidebar from "../LeftSidebar";
import SidebarHamburger from "../SidebarHamburger";
import RightSidebar from "../RightSidebar";
import { useSidebarState } from "../useSidebarState";
import { useEdgeSwipe } from "../useEdgeSwipe";
import PaneResizer from "../PaneResizer";
import useResizablePane, { type PaneBounds } from "../useResizablePane";
import { preferences } from "../../../preferences/declarations";
import {
  FloatingActionContext,
  FloatingActionProvider,
} from "./FloatingActionProvider";
import { ScrollContainerContext } from "./ScrollContainer";
import { LAYOUT_ORDER } from "./order";
import TerminalDrawer from "../../terminal/TerminalDrawer";
import {
  useTerminalDrawer,
  type DrawerSide,
} from "../../terminal/useTerminalDrawer";

/**
 * How far each sidebar may be dragged, chosen per side rather than shared.
 *
 * The left is a navigation column: below 180 the project rows turn into a
 * stack of ellipses and `GitSummary`'s branch row wraps, and past 400 it
 * starts taking space from the thing it navigates to. The right holds file
 * TREES, which indent, so it needs a higher floor to keep a nested filename
 * readable and earns a wider ceiling — a deep path is the reason you widen it.
 * `step` is the arrow-key increment on both.
 */
const LEFT_BOUNDS: PaneBounds = { min: 180, max: 400, step: 16 };
const RIGHT_BOUNDS: PaneBounds = { min: 200, max: 440, step: 16 };

/**
 * Where the RIGHT toggle sits when its sidebar is collapsed — the only toggle
 * offset left. The left side answers this with `<SidebarHamburger>`, which is
 * placed by `index.css` against the viewport and has no offset to state.
 */
const TOGGLE_BASE_COLLAPSED = 8;

/**
 * How far INSIDE an expanded sidebar's inner edge its toggle sits, so the
 * button straddles the seam rather than floating over the pane.
 *
 * Applied against the sidebar's LIVE width, not frozen into a constant: the
 * right sidebar used to be a fixed 264px and this offset was written down as
 * the 252 that produced. Its width is the user's now (200–440), and a frozen
 * 252 drifts off the seam by exactly `width - 264` — up to 176px, far enough
 * to leave the button floating over the file tree.
 */
const TOGGLE_SEAM_INSET = 12;

/**
 * What a sidebar's `width` style should be, which is not always a number.
 * Collapsed it is `0`, and on mobile it is nothing at all — see the aside
 * below for why.
 */
function sidebarWidth(
  pane: { isMobile: boolean; width: number },
  expanded: boolean,
): string | undefined {
  if (pane.isMobile) return undefined;
  return expanded ? `${pane.width}px` : "0";
}

function FloatingOverlay() {
  const { action } = useContext(FloatingActionContext);

  if (!action) return null;

  return (
    <div className="absolute bottom-4 right-4 z-50 pointer-events-none">
      <div className="pointer-events-auto">{action}</div>
    </div>
  );
}

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const left = useSidebarState("leftSidebar");
  const right = useSidebarState("rightSidebar");
  const leftPane = useResizablePane(preferences.leftSidebarWidth, LEFT_BOUNDS);
  const rightPane = useResizablePane(preferences.rightSidebarWidth, RIGHT_BOUNDS);
  const scrollRef = useRef<HTMLDivElement>(null);
  const drawer = useTerminalDrawer();

  /**
   * The right toggle is viewport-anchored, but a docked drawer sits between the
   * sidebar and <main> — without this it floats over the drawer's header and
   * resize edge, covering its ✕. Push it outward by the drawer's width when
   * the drawer is actually docked on that side.
   *
   * One side only now. The left equivalent went with the toggle it corrected:
   * see the hamburger's own note, and the right toggle's below, for why the two
   * sides no longer answer this the same way.
   */
  const drawerOffset = (dockedOn: DrawerSide) =>
    drawer.visible && drawer.side === dockedOn ? drawer.width : 0;

  useEdgeSwipe({
    onSwipeRightFromLeftEdge: () => left.setExpanded(true),
    onSwipeLeftFromRightEdge: () => right.setExpanded(true),
    onSwipeLeftAnywhere: () => {
      if (left.expanded) left.setExpanded(false);
    },
    onSwipeRightAnywhere: () => {
      if (right.expanded) right.setExpanded(false);
    },
  });

  return (
    <div
      className="layout-container flex h-screen overflow-hidden relative"
      style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
    >
      {/*
        No `hidden md:block` wrapper, unlike the right toggle below: the
        hamburger is the only discoverable way to open the left sidebar on a
        phone, where the alternative is an edge swipe nobody finds. Nor does it
        take any offset — it is placed against the viewport corner in
        `index.css`, and `SidebarHamburger` says at length why.
      */}
      <SidebarHamburger expanded={left.expanded} onToggle={left.toggle} />

      {/*
        `relative` is what gives the rail below a containing block. `.sidebar`
        sets no `position` on desktop, so an absolute child would otherwise
        resolve against `.layout-container` and land in the middle of the page.
        It is safe on mobile too: the `@media (max-width: 767px)` block in
        `index.css` comes after Tailwind's utilities and wins with `fixed`.

        The width is an inline pixel value from the hook; the default it starts
        at is `shell.leftSidebar.width`'s declared 240 and lives only there.

        `transition` is inline rather than a `transition-none` class on purpose.
        `index.css` declares no `@layer`, so its `.sidebar` rule is UNLAYERED
        while Tailwind v4's utilities sit in `@layer utilities` — unlayered
        author rules beat layered ones outright, so the utility would lose to
        the very rule it is meant to cancel.
      */}
      <aside
        data-testid="layout-sidebar-left"
        data-panel-region="sidebar-left"
        className={`sidebar sidebar-left flex-shrink-0 relative ${!left.expanded ? "sidebar-collapsed" : ""}`}
        style={{
          order: LAYOUT_ORDER.sidebarLeft,
          // No width at all on a phone: there the sidebar is a fixed overlay
          // that `index.css` pins at `width: 280px !important` and slides on a
          // transform, so a pixel width from the hook would be a desktop habit
          // stamped onto a box that does not use it — and with no rail on
          // mobile, nothing to undo it with.
          width: sidebarWidth(leftPane, left.expanded),
          // `.sidebar` eases `width` over 250ms for the COLLAPSE, and that is
          // this same node. During a drag the ease restarts every pointermove,
          // so the aside lags the rail being held; outside one it is the
          // stylesheet's job again and collapsing still animates.
          transition: leftPane.isDragging ? "none" : undefined,
          borderRight: left.expanded
            ? "1px solid var(--border-subtle)"
            : "none",
          background: "var(--bg-surface)",
        }}
      >
        <LeftSidebar />
        {/* The inner edge: the seam with <main>. Outside `LeftSidebar`'s own
            scrolling body, so it does not scroll away with the project list.
            Collapsed there is no edge to grab, and `.sidebar-collapsed` is
            `pointer-events: none` besides — so no rail is rendered at all. */}
        {left.expanded && (
          <PaneResizer
            name="sidebar-left"
            edge="right"
            label="Resize the sidebar"
            {...leftPane.handleProps}
          />
        )}
      </aside>

      <main
        data-testid="layout-main"
        className="flex-1 min-w-0 relative"
        style={{ order: LAYOUT_ORDER.main }}
      >
        <ScrollContainerContext.Provider value={scrollRef as React.RefObject<HTMLElement>}>
          <div ref={scrollRef} className="overflow-auto h-full isolate">
            <Breadcrumbs />
            {children}
          </div>
        </ScrollContainerContext.Provider>
        <FloatingOverlay />
      </main>

      <TerminalDrawer />

      {/*
        The right side keeps a seam-tracking toggle while the left got a corner
        hamburger, and the asymmetry is deliberate rather than unfinished work.

        The left toggle's OFFSET was the thing that broke: it was frozen at the
        sidebar's old fixed width, so a resizable sidebar left it stranded. This
        one derives from the live width instead, which is the fix rather than
        the bug — and the corner it would otherwise move to is occupied. A
        left-docked drawer keeps its ✕ at the right end of its header and its
        resize rail on its right edge, so a control in the LEFT corner overlaps
        nothing; in the right corner it would land on both. Hence the offset
        below, which the left no longer needs.
      */}
      <div className="hidden md:block">
        <button
          type="button"
          data-testid="sidebar-toggle-right"
          onClick={right.toggle}
          className={`sidebar-toggle ${!right.expanded ? "visible" : ""}`}
          style={{
            right:
              (right.expanded
                ? rightPane.width - TOGGLE_SEAM_INSET
                : TOGGLE_BASE_COLLAPSED) + drawerOffset("right"),
            // `.sidebar-toggle` eases `all` over 150ms — the hover fade, and
            // the slide across when the sidebar collapses. `all` covers
            // `right` too, which was harmless while that offset was a
            // constant and nothing ever animated. It tracks the live width
            // now, so a drag would ease the button after the seam, restart
            // the ease every pointermove and keep travelling 150ms past the
            // release. Same remedy as the aside below, and inline for the
            // same reason: `.sidebar-toggle` is an unlayered author rule and
            // beats a `transition-none` utility.
            //
            // The hamburger needs no such guard: nothing about its position
            // is computed, so there is nothing for a transition to chase.
            transition: rightPane.isDragging ? "none" : undefined,
          }}
          title={right.expanded ? "Collapse file tree" : "Expand file tree"}
        >
          <PanelRight size={14} />
        </button>
      </div>

      <aside
        data-testid="layout-sidebar-right"
        data-panel-region="sidebar-right"
        className={`sidebar sidebar-right flex-shrink-0 relative ${!right.expanded ? "sidebar-collapsed" : ""}`}
        style={{
          order: LAYOUT_ORDER.sidebarRight,
          width: sidebarWidth(rightPane, right.expanded),
          // Same reason as the left aside above.
          transition: rightPane.isDragging ? "none" : undefined,
          borderLeft: right.expanded
            ? "1px solid var(--border-subtle)"
            : "none",
          background: "var(--bg-surface)",
        }}
      >
        <RightSidebar />
        {/* Mirror image: this sidebar's seam with <main> is on its LEFT, so the
            same gesture outward from the content is the opposite drag. */}
        {right.expanded && (
          <PaneResizer
            name="sidebar-right"
            edge="left"
            label="Resize the file tree"
            {...rightPane.handleProps}
          />
        )}
      </aside>

      {/* Mobile: tap-away backdrop closes any open drawer */}
      <div
        className={`sidebar-backdrop md:hidden${left.expanded || right.expanded ? " visible" : ""}`}
        onClick={() => {
          if (left.expanded) left.setExpanded(false);
          if (right.expanded) right.setExpanded(false);
        }}
        aria-hidden="true"
      />
    </div>
  );
}

export { FloatingActionProvider };
export { useFloatingAction } from "./useFloatingAction";
export { useScrollContainer } from "./ScrollContainer";
