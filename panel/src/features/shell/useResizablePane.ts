import { useCallback, useEffect, useRef, useState } from "react";
import { MOBILE_QUERY } from "../../lib/breakpoints";
import { usePreference } from "../../preferences/usePreference";
import type { PreferenceDef } from "../../preferences/types";

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
  /**
   * True while the pointer is proposing a width — from the first move of a
   * gesture until it ends, however it ends.
   *
   * A pane with a CSS `transition` on `width` needs this: the transition is
   * there for the collapse, but it applies to every width change, so each
   * pointermove would ease over its duration and restart the next frame. The
   * pane would trail the pointer and overshoot the release. The pane spends
   * this by suppressing its own transition inline for the length of the drag.
   */
  isDragging: boolean;
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
   * written once, at the end.
   *
   * Not to spare the network: `queuePatch` already coalesces on a
   * `PREFERENCE_PATCH_DEBOUNCE_MS` debounce, so sixty writes a second would
   * still leave as one PATCH. What it spares is the `notify(key)` every write
   * broadcasts — that wakes EVERY hook mounted on this key, and re-rendering
   * all of them on each pointer-move is what makes a drag stutter. The draft
   * keeps the gesture local to the pane being dragged.
   */
  const [draft, setDraft] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(matchesMobile);
  const drag = useRef<Drag | null>(null);
  // The same value as `draft`, readable synchronously: the pointerup that ends
  // a drag needs the last move's width before React has re-rendered.
  const draftRef = useRef<number | null>(null);

  // The only defence against an out-of-range STORED value — and this one is
  // portable, so the number may have been written on another machine whose
  // build drew these bounds somewhere else entirely.
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
   * Disarm, and persist what the drag reached.
   *
   * Every end arrives twice in a real browser: pointerup releases the capture,
   * which then fires lostPointerCapture behind it. What stops the second
   * arrival writing a second time is `final !== null` below — the first end
   * emptied `draftRef`, so the second finds nothing to persist. The
   * `!drag.current` guard is belt and braces over that: it turns the second
   * arrival back at the door rather than letting it fall through a body that
   * would do nothing anyway. Removing it changes no behavior this hook has,
   * which is why no test can pin it.
   */
  const endDrag = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    const final = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    // A press with no move asked for nothing.
    //
    // The only clamp on the WRITE, and the only one evaluated against the
    // bounds in force at release: `draftRef` was clamped during the move, and
    // `bounds` is a parameter that may have narrowed since — which is why it
    // is in this callback's dependencies.
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
      // What makes the DRAFT idempotent past a bound, and so what lets
      // `useState` bail out: every further move proposes the same clamped
      // number rather than a fresh one that would re-render the pane to show
      // the width it already shows.
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
    // A draft IS a drag in flight: it is set on every move and emptied by
    // `endDrag`, whichever of the three ends arrives first.
    isDragging: draft !== null,
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
