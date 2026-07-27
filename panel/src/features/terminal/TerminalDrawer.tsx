import { useCallback, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { matchProjectFromPath } from "../projects/matchProjectFromPath";
import ProjectTerminalsSurface from "./ProjectTerminalsSurface";
import { useTerminalDrawer, DRAWER_MIN_WIDTH } from "./useTerminalDrawer";

/** Flex order slots in Layout: sidebars bracket main, drawer takes 2 or 4. */
const ORDER_LEFT = 2;
const ORDER_RIGHT = 4;
const RESIZE_STEP = 16;
/** Pointer travel below this is a click, not a side drag. */
const SIDE_DRAG_GUARD = 6;

export default function TerminalDrawer() {
  const { visible, width, maxWidth, side, setOpen, setWidth, setSide } =
    useTerminalDrawer();
  const location = useLocation();
  const match = matchProjectFromPath(location.pathname);
  const asideRef = useRef<HTMLElement>(null);
  const dragging = useRef(false);
  const [dropSide, setDropSide] = useState<"left" | "right" | null>(null);
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
    if (Math.abs(e.clientX - origin) < SIDE_DRAG_GUARD) return;
    setDropSide(e.clientX < window.innerWidth / 2 ? "left" : "right");
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
      if (wasDragging && dropSide) setSide(dropSide);
      setDropSide(null);
    },
    [dropSide, setSide],
  );

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

  return (
    <aside
      ref={asideRef}
      data-testid="terminal-drawer"
      data-side={side}
      className="flex-shrink-0 relative flex flex-col h-full"
      style={{
        width: `${width}px`,
        order: dockedRight ? ORDER_RIGHT : ORDER_LEFT,
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
        onKeyDown={onKeyDown}
        className={`group absolute ${dockedRight ? "left-0" : "right-0"} top-0 h-full w-2 cursor-col-resize z-10 focus-visible:outline-none`}
        title="Drag to resize (or focus and use arrow keys)"
      >
        <span
          aria-hidden
          className={`absolute ${dockedRight ? "left-0" : "right-0"} top-0 h-full w-px transition-colors group-hover:bg-[var(--border-strong)] group-focus-visible:bg-[var(--accent)]`}
        />
      </div>
      <div
        data-testid="terminal-drawer-header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        className={`flex items-center justify-between px-2 h-7 flex-shrink-0 select-none touch-none ${dropSide ? "cursor-grabbing" : "cursor-grab"}`}
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
        title="Drag to move the drawer to the other side"
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
      <div className="flex-1 min-h-0">
        <ProjectTerminalsSurface projectName={match.name} active={false} fill />
      </div>
      {dropSide && (
        <div
          data-testid="terminal-drawer-dropzone"
          data-side={dropSide}
          aria-hidden
          className="fixed top-0 bottom-0 z-40 pointer-events-none"
          style={{
            left: dropSide === "left" ? 0 : undefined,
            right: dropSide === "right" ? 0 : undefined,
            width: `${width}px`,
            background: "var(--accent)",
            opacity: 0.12,
          }}
        />
      )}
    </aside>
  );
}
