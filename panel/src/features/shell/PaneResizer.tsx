import type { PaneResizerProps } from "./useResizablePane";

export interface PaneResizerHandleProps extends PaneResizerProps {
  /** Names the rail's test id — `pane-resize-<name>`. */
  name: string;
  /**
   * Which edge of the pane the rail sits on, and so which way a drag grows it.
   * `left` and `right` are the width axis, driven by `useResizablePane`; `top`
   * is the height axis, driven by `useResizableRow`.
   */
  edge: "left" | "right" | "top";
  label?: string;
}

/**
 * The drag rail for a resizable pane — the same control as
 * `terminal-drawer-resize`, with its behavior supplied by `useResizablePane`
 * on the width axis or `useResizableRow` on the height axis.
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

  // A horizontal bar across the top of a row, rather than a column beside a
  // pane: the whole geometry turns on this one fact, down to the cursor.
  const onTop = edge === "top";
  const onLeft = edge === "left";

  // Where the hairline the rail draws sits inside its own 8px target.
  const side = onTop ? "top-0 left-0" : `${onLeft ? "left-0" : "right-0"} top-0`;

  return (
    <div
      data-testid={`pane-resize-${name}`}
      data-edge={edge}
      role="separator"
      aria-orientation={onTop ? "horizontal" : "vertical"}
      aria-label={label ?? "Resize pane"}
      tabIndex={0}
      {...handle}
      className={`group absolute ${side} ${onTop ? "w-full h-2 cursor-row-resize" : "h-full w-2 cursor-col-resize"} z-10 focus-visible:outline-none`}
      title="Drag to resize (or focus and use arrow keys)"
    >
      <span
        aria-hidden
        className={`absolute ${side} ${onTop ? "w-full h-px" : "h-full w-px"} transition-colors group-hover:bg-[var(--border-strong)] group-focus-visible:bg-[var(--accent)]`}
      />
    </div>
  );
}
