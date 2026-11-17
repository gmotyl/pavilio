import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  DragEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { alerts } from "../alerts/store";
import { refreshProjects } from "../projects/useProjects";
import {
  mergeSidebarOrder,
  type SidebarNode,
  type SidebarOrder,
} from "./sidebarOrder";

/**
 * Pointer-event drag (not HTML5 `draggable`, which CDP cannot start) for the
 * sidebar Projects tree. A row becomes a drag source after a small movement
 * threshold, so a plain click still navigates. While dragging, the row under
 * the pointer carries `data-drop="before" | "after" | "into"`: a line marks a
 * position, `into` a group row as the new home. A drop that keeps a project in
 * its container only rewrites the `sidebarOrder` preference; one that changes
 * its group PUTs the new `group:` first (optimistic, reverted with an alert on
 * failure), refreshes the projects and then saves the order.
 */

type Key = string; // "g:<group>" | "p:<project>"
type Edge = "before" | "after" | "into";
type Target = { key: Key; container: string | null; edge: Edge };
type Source = { key: Key; container: string | null };

const THRESHOLD = 4;

export type SidebarRowDragProps = {
  "data-drop"?: Edge;
  "data-dragging"?: "true";
  "data-drag-key"?: string;
  "data-drag-container"?: string;
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  onDragStart?: (e: DragEvent<HTMLElement>) => void;
  onClickCapture?: (e: MouseEvent<HTMLElement>) => void;
};

/** Mockup check 5: accent line = position, dashed accent outline = into group. */
export function dropStyle(edge: Edge | undefined, dragging = false): CSSProperties {
  if (dragging) return { opacity: 0.45, cursor: "grabbing" };
  if (edge === "before") return { boxShadow: "inset 0 2px 0 var(--accent)" };
  if (edge === "after") return { boxShadow: "inset 0 -2px 0 var(--accent)" };
  if (edge === "into")
    return {
      outline: "1px dashed var(--accent)",
      outlineOffset: -1,
      background: "color-mix(in srgb, var(--accent) 8%, transparent)",
    };
  return {};
}

/** The order the tree currently shows, as a fully explicit SidebarOrder. */
function orderOf(tree: SidebarNode[]): SidebarOrder {
  const groups: Record<string, string[]> = {};
  const top = tree.map((n) => {
    if (n.kind === "group") groups[n.name] = [...n.members];
    return `${n.kind === "group" ? "g" : "p"}:${n.name}`;
  });
  return { top, groups };
}

/**
 * Apply a drop to the shown tree. Returns the next order, plus the group
 * change when a project lands in another container; null when nothing moves.
 */
export function applyDrop(
  tree: SidebarNode[],
  source: Source,
  target: Target,
): { order: SidebarOrder; group?: { project: string; group: string | null } } | null {
  if (target.key === source.key) return null;
  const order = orderOf(tree);
  const name = source.key.slice(2);
  const isGroup = source.key.startsWith("g:");
  // Groups only live at top level: a target inside a group means its group row.
  let t = target;
  if (isGroup && t.container !== null) {
    t = { key: `g:${t.container}`, container: null, edge: t.edge === "before" ? "before" : "after" };
  }
  if (isGroup && t.edge === "into") return null;
  if (t.key === source.key) return null;

  // Remove from where it was.
  if (source.container === null) order.top = order.top.filter((k) => k !== source.key);
  else
    order.groups[source.container] = (order.groups[source.container] ?? []).filter(
      (m) => m !== name,
    );

  let dest: string | null;
  if (t.edge === "into") {
    dest = t.key.slice(2);
    const list = order.groups[dest] ?? [];
    order.groups[dest] = [...list.filter((m) => m !== name), name];
  } else {
    dest = t.container;
    const list = dest === null ? order.top : (order.groups[dest] ?? []);
    const item = dest === null ? source.key : name;
    const anchor = dest === null ? t.key : t.key.slice(2);
    const at = list.indexOf(anchor);
    const i = at < 0 ? list.length : t.edge === "before" ? at : at + 1;
    const next = [...list.slice(0, i), item, ...list.slice(i)];
    if (dest === null) order.top = next;
    else order.groups[dest] = next;
  }
  // An emptied group stays out of the saved order (it vanishes on refresh).
  if (source.container !== null && order.groups[source.container]?.length === 0) {
    delete order.groups[source.container];
    order.top = order.top.filter((k) => k !== `g:${source.container}`);
  }
  if (!isGroup && dest !== source.container)
    return { order, group: { project: name, group: dest } };
  return { order };
}

