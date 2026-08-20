import { createContext, useContext } from "react";

/**
 * Lets the open file's name (rendered inside the sidebar's `detail`, far from
 * `FileListSidebar` which owns the peek state) act as the hover-peek trigger.
 * `FileListSidebar` provides the handlers; the filename spreads them via
 * `usePeekTriggerProps`.
 */
export interface PeekTriggerValue {
  /** Open the hover-peek (no-op unless collapsed on desktop). */
  onEnter: () => void;
  /** Schedule the peek to close (cancelled by re-entering the overlay/trigger). */
  onLeave: () => void;
}

export const PeekTriggerContext = createContext<PeekTriggerValue | null>(null);

/**
 * Mouse handlers to spread onto the element that should open the file-list
 * peek on hover. Returns empty handlers when no sidebar is in scope, so the
 * filename component works standalone.
 */
export function usePeekTriggerProps(): {
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
} {
  const ctx = useContext(PeekTriggerContext);
  if (!ctx) return {};
  return { onMouseEnter: ctx.onEnter, onMouseLeave: ctx.onLeave };
}
