import { useContext, useRef, type ReactNode } from "react";
import { PanelLeft, PanelRight } from "lucide-react";
import { Breadcrumbs } from "../Breadcrumbs";
import LeftSidebar from "../LeftSidebar";
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

/** Toggle offsets from the viewport edge, per sidebar state. */
const TOGGLE_BASE_LEFT_EXPANDED = 228;
const TOGGLE_BASE_RIGHT_EXPANDED = 252;
const TOGGLE_BASE_COLLAPSED = 8;

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
   * The toggles are viewport-anchored, but a docked drawer sits between the
   * sidebar and <main> — without this they float over the drawer's header and
   * resize edge, covering its ✕. Push them outward by the drawer's width on
   * whichever side it is actually visible on.
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
      <div className="hidden md:block">
        <button
          type="button"
          data-testid="sidebar-toggle-left"
          onClick={left.toggle}
          className={`sidebar-toggle ${!left.expanded ? "visible" : ""}`}
          style={{
            left:
              (left.expanded
                ? TOGGLE_BASE_LEFT_EXPANDED
                : TOGGLE_BASE_COLLAPSED) + drawerOffset("left"),
          }}
          title={left.expanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          <PanelLeft size={14} />
        </button>
      </div>

      {/*
        `relative` is what gives the rail below a containing block. `.sidebar`
        sets no `position` on desktop, so an absolute child would otherwise
        resolve against `.layout-container` and land in the middle of the page.
        It is safe on mobile too: the `@media (max-width: 767px)` block in
        `index.css` comes after Tailwind's utilities and wins with `fixed`.

        The width is an inline pixel value from the hook. `--sidebar-width` is
        no longer applied anywhere — it stays in `index.css` as the written-down
        default, which is `shell.leftSidebar.width`'s declared 240.
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

      <div className="hidden md:block">
        <button
          type="button"
          data-testid="sidebar-toggle-right"
          onClick={right.toggle}
          className={`sidebar-toggle ${!right.expanded ? "visible" : ""}`}
          style={{
            right:
              (right.expanded
                ? TOGGLE_BASE_RIGHT_EXPANDED
                : TOGGLE_BASE_COLLAPSED) + drawerOffset("right"),
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
