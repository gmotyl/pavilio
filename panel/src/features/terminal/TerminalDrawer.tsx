import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { matchProjectFromPath } from "../projects/matchProjectFromPath";
import ProjectTerminalsSurface from "./ProjectTerminalsSurface";
import {
  useTerminalDrawer,
  DRAWER_MIN_WIDTH,
  DRAWER_MAX_WIDTH,
} from "./useTerminalDrawer";

export default function TerminalDrawer() {
  const { open, width, setOpen, setWidth } = useTerminalDrawer();
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
      setWidth(Math.min(DRAWER_MAX_WIDTH, Math.max(DRAWER_MIN_WIDTH, next)));
    },
    [setWidth],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize z-10"
        style={{ background: "transparent" }}
        title="Drag to resize"
      />
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
          className="w-5 h-5 flex items-center justify-center rounded"
          style={{ color: "var(--text-tertiary)" }}
          title="Close terminal drawer (Esc)"
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
