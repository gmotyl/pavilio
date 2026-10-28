import { useLayoutEffect, useState } from "react";

/**
 * Below this pane width a speech settings list stacks its cells in one column.
 * Measured on the component's own root, not the window: Settings and a
 * project's Overview open in split panes that are narrow long before the
 * window is.
 */
export const SPEECH_ROWS_NARROW_BELOW = 560;

/** The pane width, from a `ResizeObserver` on `ref`; `0` until something lays out. */
export function usePaneWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    // Guarded: not every environment the suite renders in has the constructor.
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
