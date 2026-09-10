import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  GRID,
  growRegion,
  placeRegion,
  readingOrder,
  splitPoint,
  type Rect,
  type TileLayout,
} from "./tileLayout";

interface Props {
  /** The layout as it stands — frozen for the whole drag. */
  layout: TileLayout;
  /** Display name per session id, for labelling the painted result. */
  nameOf?: (sessionId: string) => string;
  /** Called when the gesture is abandoned (Escape). The commit path is `release()`. */
  onCancel: () => void;
}

/**
 * The overlay is purely visual: `pointer-events: none` for its whole life, mounted from
 * the first render, and driven imperatively by the grid, which owns the drag events.
 *
 * Both halves of that are load-bearing, and both were learned the hard way. Mounting it
 * from `dragstart` put a React render inside the browser's own dragstart dispatch;
 * arming it by flipping `pointer-events` to `auto` changed what sat under the cursor at
 * the same moment. Either one makes Chromium abandon the drag instantly — the observed
 * signature was `dragstart → dragend` with not one `dragover` in between, and nothing
 * ever appearing on screen.
 */
export type PlacementMode = "grow" | "swap" | "target";

export interface PlacementOverlayHandle {
  /** Whether a gesture of ours is in flight — the grid asks before claiming a drop. */
  isDragging: () => boolean;
  /** Arm the gesture from the cell's dragstart. Writes refs only — never renders. */
  begin: (sessionId: string) => void;
  /**
   * Track the pointer and paint the layout the drop would commit.
   *
   * - `target` (no modifier) offers the window under the pointer: its halves as well
   *   as the whole of it;
   * - `grow` (Shift) stretches an area from the dragged window to the pointer;
   * - `swap` (Ctrl) exchanges it with the window under the pointer, as the grid always did.
   *
   * Which modifier selects which mode is the grid's business, not the overlay's, and
   * every caller says which one it means. The parameter is required on purpose: it
   * used to default to `grow`, which silently became the WRONG gesture the day the
   * plain drag stopped being a grow, and nothing pointed that out.
   */
  over: (clientX: number, clientY: number, mode: PlacementMode) => void;
  /** Disarm and return the layout that was painted, if any. */
  release: () => TileLayout | null;
  end: () => void;
}

/** Fraction of a tile, on each axis, that counts as its centre rather than a band. */
const CENTRE_BAND = 0.25;

function tileAt(layout: TileLayout, zx: number, zy: number) {
  return layout.find(
    (t) => zx >= t.x && zx < t.x + t.w && zy >= t.y && zy < t.y + t.h,
  );
}

type TargetSide = "centre" | "left" | "right" | "top" | "bottom";

export interface PlacementTarget {
  side: TargetSide;
  /** The zones the dragged session would take. */
  region: Rect;
  /** The zones the pointer must be in to choose it. */
  hit: Rect;
}

// Splits a span at the boundary nearest its middle. `splitPoint` gives the SMALLER
// part on an odd span; the dragged session takes the larger one.
function bandParts(start: number, span: number) {
  const cut = splitPoint(span);
  return { near: span - cut, farStart: start + cut, farSpan: span - cut };
}

/**
 * Every target a tile offers: its centre asks for the whole tile (a swap), each edge
 * band for a split at the boundary nearest the middle. An axis with a single zone has
 * no bands — there is nothing to split — so its share goes to the centre.
 *
 * Hit areas are in zones so the overlay can *draw* them: aiming at an invisible
 * boundary is the reason the first cut of this gesture was unusable.
 */
