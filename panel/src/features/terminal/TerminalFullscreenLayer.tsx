import { useLayoutEffect, type ReactNode } from "react";
import { holdFullscreenLayer } from "../shell/Layout/fullscreenLayer";

/** Same tier as a fullscreen mockup: above the chrome, below the modals. */
const LAYER_CLASS = "fixed inset-0 z-[90] flex flex-col";

/**
 * The fixed full-viewport host of a terminal fullscreen layer.
 *
 * Always mounted around what it may lift — a cell, or a surface's whole
 * terminal container — and never re-parents it. Closed it is `display:
 * contents`, so the child keeps its place in the grid or the flex column it
 * sits in; open it becomes the fixed layer, and the very same DOM fills the
 * viewport. That is the point: the cell's xterm holder is pooled, one per
 * session, and lives in whichever `TerminalView` mounted it last. Rendering the
 * cell a second time in a portal would move the holder out of the grid and
 * back again on close, refitting the PTY twice; restyling in place renders it
 * once and keeps every piece of cell state (speech row choice, answer pane,
 * scrollback) as it was.
 *
 * While open it holds the shell's fullscreen layer, so the routed content's
 * `isolate` is lifted and `z-[90]` competes with the sidebars and the drawer.
 * A layout effect, so the chrome never paints one frame over the layer.
 */
export function TerminalFullscreenLayer({
  open,
  kind,
  children,
}: {
  open: boolean;
  kind: "cell" | "terminal";
  children: ReactNode;
}) {
  useLayoutEffect(() => (open ? holdFullscreenLayer() : undefined), [open]);
  return (
    <div
      data-terminal-fullscreen={open ? kind : undefined}
      className={open ? LAYER_CLASS : "contents"}
      // `visibility` and `pointer-events` are reset because a cell lifted while
      // Max hides its wrapper would otherwise inherit both into the layer.
      style={
        open
          ? { background: "var(--bg-base)", visibility: "visible", pointerEvents: "auto" }
          : undefined
      }
    >
      {children}
    </div>
  );
}
