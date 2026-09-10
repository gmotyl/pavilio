// One grab strip per seam, laid over the grid's gutters, plus the pointer-driven
// drag that moves a boundary. See the design's §3.4 (handle geometry) and §4 (drag
// lifecycle).
//
// The component is a driver, not a model: all the geometry lives in `seamResize`,
// which is pure. What is owned here is the gesture — snapshot on press, a draft on
// every move, one commit on release, nothing at all on Escape or pointercancel.
//
// Two deliberate choices:
//   - the pointer is captured, so a drag survives the cursor leaving the 9px strip;
//   - the move/up listeners nonetheless sit on the window, so the drag also survives
//     the handle itself unmounting mid-drag (its key changes as the boundary moves).
// Neither measures the DOM: the caller injects the grid's content box.

import { useCallback, useEffect, useRef, useState } from "react";

import { resizeSeam, seamsOf, type Seam } from "./seamResize";
import { GRID, type TileLayout } from "./tileLayout";

/** The grid's `gap`, in px — mirrors TerminalLayoutGrid. */
const GUTTER = 4;

/** Grab strip on the short axis, in px: a 4px gutter alone is not hittable. */
const HANDLE = 9;

export interface TerminalSeamHandlesProps {
  layout: TileLayout;
  /** Called once, on release, with the final layout. */
  onResize: (layout: TileLayout) => void;
  /** Called on every pointermove with the draft, so the grid can render it live. */
  onDraft: (layout: TileLayout | null) => void;
  /** Grid content box, injected so the component never measures the DOM itself. */
  box: { width: number; height: number };
}

interface Drag {
  seam: Seam;
  /** The layout as it was on press; every draft is derived from it, never chained. */
  snapshot: TileLayout;
  /** Pointer position on the seam's axis when the drag started, in px. */
  origin: number;
}

/**
 * Centre of the gutter before track `k`, as a CSS length against the content box.
 *
 * With N tracks of width t and N-1 gutters of g, t = (W - (N-1)g)/N, so the centre
 * is k·t + (k-1)·g + g/2 = (k/N)·(W + g) - g/2. Exact, and no measuring.
 */
function gutterCentre(at: number): string {
  return `calc(${at / GRID} * (100% + ${GUTTER}px) - ${GUTTER / 2}px)`;
}

/** A zone count as a percentage of the long axis. */
function percent(zones: number): string {
  return `${(zones / GRID) * 100}%`;
}

export function TerminalSeamHandles({
  layout,
  onResize,
  onDraft,
  box,
}: TerminalSeamHandlesProps) {
  const dragRef = useRef<Drag | null>(null);
  const draftRef = useRef<TileLayout | null>(null);
  const [dragging, setDragging] = useState(false);

  // Read through a ref so the cleanup below fires on unmount and on nothing else.
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;

  // The draft is rendered by the grid above us, so it must not outlive us. Release,
  // Escape and pointercancel all abandon explicitly, but the handles can also just
  // go away mid-drag — the session count drops to 1, or a terminal is maximized —
  // and without this the grid would keep painting a tiling nobody committed.
  useEffect(
    () => () => {
      if (draftRef.current) onDraftRef.current(null);
    },
    [],
  );

  // Abandon: the draft is dropped and the grid falls back to the committed layout.
  const abandon = useCallback(() => {
    dragRef.current = null;
    draftRef.current = null;
    setDragging(false);
    onDraft(null);
  }, [onDraft]);

  useEffect(() => {
    if (!dragging) return;

    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const vertical = drag.seam.axis === "x";
      const size = vertical ? box.width : box.height;
      // One zone in px, gutters included — the same span the handle is placed by.
      const step = (size + GUTTER) / GRID;
      if (step <= 0) return;

      const travelled = (vertical ? event.clientX : event.clientY) - drag.origin;
      const delta = Math.round(travelled / step);
      // A clamped-out move holds the boundary still rather than dropping the draft.
      const next = resizeSeam(drag.snapshot, drag.seam, delta) ?? drag.snapshot;
      draftRef.current = next;
      onDraft(next);
    };

    const up = () => {
      const drag = dragRef.current;
      const draft = draftRef.current;
      // One gesture, one write, and only when the boundary actually moved: a press
      // that never moved persists nothing, and neither does a jiggle inside one
      // zone. There the delta rounds to 0, `resizeSeam` declines, and the draft is
      // the snapshot itself — committing that would mint a custom layout for the
      // scope out of a click, and a scope with one stops taking the per-count
      // default.
      if (draft && draft !== drag?.snapshot) onResize(draft);
      abandon();
    };

    const cancel = () => abandon();

    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") abandon();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);

    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [dragging, box.width, box.height, onDraft, onResize, abandon]);

  const seams = seamsOf(layout);
  if (seams.length === 0) return null;

  const start = (seam: Seam) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    // jsdom has no pointer capture; the window listeners carry the drag there.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      seam,
      snapshot: layout,
      origin: seam.axis === "x" ? event.clientX : event.clientY,
    };
    draftRef.current = null;
    setDragging(true);
  };

  return (
    <div className="pointer-events-none absolute inset-0">
      {seams.map((seam) => {
        const vertical = seam.axis === "x";
        const cross = gutterCentre(seam.at);
        const along = percent(seam.from);
        const span = percent(seam.to - seam.from);

        return (
          <div
            key={`${seam.axis}-${seam.at}-${seam.from}`}
            data-testid={`seam-handle-${seam.axis}-${seam.at}-${seam.from}`}
            className="pointer-events-auto absolute"
            style={{
              left: vertical ? cross : along,
              top: vertical ? along : cross,
              width: vertical ? `${HANDLE}px` : span,
              height: vertical ? span : `${HANDLE}px`,
              transform: vertical ? "translateX(-50%)" : "translateY(-50%)",
              cursor: vertical ? "col-resize" : "row-resize",
              touchAction: "none",
            }}
            onPointerDown={start(seam)}
          />
        );
      })}
    </div>
  );
}
