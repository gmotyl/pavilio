import { useCallback, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { matchProjectFromPath } from "../projects/matchProjectFromPath";
import ProjectTerminalsSurface from "./ProjectTerminalsSurface";
import { LAYOUT_ORDER } from "../shell/Layout/order";
import { useSidebarState } from "../shell/useSidebarState";
import { useTerminalDrawer, DRAWER_MIN_WIDTH } from "./useTerminalDrawer";

const RESIZE_STEP = 16;
/** Pointer travel below this is a click, not a side drag. */
const SIDE_DRAG_GUARD = 6;

/** The pending dock side plus the sidebar offset measured when it was decided. */
type DropTarget = { side: "left" | "right"; offset: number };

/**
 * A docked drawer lands inside the sidebars, not against the viewport edge, so
 * the drop-zone hint has to start where the sidebar on that side ends. Measured
 * rather than hard-coded, so it tracks the sidebar's live width — the one the
 * user dragged it to — as well as the collapsed state.
 * Called from the pointer handler, never during render: layout reads belong in
 * events. 0 when the sidebar is absent (e.g. the drawer rendered without Layout).
 */
function sidebarWidth(side: "left" | "right") {
  const el = document.querySelector(`[data-panel-region="sidebar-${side}"]`);
  return el?.getBoundingClientRect().width ?? 0;
}

export default function TerminalDrawer() {
  const { visible, width, maxWidth, side, setOpen, setWidth, setSide } =
    useTerminalDrawer();
  const leftSidebar = useSidebarState("leftSidebar");
  const location = useLocation();
  const match = matchProjectFromPath(location.pathname);
  const asideRef = useRef<HTMLElement>(null);
  const dragging = useRef(false);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragOriginX = useRef<number | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore — jsdom and some browsers reject stale pointer ids
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      // The handle sits on the drawer's inner edge, so dragging toward
      // <main> always grows it — the formula flips with the dock side.
      const next =
        side === "right"
          ? window.innerWidth - e.clientX
          : e.clientX - (asideRef.current?.getBoundingClientRect().left ?? 0);
      setWidth(Math.min(maxWidth, Math.max(DRAWER_MIN_WIDTH, next)));
    },
    [maxWidth, setWidth, side],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  /**
   * pointerup may never arrive (pointercancel, or the browser steals capture).
   * Disarm, otherwise later button-less moves over the handle keep resizing.
   */
  const onResizeDragAbort = useCallback(() => {
    dragging.current = false;
  }, []);

  const onHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragOriginX.current = e.clientX;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  const onHeaderPointerMove = useCallback((e: React.PointerEvent) => {
    const origin = dragOriginX.current;
    if (origin === null) return;
    // Back inside the guard is a click again, so drop any pending side —
    // an out-and-back drag must not commit the far side it passed through.
    if (Math.abs(e.clientX - origin) < SIDE_DRAG_GUARD) {
      setDropTarget(null);
      return;
    }
    const next = e.clientX < window.innerWidth / 2 ? "left" : "right";
    setDropTarget({ side: next, offset: sidebarWidth(next) });
  }, []);

  const onHeaderPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const wasDragging = dragOriginX.current !== null;
      dragOriginX.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      if (wasDragging && dropTarget) setSide(dropTarget.side);
      setDropTarget(null);
    },
    [dropTarget, setSide],
  );

  /**
   * pointerup may never arrive (pointercancel, or the browser steals capture).
   * Disarm without committing, otherwise the next plain header click would
   * flip the side using a stale dropSide.
   */
  const onHeaderDragAbort = useCallback(() => {
    dragOriginX.current = null;
    setDropTarget(null);
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const growKey = side === "right" ? "ArrowLeft" : "ArrowRight";
      const shrinkKey = side === "right" ? "ArrowRight" : "ArrowLeft";
      if (e.key === growKey) {
        e.preventDefault();
        setWidth(width + RESIZE_STEP);
      } else if (e.key === shrinkKey) {
        e.preventDefault();
        setWidth(width - RESIZE_STEP);
      }
    },
    [setWidth, side, width],
  );

  if (!visible || !match) return null;

  const dockedRight = side === "right";

  /**
   * Whether this header has to keep the hamburger's corner clear.
   *
   * `.sidebar-hamburger` is fixed at the VIEWPORT corner and stays there in
   * every state — that constancy is the whole point of the control, and moving
   * it to dodge a drawer would reopen the width regression it was built to
   * end. So the drawer yields instead, the same way the sidebar's first header
   * row does with `<HamburgerSlot>`: it reserves the box rather than putting
   * its own header underneath it.
   *
   * Only when the reservation is actually needed, and the question that
   * decides it is "does this drawer's left edge clear the button?". Docked
   * RIGHT the drawer is the length of the viewport away. Docked LEFT its left
   * edge is whatever the sidebar takes out of the flow before it, which is the
   * sidebar's width only while the sidebar is expanded — and then the width's
   * floor is 180 against the button's right edge at 40, so the corner is clear
   * at every width the user can drag to.
   *
   * `expanded` is the whole answer here because this code only ever runs on a
   * desktop: the drawer stands down entirely on a narrow viewport (`visible`
   * carries `!narrowViewport`, and the early return above fires long before
   * this line), so the phone case — where `.sidebar` is a fixed overlay that
   * displaces nothing — cannot reach it. Pinned by "stands down entirely on a
   * phone" in the drawer suite; should the drawer ever render on a phone
   * again, that test fails and this line needs the displacement question back.
   */
  const drawerClearsHamburger = leftSidebar.expanded;
  const reservesHamburgerCorner = !dockedRight && !drawerClearsHamburger;

  return (
    <aside
      ref={asideRef}
      data-testid="terminal-drawer"
      data-side={side}
      className="flex-shrink-0 relative flex flex-col h-full"
      style={{
        width: `${width}px`,
        order: dockedRight ? LAYOUT_ORDER.drawerRight : LAYOUT_ORDER.drawerLeft,
        borderLeft: dockedRight ? "1px solid var(--border-subtle)" : undefined,
        borderRight: dockedRight ? undefined : "1px solid var(--border-subtle)",
        background: "var(--bg-surface)",
      }}
    >
      <div
        data-testid="terminal-drawer-resize"
        data-edge={dockedRight ? "left" : "right"}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize terminal drawer"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onResizeDragAbort}
        onLostPointerCapture={onResizeDragAbort}
        onKeyDown={onKeyDown}
        className={`group absolute ${dockedRight ? "left-0" : "right-0"} top-0 h-full w-2 cursor-col-resize z-10 focus-visible:outline-none`}
        title="Drag to resize (or focus and use arrow keys)"
      >
        <span
          aria-hidden
          className={`absolute ${dockedRight ? "left-0" : "right-0"} top-0 h-full w-px transition-colors group-hover:bg-[var(--border-strong)] group-focus-visible:bg-[var(--accent)]`}
        />
      </div>
      {/* The header ROW: the reserved corner plus the header itself. The row
          carries the rule under it so the divider still spans the drawer's
          full width, while the header box — the title and the ✕ — begins after
          the reservation rather than under the button.

          The DRAG lives out here on the row, not on the header box, and that
          is what keeps the reserved corner alive. The reservation takes 40×28
          out of a strip the user could previously grab, and the fixed button
          only occupies 24×24 of it; with the handlers one level in, the
          leftover 16px column and the 4px band above the button answered to
          nothing at all. `pointer-events: none` on the gap would not have
          helped — the hit simply fell through to a row that had no handlers
          either. Up here the gap is pure visual reservation, the button still
          intercepts its own box from z-45, and every pixel of the row that is
          not the button drags the drawer. */}
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderDragAbort}
        onLostPointerCapture={onHeaderDragAbort}
        className={`flex items-stretch flex-shrink-0 select-none touch-none ${dropTarget ? "cursor-grabbing" : "cursor-grab"}`}
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
        title="Drag to move the drawer to the other side"
      >
        {reservesHamburgerCorner && (
          <span
            aria-hidden
            data-testid="terminal-drawer-hamburger-gap"
            className="drawer-hamburger-gap"
          />
        )}
        <div
          data-testid="terminal-drawer-header"
          className="flex-1 min-w-0 flex items-center justify-between px-2 h-7"
        >
          <span
            className="text-[11px] font-semibold uppercase tracking-wider truncate"
            style={{ color: "var(--text-tertiary)" }}
          >
            {match.name} · terminals
          </span>
          <button
            type="button"
            data-testid="terminal-drawer-close"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setOpen(false)}
            className="w-5 h-5 flex items-center justify-center rounded transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
            style={{ color: "var(--text-tertiary)" }}
            title="Close terminal drawer"
            aria-label="Close terminal drawer"
          >
            <X size={13} />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ProjectTerminalsSurface projectName={match.name} active={false} fill />
      </div>
      {dropTarget && (
        <div
          data-testid="terminal-drawer-dropzone"
          data-side={dropTarget.side}
          aria-hidden
          className="fixed top-0 bottom-0 z-40 pointer-events-none"
          style={{
            left:
              dropTarget.side === "left" ? `${dropTarget.offset}px` : undefined,
            right:
              dropTarget.side === "right" ? `${dropTarget.offset}px` : undefined,
            width: `${width}px`,
            background: "var(--accent)",
            opacity: 0.12,
          }}
        />
      )}
    </aside>
  );
}