export function targetsOf(tile: Rect): PlacementTarget[] {
  const splittableX = tile.w >= 2;
  const splittableY = tile.h >= 2;
  // A quarter of the tile on each side, at least one zone wide so a narrow tile still
  // offers something to aim at.
  const bandW = splittableX ? Math.max(1, Math.round(tile.w * CENTRE_BAND)) : 0;
  const bandH = splittableY ? Math.max(1, Math.round(tile.h * CENTRE_BAND)) : 0;

  const targets: PlacementTarget[] = [];

  if (splittableX) {
    const x = bandParts(tile.x, tile.w);
    targets.push({
      side: "left",
      region: { x: tile.x, y: tile.y, w: x.near, h: tile.h },
      hit: { x: tile.x, y: tile.y, w: bandW, h: tile.h },
    });
    targets.push({
      side: "right",
      region: { x: x.farStart, y: tile.y, w: x.farSpan, h: tile.h },
      hit: { x: tile.x + tile.w - bandW, y: tile.y, w: bandW, h: tile.h },
    });
  }
  if (splittableY) {
    const y = bandParts(tile.y, tile.h);
    targets.push({
      side: "top",
      region: { x: tile.x, y: tile.y, w: tile.w, h: y.near },
      hit: { x: tile.x, y: tile.y, w: tile.w, h: bandH },
    });
    targets.push({
      side: "bottom",
      region: { x: tile.x, y: y.farStart, w: tile.w, h: y.farSpan },
      hit: { x: tile.x, y: tile.y + tile.h - bandH, w: tile.w, h: bandH },
    });
  }

  targets.push({
    side: "centre",
    region: { x: tile.x, y: tile.y, w: tile.w, h: tile.h },
    hit: {
      x: tile.x + bandW,
      y: tile.y + bandH,
      w: Math.max(1, tile.w - bandW * 2),
      h: Math.max(1, tile.h - bandH * 2),
    },
  });

  return targets;
}

function inRect(rect: Rect, zx: number, zy: number): boolean {
  return zx >= rect.x && zx < rect.x + rect.w && zy >= rect.y && zy < rect.y + rect.h;
}

/** The target whose hit area holds the pointer; the centre is the fallback. */
export function targetAt(tile: Rect, zx: number, zy: number): PlacementTarget {
  const targets = targetsOf(tile);
  return (
    targets.find((t) => t.side !== "centre" && inRect(t.hit, zx, zy)) ??
    targets[targets.length - 1]
  );
}

const pct = (zones: number) => `${(zones / GRID) * 100}%`;

