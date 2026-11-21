import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { SidebarRowDragProps } from "../shell/useSidebarDrag";

const THRESHOLD = 4;

type Target = { key: string; edge: "before" | "after" };

/**
 * Pointer-event drag for a flat list of cards (the Home actions). Same model as
 * the sidebar tree: the grip starts a drag after a small movement, the card
 * under the pointer carries `data-drop="before" | "after"` and the dragged one
 * `data-dragging="true"`; style both with the sidebar's `dropStyle`. Only keys
 * passed in `keys` are targets, so anything else in the grid (the "+ New action"
 * card) can neither be dragged nor dropped on. A drop calls `onReorder` with
 * the full resulting key order.
 */
export function useCardDrag({
  keys,
  onReorder,
  disabled,
}: {
  keys: string[];
  onReorder: (next: string[]) => void;
  disabled: boolean;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const start = useRef<{ key: string; x: number; y: number; el: HTMLElement; pointerId: number } | null>(null);
  const draggingRef = useRef<string | null>(null);
  const targetRef = useRef<Target | null>(null);
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  useEffect(() => {
    if (disabled) return;
    const resolve = (x: number, y: number): Target | null => {
      const src = draggingRef.current;
      const hit = src ? document.elementFromPoint?.(x, y) : null;
      const row = hit instanceof Element ? hit.closest<HTMLElement>("[data-card-key]") : null;
      const key = row?.dataset.cardKey;
      if (!src || !row || !key || key === src || !keysRef.current.includes(key)) return null;
      const r = row.getBoundingClientRect();
      // Reading order in a wrapping grid: the left half is "before".
      const f = r.width > 0 ? (x - r.left) / r.width : 0.5;
      return { key, edge: f < 0.5 ? "before" : "after" };
    };
    const onMove = (e: PointerEvent) => {
      const s = start.current;
      if (!s) return;
      if (!draggingRef.current) {
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < THRESHOLD) return;
        draggingRef.current = s.key;
        setDragging(s.key);
        try {
          s.el.setPointerCapture?.(s.pointerId);
        } catch {
          /* pointer already released */
        }
      }
      const next = resolve(e.clientX, e.clientY);
      const cur = targetRef.current;
      if (next?.key !== cur?.key || next?.edge !== cur?.edge) {
        targetRef.current = next;
        setTarget(next);
      }
    };
    const end = (e: PointerEvent, commit: boolean) => {
      const source = draggingRef.current;
      start.current = null;
      if (!source) return;
      const t = commit ? resolve(e.clientX, e.clientY) : null;
      draggingRef.current = null;
      targetRef.current = null;
      setDragging(null);
      setTarget(null);
      if (!t) return;
      const rest = keysRef.current.filter((k) => k !== source);
      const at = rest.indexOf(t.key);
      rest.splice(t.edge === "before" ? at : at + 1, 0, source);
      if (rest.some((k, i) => k !== keysRef.current[i])) onReorderRef.current(rest);
    };
    const onUp = (e: PointerEvent) => end(e, true);
    const onCancel = (e: PointerEvent) => end(e, false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [disabled]);

  /** Props for a card root and for its grip. Both empty on mobile. */
  const cardProps = useCallback(
    (key: string): { card: SidebarRowDragProps & { "data-card-key"?: string }; grip: Record<string, unknown> } => {
      if (disabled) return { card: {}, grip: {} };
      const drop = target && target.key === key ? target.edge : undefined;
      return {
        card: {
          "data-card-key": key,
          "data-drop": drop,
          "data-dragging": dragging === key ? ("true" as const) : undefined,
        },
        grip: {
          "data-drag-grip": "",
          onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
            if (e.button !== 0) return;
            start.current = {
              key,
              x: e.clientX,
              y: e.clientY,
              el: e.currentTarget,
              pointerId: e.pointerId,
            };
          },
          // The browser's own drag would cancel the pointer stream.
          onDragStart: (e: { preventDefault: () => void }) => e.preventDefault(),
        },
      };
    },
    [disabled, dragging, target],
  );

  return { cardProps, dragging: dragging !== null };
}
