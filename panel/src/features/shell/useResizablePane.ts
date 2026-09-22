import { useCallback, useEffect, useRef, useState } from "react";
import { usePreference } from "../../preferences/usePreference";
import type { PreferenceDef } from "../../preferences/types";

/**
 * Same breakpoint as `useFileListSidebar` and TerminalLayoutGrid. It is spelt
 * again here rather than imported from `features/projects`: the shell primitive
 * sits UNDER the features that resize their panes, and importing upward would
 * close a cycle the moment one of them uses this hook. Change one, change all
 * three.
 */
export const MOBILE_QUERY = "(max-width: 767px)";

/** The travel a pane is allowed, and how far one arrow key moves it. */
export interface PaneBounds {
  min: number;
  max: number;
  step: number;
}

/**
 * Everything `<PaneResizer>` needs to behave. The hook owns it so that a pane
 * only spreads it onto the rail: the drag state, the bounds and the mobile
 * verdict all have one home.
 */
export interface PaneResizerProps {
  /** The rail is a pointer gesture, so there is none on a touch viewport. */
  isMobile: boolean;
  "aria-valuenow": number;
  "aria-valuemin": number;
  "aria-valuemax": number;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
  onLostPointerCapture: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export interface ResizablePane {
  /** Always inside `bounds`, whatever the stored value says. */
  width: number;
  isMobile: boolean;
  handleProps: PaneResizerProps;
}

function matchesMobile(): boolean {
  return window.matchMedia?.(MOBILE_QUERY).matches ?? false;
}

/** Whole pixels: a fractional width is pointer noise, and it would be persisted. */
function clamp(width: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, width)));
}

/**
 * Which way the pointer has to travel to GROW the pane, read off the rail's own
 * `data-edge`. A rail on the pane's right edge grows it rightward; one on the
 * left edge grows it leftward. The edge is a property of the rail, not of the
 * hook's arguments, so the element carrying it is the honest place to ask.
 */
function growDirection(el: EventTarget | null): 1 | -1 {
  return (el as HTMLElement | null)?.dataset?.edge === "left" ? -1 : 1;
}

interface Drag {
  originX: number;
  startWidth: number;
  direction: 1 | -1;
}

export function useResizablePane(
  def: PreferenceDef<number>,
  bounds: PaneBounds,
  scopeArg?: string,
): ResizablePane {
  const { min, max, step } = bounds;
  const [stored, setStored] = usePreference(def, scopeArg);
  /**
   * The width the pointer is currently proposing, or null when no drag is in
   * flight. The pane follows the pointer from here so that the preference is
   * written once at the end — a PATCH per pointer-move would beat on the
   * workspace file for a gesture with a single outcome.
   */
  const [draft, setDraft] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(matchesMobile);
  const drag = useRef<Drag | null>(null);
  // The same value as `draft`, readable synchronously: the pointerup that ends
  // a drag needs the last move's width before React has re-rendered.
  const draftRef = useRef<number | null>(null);

  const width = clamp(draft ?? stored, min, max);

  useEffect(() => {
    const mql = window.matchMedia?.(MOBILE_QUERY);
    if (!mql) return;
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange as (e: MediaQueryListEvent) => void);
    return () =>
      mql.removeEventListener("change", onChange as (e: MediaQueryListEvent) => void);
  }, []);

  /**
   * Disarm, and persist what the drag reached. Guarded on a live drag because
   * every end arrives twice in a real browser: pointerup releases the capture,
   * which then fires lostPointerCapture behind it.
   */
  const endDrag = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    const final = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    // A press with no move asked for nothing.
    if (final !== null) setStored(clamp(final, min, max));
  }, [max, min, setStored]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      // Deltas from where the press landed, never the raw clientX: the rail's
      // own offset is a layout read, and the pane it belongs to may sit behind
      // a sidebar, a drawer, or both.
      drag.current = {
        originX: e.clientX,
        startWidth: width,
        direction: growDirection(el),
      };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // ignore — jsdom and some browsers reject stale pointer ids
      }
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const active = drag.current;
      if (!active) return;
      const next = clamp(
        active.startWidth + (e.clientX - active.originX) * active.direction,
        min,
        max,
      );
      draftRef.current = next;
      setDraft(next);
    },
    [max, min],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      endDrag();
    },
    [endDrag],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const direction = growDirection(e.currentTarget);
      const delta =
        e.key === "ArrowRight" ? direction : e.key === "ArrowLeft" ? -direction : 0;
      if (delta === 0) return;
      e.preventDefault();
      setStored(clamp(width + delta * step, min, max));
    },
    [max, min, setStored, step, width],
  );

  return {
    width,
    isMobile,
    handleProps: {
      isMobile,
      "aria-valuenow": width,
      "aria-valuemin": min,
      "aria-valuemax": max,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: endDrag,
      onLostPointerCapture: endDrag,
      onKeyDown,
    },
  };
}

export default useResizablePane;