// The zone substrate is a reading aid, not a readout of the matrix: a line per zone
// would be 48 of them on each axis, which is a haze. Drawing every fourth zone keeps
// the spacing the eye already learned when the matrix was 12 zones wide.
const ZONE_LINE_STRIDE = 4;
const zoneLineSpacing = pct(ZONE_LINE_STRIDE);

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
export const TerminalPlacementOverlay = forwardRef<PlacementOverlayHandle, Props>(
  function TerminalPlacementOverlay({ layout, nameOf, onCancel }, handleRef) {
  const ref = useRef<HTMLDivElement | null>(null);
  const draggedRef = useRef<string | null>(null);
  // A ref, not state: `begin()` runs inside the browser's dragstart dispatch and must
  // not schedule a render there.
  const sweptRef = useRef<string[]>([]);
  const [painted, setPainted] = useState<TileLayout | null>(null);
  // What the pointer is currently aiming at, drawn so the target stops being invisible.
  const [aiming, setAiming] = useState<{
    tile: Rect;
    target: PlacementTarget;
    mode: PlacementMode;
    refused: boolean;
  } | null>(null);
  // The area being painted by the default (grow) gesture, drawn as the aim.
  const [region, setRegion] = useState<Rect | null>(null);
  // Which gesture the modifiers currently select, so the legend can say what is live.
  const [mode, setMode] = useState<PlacementMode>("grow");
  // The drop reads the last painted layout from a ref: a drop event that lands in the
  // same tick as a dragover must still commit what was on screen, not a stale render.
  const paintedRef = useRef<TileLayout | null>(null);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const paint = useCallback((next: TileLayout | null) => {
    paintedRef.current = next;
    setPainted(next);
  }, []);

  const end = useCallback(() => {
    draggedRef.current = null;
    sweptRef.current = [];
    setAiming(null);
    setRegion(null);
    paint(null);
  }, [paint]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && draggedRef.current) {
        end();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [end, onCancel]);

  const over = useCallback(
    (clientX: number, clientY: number, mode: PlacementMode) => {
      const draggedId = draggedRef.current;
      if (!draggedId) return;

      const box = ref.current?.getBoundingClientRect();
      if (!box || box.width === 0 || box.height === 0) return;

      // Fractional zone coordinates, so the tile lookup and the target test read off
      // the same measurement.
      const zoneX = ((clientX - box.left) / box.width) * GRID;
      const zoneY = ((clientY - box.top) / box.height) * GRID;
      const zx = Math.min(GRID - 1, Math.max(0, Math.floor(zoneX)));
      const zy = Math.min(GRID - 1, Math.max(0, Math.floor(zoneY)));

      const layout = layoutRef.current;
      const self = layout.find((t) => t.sessionId === draggedId);
      if (!self) return;

      setMode(mode);

      if (mode !== "grow") {
        const hovered = tileAt(layout, zx, zy);
        if (!hovered || hovered.sessionId === draggedId) {
          // Clear the aim rather than leaving the previous window's targets drawn: the
          // 4px gutters and the dragged window itself are both "nothing to aim at".
          setAiming(null);
          paint(null);
          return;
        }
        // Ctrl is the plain exchange the grid has always had — the whole window under
        // the pointer, with no edge bands to aim past. The unmodified drag additionally
        // offers its halves.
        const aim: PlacementTarget =
          mode === "swap"
            ? { side: "centre", region: { ...hovered }, hit: { ...hovered } }
            : targetAt(hovered, zx, zy);
        const next = placeRegion(layout, draggedId, aim.region);
        setRegion(null);
        // A target the tiling cannot honour is drawn refused, the same as an
        // impossible grow region — a gesture that quietly does nothing is worse than
        // one that says no.
        setAiming({ tile: hovered, target: aim, mode, refused: next === null });
        paint(next);
        return;
      }

      // The default gesture: paint an area anchored on the dragged window itself and
      // stretched to the pointer. Sweeping a 3x3's top-left window across to the right
      // edge asks for the whole top band — the case neither target-only prototype could
      // express, because every target it offered was a slice of somebody else.
      const region: Rect = {
        x: Math.min(self.x, zx),
        y: Math.min(self.y, zy),
        w: Math.abs(Math.max(self.x + self.w - 1, zx) - Math.min(self.x, zx)) + 1,
        h: Math.abs(Math.max(self.y + self.h - 1, zy) - Math.min(self.y, zy)) + 1,
      };

      setAiming(null);
      setRegion(region);
      paint(growRegion(layout, draggedId, region));
    },
    [paint],
  );

  const release = useCallback((): TileLayout | null => {
    const next = paintedRef.current;
    if (!draggedRef.current) return null;
    end();
    return next;
  }, [end]);

  useImperativeHandle(
    handleRef,
    () => ({
      isDragging: () => draggedRef.current !== null,
      begin: (sessionId: string) => {
        draggedRef.current = sessionId;
        sweptRef.current = [];
        paintedRef.current = null;
      },
      over,
      release,
      end,
    }),
    [end, over, release],
  );

  const preview = painted ?? [];
  const draggedId = draggedRef.current;
  const dragging = preview.length > 0 || aiming !== null || region !== null;

  return (
    <div
      ref={ref}
      data-testid="terminal-placement-overlay"
      className="absolute inset-0 z-20"
      // Never hittable: the grid below owns the drag events and forwards coordinates.
      style={{ pointerEvents: "none" }}
    >
      {dragging && (
        <div
          data-testid="placement-zone-grid"
          className="absolute inset-0"
          style={{
            backgroundImage: `repeating-linear-gradient(to right, rgba(255,255,255,0.10) 0 1px, transparent 1px ${zoneLineSpacing}), repeating-linear-gradient(to bottom, rgba(255,255,255,0.10) 0 1px, transparent 1px ${zoneLineSpacing})`,
          }}
        />
      )}

      {readingOrder(preview).map((tile) => {
        const dragged = tile.sessionId === draggedId;
        return (
          <div
            key={tile.sessionId}
            data-testid={`placement-preview-${tile.sessionId}`}
            data-region={`${tile.x},${tile.y},${tile.w},${tile.h}`}
            className="absolute flex items-center justify-center rounded-md"
            style={{
              left: pct(tile.x),
              top: pct(tile.y),
              width: pct(tile.w),
              height: pct(tile.h),
              padding: "2px",
              background: dragged ? "rgba(97,175,239,0.28)" : "rgba(20,22,28,0.55)",
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

      {dragging && (
        <div
          data-testid="placement-legend"
          className="absolute left-1/2 flex items-center gap-1 rounded-md px-1.5 py-1"
          style={{
            bottom: "8px",
            transform: "translateX(-50%)",
            background: "rgba(12,13,17,0.92)",
            border: "1px solid rgba(255,255,255,0.16)",
            boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
          }}
        >
          {(
            [
              // The unmodified gesture reads first, then the two modifiers.
              ["target", "Drag", "split"],
              ["grow", "Shift", "grow"],
              ["swap", "Ctrl", "swap"],
            ] as [PlacementMode, string, string][]
          ).map(([key, keyLabel, what]) => {
            const active = mode === key;
            return (
              <span
                key={key}
                data-testid={`placement-legend-${key}`}
                data-active={active ? "true" : "false"}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest"
                style={{
                  background: active ? "rgba(97,175,239,0.22)" : "transparent",
                  color: active ? "#cfe6ff" : "var(--text-tertiary)",
                }}
              >
                <kbd
                  className="font-mono text-[10px] normal-case tracking-normal rounded px-1"
                  style={{
                    background: "rgba(255,255,255,0.10)",
                    color: active ? "#cfe6ff" : "var(--text-secondary)",
                  }}
                >
                  {keyLabel}
                </kbd>
                {what}
              </span>
            );
          })}
        </div>
      )}

      {/* The painted area, drawn so the sweep is visible while it happens. */}
      {region && (
        <div
          data-testid="placement-region"
          data-region={`${region.x},${region.y},${region.w},${region.h}`}
          className="absolute rounded-md"
          style={{
            left: pct(region.x),
            top: pct(region.y),
            width: pct(region.w),
            height: pct(region.h),
            outline: painted
              ? "2px solid rgba(97,175,239,0.95)"
              : "2px dashed rgba(239,97,97,0.9)",
            outlineOffset: "-2px",
            background: painted ? "transparent" : "rgba(239,97,97,0.12)",
          }}
        />
      )}

      {/* The targets on the window under the pointer, drawn so aiming is possible at
          all: the five hit areas outlined, the chosen one filled. */}
      {aiming &&
        (aiming.mode === "swap" ? [aiming.target] : targetsOf(aiming.tile)).map((t) => {
          const active = t.side === aiming.target.side;
          const refused = active && aiming.refused;
          return (
            <div
              key={t.side}
              data-testid={`placement-target-${t.side}`}
              data-active={active ? "true" : "false"}
              className="absolute rounded-sm"
              style={{
                left: pct(t.hit.x),
                top: pct(t.hit.y),
                width: pct(t.hit.w),
                height: pct(t.hit.h),
                background: refused
                  ? "rgba(239,97,97,0.16)"
                  : active
                    ? "rgba(97,175,239,0.30)"
                    : "transparent",
                outline: refused
                  ? "2px dashed rgba(239,97,97,0.9)"
                  : active
                    ? "1.5px solid rgba(97,175,239,0.95)"
                    : "1px dashed rgba(255,255,255,0.30)",
                outlineOffset: "-1px",
              }}
            >
              {active && (
                <span
                  className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-widest"
                  style={{ color: refused ? "#ffd0d0" : "#cfe6ff" }}
                >
                  {refused ? "no room" : t.side === "centre" ? "swap" : "split"}
                </span>
              )}
            </div>
          );
        })}
    </div>
  );
});

export default TerminalPlacementOverlay;
