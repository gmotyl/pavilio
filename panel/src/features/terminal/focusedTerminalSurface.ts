/**
 * Which terminal surface a fullscreen shortcut acts on, and which cell of it.
 *
 * Several surfaces can be on screen at once (the Cmd+B drawer over a project's
 * terminal tab). Each one registers its root element here; the store listens
 * for focus on that root and keeps, per surface, when it last took focus and
 * its focused cell — the cell whose xterm or header last had focus, which
 * survives focus moving on to the toolbar or out of the surface.
 *
 * Every surface binds the same keys with its own window listener, and stopping
 * the event does not silence its siblings, so each handler asks
 * {@link shortcutTarget} whether it is the one. The answer is resolved once per
 * event and cached: the first handler to act changes the very state the pick
 * reads (a layer opens, focus moves), and a second handler must not see a
 * different winner for the same keypress.
 */

interface SurfaceEntry {
  root: HTMLElement | null;
  detach: (() => void) | null;
  /** When this surface last took focus (or registered), on a shared counter. */
  seq: number;
  focusedCell: string | null;
  layerOpen: boolean;
}

const surfaces = new Map<string, SurfaceEntry>();
let clock = 0;
const targets = new WeakMap<Event, string | null>();

function entry(id: string): SurfaceEntry {
  let e = surfaces.get(id);
  if (!e) {
    e = { root: null, detach: null, seq: ++clock, focusedCell: null, layerOpen: false };
    surfaces.set(id, e);
  }
  return e;
}

/** The cell `target` belongs to, when it is that cell's xterm or header. */
function cellOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest<HTMLElement>("[data-terminal-cell]");
  if (!cell) return null;
  const part = target.closest(".xterm, [data-terminal-cell-header]");
  return part && cell.contains(part) ? (cell.dataset.terminalCell ?? null) : null;
}

/**
 * Attach (or, with `null`, detach) a surface's root. Focus and pointer-downs
 * anywhere inside it mark the surface as the latest one used; those on a
 * cell's xterm or header also make that cell its focused cell. The pointer
 * counts as well because a header click does not focus anything in Safari.
 */
export function setSurfaceRoot(id: string, root: HTMLElement | null): void {
  if (!root && !surfaces.has(id)) return;
  const e = entry(id);
  if (e.root === root) return;
  e.detach?.();
  e.detach = null;
  e.root = root;
  if (!root) return;
  const onUse = (ev: Event) => {
    e.seq = ++clock;
    const cell = cellOf(ev.target);
    if (cell) e.focusedCell = cell;
  };
  root.addEventListener("focusin", onUse, true);
  root.addEventListener("pointerdown", onUse, true);
  e.detach = () => {
    root.removeEventListener("focusin", onUse, true);
    root.removeEventListener("pointerdown", onUse, true);
  };
}

/** Publish whether this surface's fullscreen layer is open. */
export function setSurfaceLayerOpen(id: string, open: boolean): void {
  if (!open && !surfaces.has(id)) return;
  entry(id).layerOpen = open;
}

export function unregisterTerminalSurface(id: string): void {
  surfaces.get(id)?.detach?.();
  surfaces.delete(id);
}

/** The surface's focused cell, or null when none of its cells has had focus. */
export function focusedCellOf(id: string): string | null {
  return surfaces.get(id)?.focusedCell ?? null;
}

/**
 * The surface a shortcut keypress targets: one whose layer is open (it covers
 * the viewport, so its shortcut closes it whatever has focus), else the one
 * holding DOM focus, else the most recently focused. Null with none registered.
 */
export function shortcutTarget(event: Event): string | null {
  if (targets.has(event)) return targets.get(event)!;
  let pick: string | null = null;
  const active = document.activeElement;
  let best = -1;
  for (const [id, e] of surfaces) {
    if (e.layerOpen) {
      pick = id;
      break;
    }
    if (active && e.root?.contains(active) && active !== document.body) {
      pick = id;
      best = Infinity;
    } else if (e.seq > best) {
      pick = id;
      best = e.seq;
    }
  }
  targets.set(event, pick);
  return pick;
}
