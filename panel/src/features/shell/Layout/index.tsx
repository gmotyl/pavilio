import { useContext, type ReactNode } from "react";
import { PanelLeft, PanelRight } from "lucide-react";
import { Breadcrumbs } from "../Breadcrumbs";
import LeftSidebar from "../LeftSidebar";
import RightSidebar from "../RightSidebar";
import { useSidebarState } from "../useSidebarState";
import { useEdgeSwipe } from "../useEdgeSwipe";
import {
  FloatingActionContext,
  FloatingActionProvider,
} from "./FloatingActionProvider";

function FloatingOverlay() {
  const { action } = useContext(FloatingActionContext);

  if (!action) return null;

  return (
    <div className="absolute bottom-4 right-4 z-40 pointer-events-none">
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
          onClick={left.toggle}
          className={`sidebar-toggle ${!left.expanded ? "visible" : ""}`}
          style={{ left: left.expanded ? 228 : 8 }}
          title={left.expanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          <PanelLeft size={14} />
        </button>
      </div>

      <aside
        className={`sidebar sidebar-left flex-shrink-0 ${!left.expanded ? "sidebar-collapsed" : ""}`}
        style={{
          width: left.expanded ? "var(--sidebar-width)" : "0",
          borderRight: left.expanded
            ? "1px solid var(--border-subtle)"
            : "none",
          background: "var(--bg-surface)",
        }}
      >
        <LeftSidebar />
      </aside>

      <main className="flex-1 min-w-0 relative">
        <div className="overflow-auto h-full">
          <Breadcrumbs />
          {children}
        </div>
        <FloatingOverlay />
      </main>

      <div className="hidden md:block">
        <button
          type="button"
          onClick={right.toggle}
          className={`sidebar-toggle ${!right.expanded ? "visible" : ""}`}
          style={{ right: right.expanded ? 252 : 8 }}
          title={right.expanded ? "Collapse file tree" : "Expand file tree"}
        >
          <PanelRight size={14} />
        </button>
      </div>

      <aside
        className={`sidebar sidebar-right flex-shrink-0 ${!right.expanded ? "sidebar-collapsed" : ""}`}
        style={{
          width: right.expanded ? "264px" : "0",
          borderLeft: right.expanded
            ? "1px solid var(--border-subtle)"
            : "none",
          background: "var(--bg-surface)",
        }}
      >
        <RightSidebar />
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
