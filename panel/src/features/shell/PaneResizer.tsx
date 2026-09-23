import type { PaneResizerProps } from "./useResizablePane";

export interface PaneResizerHandleProps extends PaneResizerProps {
  /** Names the rail's test id — `pane-resize-<name>`. */
  name: string;
  /** Which edge of the pane the rail sits on, and so which way a drag grows it. */
  edge: "left" | "right";
  label?: string;
}

/**
 * The drag rail for a resizable pane — the same control as
 * `terminal-drawer-resize`, with its behavior supplied by `useResizablePane`.
 *
 * It renders nothing on mobile: a 8px rail is a pointer target, and on a phone
 * it would sit under the thumb that is trying to scroll the pane it borders.
 */
export default function PaneResizer({
  name,
  edge,
  label,
  isMobile,
  ...handle
}: PaneResizerHandleProps) {
  if (isMobile) return null;

  const onLeft = edge === "left";

  return (
    <div
      data-testid={`pane-resize-${name}`}
      data-edge={edge}
      role="separator"
      aria-orientation="vertical"
      aria-label={label ?? "Resize pane"}
      tabIndex={0}
      {...handle}
      className={`group absolute ${onLeft ? "left-0" : "right-0"} top-0 h-full w-2 cursor-col-resize z-10 focus-visible:outline-none`}
      title="Drag to resize (or focus and use arrow keys)"
    >
      <span
        aria-hidden
        className={`absolute ${onLeft ? "left-0" : "right-0"} top-0 h-full w-px transition-colors group-hover:bg-[var(--border-strong)] group-focus-visible:bg-[var(--accent)]`}
      />
    </div>
  );
}
