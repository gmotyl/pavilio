import { useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { matchProjectFromPath } from "../projects/matchProjectFromPath";
import ProjectTerminalsSurface from "./ProjectTerminalsSurface";
import { useTerminalDrawer, DRAWER_MIN_WIDTH } from "./useTerminalDrawer";

export default function TerminalDrawer() {
  const { open, width, maxWidth, setOpen, setWidth } = useTerminalDrawer();
  const location = useLocation();
  const match = matchProjectFromPath(location.pathname);
  const dragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const next = window.innerWidth - e.clientX;
      setWidth(Math.min(maxWidth, Math.max(DRAWER_MIN_WIDTH, next)));
    },
    [maxWidth, setWidth],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Handle straddles the left (inner) edge: left grows, right shrinks.
      // setWidth clamps to [DRAWER_MIN_WIDTH, maxWidth].
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setWidth(width + 16);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setWidth(width - 16);
      }
    },
    [setWidth, width],
  );

  if (!open || !match || match.section === "iterm") return null;

  return (
    <aside
      data-testid="terminal-drawer"
      className="flex-shrink-0 relative flex flex-col h-full"
      style={{
        width: `${width}px`,
        borderLeft: "1px solid var(--border-subtle)",
        background: "var(--bg-surface)",
      }}
    >
      <div
        data-testid="terminal-drawer-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize terminal drawer"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
        className="group absolute left-0 top-0 h-full w-2 cursor-col-resize z-10 focus-visible:outline-none"
        title="Drag to resize (or focus and use arrow keys)"
      >
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-px transition-colors group-hover:bg-[var(--border-strong)] group-focus-visible:bg-[var(--accent)]"
        />
      </div>
      <div
        className="flex items-center justify-between px-2 h-7 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
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
    </aside>
  );
}
