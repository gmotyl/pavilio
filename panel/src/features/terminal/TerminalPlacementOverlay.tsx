import { useCallback, useEffect, useRef, useState } from "react";
import {
  GRID,
  placeRegion,
  readingOrder,
  splitPoint,
  type Rect,
  type TileLayout,
} from "./tileLayout";

interface Props {
  /** The layout as it stands — frozen for the whole drag. */
  layout: TileLayout;
  draggedId: string;
  /** Display name per session id, for labelling the painted result. */
  nameOf?: (sessionId: string) => string;
  onCommit: (next: TileLayout) => void;
  onCancel: () => void;
}

/** Fraction of a tile, on each axis, that counts as its centre rather than a band. */
const CENTRE_BAND = 0.25;

function tileAt(layout: TileLayout, zx: number, zy: number) {
  return layout.find(
    (t) => zx >= t.x && zx < t.x + t.w && zy >= t.y && zy < t.y + t.h,
  );
}

/**
 * The region a pointer inside `tile` targets: its centre asks for the whole tile (a
 * swap), each edge band for a split at the boundary nearest the middle, with the
 * dragged session taking the larger part. An axis with a single zone has no bands —
 * there is nothing to split — so its whole width counts as centre.
 */
function regionInTile(tile: Rect, fx: number, fy: number): Rect {
  const splittableX = tile.w >= 2;
  const splittableY = tile.h >= 2;

  const distances: { side: "left" | "right" | "top" | "bottom"; d: number }[] = [];
  if (splittableX && fx < CENTRE_BAND) distances.push({ side: "left", d: fx });
  if (splittableX && fx > 1 - CENTRE_BAND) distances.push({ side: "right", d: 1 - fx });
  if (splittableY && fy < CENTRE_BAND) distances.push({ side: "top", d: fy });
  if (splittableY && fy > 1 - CENTRE_BAND) distances.push({ side: "bottom", d: 1 - fy });

  // A plain Rect, not a copy of the tile: the caller builds a new tile from it and a
  // stray sessionId riding along would silently rename the placed session.
  if (distances.length === 0) return { x: tile.x, y: tile.y, w: tile.w, h: tile.h };

  const nearest = distances.sort((a, b) => a.d - b.d)[0].side;
  // splitPoint gives the SMALLER part on an odd span; the dragged session takes the
  // larger one, so the hovered side is sized by subtracting it.
  const cutX = splitPoint(tile.w);
  const cutY = splitPoint(tile.h);

  switch (nearest) {
    case "left":
      return { x: tile.x, y: tile.y, w: tile.w - cutX, h: tile.h };
    case "right":
      return { x: tile.x + cutX, y: tile.y, w: tile.w - cutX, h: tile.h };
    case "top":
      return { x: tile.x, y: tile.y, w: tile.w, h: tile.h - cutY };
    case "bottom":
      return { x: tile.x, y: tile.y + cutY, w: tile.w, h: tile.h - cutY };
  }
}

function boundingBox(tiles: Rect[]): Rect {
  const x = Math.min(...tiles.map((t) => t.x));
  const y = Math.min(...tiles.map((t) => t.y));
  const right = Math.max(...tiles.map((t) => t.x + t.w));
  const bottom = Math.max(...tiles.map((t) => t.y + t.h));
  return { x, y, w: right - x, h: bottom - y };
}

const pct = (zones: number) => `${(zones / GRID) * 100}%`;

/**
 * The drag surface for placing a terminal. It floats above the grid for the duration
 * of a drag and owns every drag event, so the cells underneath never move and never
 * change which one sits under the cursor.
 *
 * That is the whole point: the previous model fed its preview into the real render,
 * so previewing re-flowed the cells, `dragover` then fired on a different cell, and
 * the drop committed something other than what was on screen. Here the preview is
 * painted on the overlay and handed to the drop verbatim.
 */
export function TerminalPlacementOverlay({
  layout,
  draggedId,
  nameOf,
  onCommit,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [swept, setSwept] = useState<string[]>([]);
  const [painted, setPainted] = useState<TileLayout | null>(null);
  // The drop reads the last painted layout from a ref: a drop event that lands in the
  // same tick as a dragover must still commit what was on screen, not a stale render.
  const paintedRef = useRef<TileLayout | null>(null);

  const paint = useCallback((next: TileLayout | null) => {
    paintedRef.current = next;
    setPainted(next);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        paint(null);
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, paint]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

    const box = ref.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;

    // Fractional zone coordinates, so both the tile lookup and the band test read off
    // the same measurement.
    const zoneX = ((e.clientX - box.left) / box.width) * GRID;
    const zoneY = ((e.clientY - box.top) / box.height) * GRID;
    const zx = Math.min(GRID - 1, Math.floor(zoneX));
    const zy = Math.min(GRID - 1, Math.floor(zoneY));
    if (zx < 0 || zy < 0) return;

    const hovered = tileAt(layout, zx, zy);
    // Passing back over the dragged terminal changes nothing — it keeps the target the
    // sweep has built up rather than resetting it mid-gesture.
    if (!hovered || hovered.sessionId === draggedId) return;

    const alreadySwept = swept.includes(hovered.sessionId);
    const nextSwept =
      swept.length === 0 || (swept.length === 1 && alreadySwept)
        ? [hovered.sessionId]
        : alreadySwept
          ? swept
          : [...swept, hovered.sessionId];

    let region: Rect;
    if (nextSwept.length === 1) {
      const fx = (zoneX - hovered.x) / hovered.w;
      const fy = (zoneY - hovered.y) / hovered.h;
      region = regionInTile(hovered, clamp01(fx), clamp01(fy));
    } else {
      const sweptTiles = layout.filter((t) => nextSwept.includes(t.sessionId));
      region = boundingBox(sweptTiles);
    }

    if (nextSwept !== swept) setSwept(nextSwept);
    paint(placeRegion(layout, draggedId, region));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const next = paintedRef.current;
    paint(null);
    if (next) onCommit(next);
    else onCancel();
  };

  const preview = painted ?? [];

  return (
    <div
      ref={ref}
      data-testid="terminal-placement-overlay"
      className="absolute inset-0 z-20"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={() => paint(null)}
    >
      {readingOrder(preview).map((tile) => {
        const dragged = tile.sessionId === draggedId;
        return (
          <div
            key={tile.sessionId}
            data-testid={`placement-preview-${tile.sessionId}`}
            data-region={`${tile.x},${tile.y},${tile.w},${tile.h}`}
            className="absolute flex items-center justify-center rounded-md pointer-events-none"
            style={{
              left: pct(tile.x),
              top: pct(tile.y),
              width: pct(tile.w),
              height: pct(tile.h),
              padding: "2px",
              background: dragged
                ? "rgba(97,175,239,0.28)"
                : "rgba(20,22,28,0.55)",
              outline: dragged
                ? "2px solid rgba(97,175,239,0.9)"
                : "1px solid rgba(255,255,255,0.25)",
              outlineOffset: "-2px",
              transition: "left 80ms, top 80ms, width 80ms, height 80ms",
            }}
          >
            <span
              className="text-[10.5px] font-mono tracking-wide truncate px-1"
              style={{ color: dragged ? "#cfe6ff" : "var(--text-secondary)" }}
            >
              {nameOf?.(tile.sessionId) ?? tile.sessionId}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function clamp01(value: number): number {
  return Math.min(0.999, Math.max(0, value));
}

export default TerminalPlacementOverlay;