export function useSidebarDrag({
  projects,
  order,
  setOrder,
  isMobile,
}: {
  projects: { name: string; group: string | null }[];
  order: SidebarOrder;
  setOrder: (o: SidebarOrder) => void;
  isMobile: boolean;
}) {
  // Optimistic placement while a group PUT is in flight (or until discovery
  // reports the new group).
  const [pending, setPending] = useState<{
    order: SidebarOrder;
    project: string;
    group: string | null;
  } | null>(null);

  const tree = useMemo(() => {
    if (!pending) return mergeSidebarOrder(order, projects);
    return mergeSidebarOrder(
      pending.order,
      projects.map((p) =>
        p.name === pending.project ? { ...p, group: pending.group } : p,
      ),
    );
  }, [order, projects, pending]);

  // Discovery caught up: drop the override.
  useEffect(() => {
    if (!pending) return;
    const p = projects.find((x) => x.name === pending.project);
    if (p && (p.group ?? null) === pending.group) setPending(null);
  }, [projects, pending]);

  const [dragging, setDragging] = useState<Source | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const start = useRef<{ source: Source; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const targetRef = useRef<Target | null>(null);
  targetRef.current = target;
  const draggingRef = useRef<Source | null>(null);
  draggingRef.current = dragging;
  const mounted = useRef(true);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (clickTimer.current) clearTimeout(clickTimer.current);
      clickTimer.current = null;
    };
  }, []);

  const commit = useCallback(
    async (source: Source, t: Target) => {
      const result = applyDrop(treeRef.current, source, t);
      if (!result) return;
      if (!result.group) {
        setOrder(result.order);
        return;
      }
      const { project, group } = result.group;
      setPending({ order: result.order, project, group });
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(project)}/group`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ group }),
        });
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      } catch (err) {
        if (mounted.current) setPending(null);
        alerts.error(`Could not move ${project}`, {
          detail: err instanceof Error ? err.message : String(err),
          project,
        });
        return;
      }
      // Design sequence: PUT → refresh projects → save order. The override
      // clears once the refresh settles, whatever discovery reported.
      try {
        await refreshProjects();
      } finally {
        if (mounted.current) {
          setOrder(result.order);
          setPending(null);
        }
      }
    },
    [setOrder],
  );

  useEffect(() => {
    if (isMobile) return;
    /** The row under the pointer (pointer capture keeps events on the source). */
    const resolve = (x: number, y: number): Target | null => {
      const src = draggingRef.current;
      const hit = src ? document.elementFromPoint?.(x, y) : null;
      const row = hit instanceof Element ? hit.closest<HTMLElement>("[data-drag-key]") : null;
      if (!src || !row) return null;
      const key = row.dataset.dragKey as Key;
      const container = row.dataset.dragContainer ?? null;
      const r = row.getBoundingClientRect();
      const f = r.height > 0 ? (y - r.top) / r.height : 0.5;
      const edge: Edge =
        key.startsWith("g:") && src.key.startsWith("p:") && f >= 0.25 && f <= 0.75
          ? "into"
          : f < 0.5
            ? "before"
            : "after";
      return { key, container, edge };
    };
    const onMove = (e: PointerEvent) => {
      const s = start.current;
      if (!s) return;
      if (!draggingRef.current) {
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < THRESHOLD) return;
        draggingRef.current = s.source;
        setDragging(s.source);
      }
      const next = resolve(e.clientX, e.clientY);
      const cur = targetRef.current;
      const same =
        next === cur ||
        (!!next && !!cur && next.key === cur.key && next.container === cur.container && next.edge === cur.edge);
      if (!same) {
        targetRef.current = next;
        setTarget(next);
      }
    };
    const end = (e: PointerEvent, commitDrop: boolean) => {
      const source = draggingRef.current;
      start.current = null;
      if (!source) return;
      const t = commitDrop ? resolve(e.clientX, e.clientY) ?? null : null;
      draggingRef.current = null;
      targetRef.current = null;
      suppressClick.current = true;
      if (clickTimer.current) clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(() => {
        suppressClick.current = false;
        clickTimer.current = null;
      }, 0);
      setDragging(null);
      setTarget(null);
      if (t) void commit(source, t);
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
  }, [isMobile, commit]);

  const rowProps = useCallback(
    (key: Key, container: string | null): SidebarRowDragProps => {
      if (isMobile) return {};
      const drop =
        dragging && target && target.key === key && target.container === container
          ? target.edge
          : undefined;
      return {
        "data-drop": drop,
        "data-dragging": dragging?.key === key ? ("true" as const) : undefined,
        "data-drag-key": key,
        "data-drag-container": container ?? undefined,
        onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
          if (e.button !== 0) return;
          // Buttons inside the row (chevrons, stars) keep their own clicks.
          const el = e.target as HTMLElement;
          if (el.closest("button") && !el.closest("[data-drag-grip]")) return;
          start.current = { source: { key, container }, x: e.clientX, y: e.clientY };
          try {
            e.currentTarget.setPointerCapture?.(e.pointerId);
          } catch {
            /* pointer already released */
          }
        },
        // A NavLink inside the row would start the browser's native link
        // drag (→ pointercancel); the tree drags by pointer events only.
        onDragStart: (e: DragEvent<HTMLElement>) => e.preventDefault(),
        onClickCapture: (e: MouseEvent<HTMLElement>) => {
          if (suppressClick.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        },
      };
    },
    [isMobile, dragging, target],
  );

  return { tree, rowProps, dragging: dragging !== null };
}
