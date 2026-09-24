import { useCallback, useEffect, useRef, useState } from "react";
import { MOBILE_QUERY } from "../../lib/breakpoints";
import { usePreference } from "../../preferences/usePreference";
import type { PreferenceDef } from "../../preferences/types";
import type { PaneResizerProps } from "./useResizablePane";

/**
 * The height axis of `useResizablePane` — a sibling rather than a parameter on
 * it, because nothing about a drag is shared between the two once the axis is
 * fixed: the pointer coordinate, the growth sign, the arrow keys and the CSS
 * cursor all differ, and a hook that took the axis as an argument would branch
 * on it in every one of them.
 *
 * What IS shared is `PaneResizerProps`: the rail is the same control, so both
 * hooks hand `<PaneResizer>` the same bundle.
 */

/** The travel a row is allowed, and how far one arrow key moves it. */
export interface RowBounds {
  min: number;
  max: number;
  step: number;
}

export interface ResizableRow {
  /** Always inside `bounds`, whatever the stored value says. */
  height: number;
  /**
   * True on a touch viewport — where the row is laid out by the viewport and
   * the stored height is not applied at all. The row spends this; the hook
   * only reports it.
   */
  isMobile: boolean;
  /**
   * True while the pointer is proposing a height — from the first move of a
   * gesture until it ends, however it ends. A row with a CSS `transition` on
   * `height` suppresses it for the length of the drag, or every pointermove
   * would ease over its duration and the row would trail the pointer.
   */
  dragging: boolean;
  handleProps: PaneResizerProps;
}

function matchesMobile(): boolean {
  return window.matchMedia?.(MOBILE_QUERY).matches ?? false;
}

/** Whole pixels: a fractional height is pointer noise, and it would be persisted. */
function clamp(height: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, height)));
}

/**
 * Which way the pointer has to travel to GROW the row, read off the rail's own
 * `data-edge`. A rail on the row's top edge grows it UPWARD — and up the screen
 * is a falling clientY, hence -1. The edge is a property of the rail, not of
 * the hook's arguments, so the element carrying it is the honest place to ask.
 */
function growDirection(el: EventTarget | null): 1 | -1 {
  return (el as HTMLElement | null)?.dataset?.edge === "top" ? -1 : 1;
}

interface Drag {
  originY: number;
  startHeight: number;
  direction: 1 | -1;
}

export function useResizableRow(
  def: PreferenceDef<number>,
  bounds: RowBounds,
): ResizableRow {
  const { min, max, step } = bounds;
  const [stored, setStored] = usePreference(def);
  /**
   * The height the pointer is currently proposing, or null when no drag is in
   * flight. The row follows the pointer from here so that the preference is
   * written once, at the end — every write broadcasts a `notify(key)` that
   * wakes EVERY hook mounted on this key, and re-rendering all of them per
   * pointer-move is what makes a drag stutter.
   */
  const [draft, setDraft] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(matchesMobile);
  const drag = useRef<Drag | null>(null);
  // The same value as `draft`, readable synchronously: the pointerup that ends
  // a drag needs the last move's height before React has re-rendered.
  const draftRef = useRef<number | null>(null);

  // The only defence against an out-of-range STORED value — and this one may be
  // portable, so the number may have been written on another machine whose
  // build drew these bounds somewhere else entirely.
  const height = clamp(draft ?? stored, min, max);

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
   * emptied `draftRef`, so the second finds nothing to persist.
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
    // `bounds` is a parameter that may have narrowed since.
    if (final !== null) setStored(clamp(final, min, max));
  }, [max, min, setStored]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      // Deltas from where the press landed, never the raw clientY: the rail's
      // own offset is a layout read, and the row it belongs to sits below a
      // transcript whose height is exactly what this gesture is changing.
      drag.current = {
        originY: e.clientY,
        startHeight: height,
        direction: growDirection(el),
      };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // ignore — jsdom and some browsers reject stale pointer ids
      }
    },
    [height],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const active = drag.current;
      if (!active) return;
      // What makes the DRAFT idempotent past a bound, and so what lets
      // `useState` bail out: every further move proposes the same clamped
      // number rather than a fresh one that would re-render the row to show
      // the height it already shows.
      const next = clamp(
        active.startHeight + (e.clientY - active.originY) * active.direction,
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
      // ArrowDown follows the pointer's own sign, so a top-edge rail — where
      // down the screen shrinks the row — gets the inversion for free.
      const delta = e.key === "ArrowDown" ? direction : e.key === "ArrowUp" ? -direction : 0;
      if (delta === 0) return;
      e.preventDefault();
      setStored(clamp(height + delta * step, min, max));
    },
    [height, max, min, setStored, step],
  );

  return {
    height,
    isMobile,
    // A draft IS a drag in flight: it is set on every move and emptied by
    // `endDrag`, whichever of the three ends arrives first.
    dragging: draft !== null,
    handleProps: {
      isMobile,
      "aria-valuenow": height,
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

export default useResizableRow;
