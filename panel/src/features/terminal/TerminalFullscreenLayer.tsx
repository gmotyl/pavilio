import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { holdFullscreenLayer } from "../shell/Layout/fullscreenLayer";

/** Same tier as a fullscreen mockup: above the chrome, below the modals. */
const LAYER_CLASS = "fixed inset-0 z-[90] flex flex-col";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** The layer's Tab stops, in document order. */
function focusablesIn(layer: HTMLElement): HTMLElement[] {
  return Array.from(layer.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest("[hidden], [inert]"),
  );
}

/**
 * Where focus goes when a layer opens with focus outside it: a cell layer's
 * xterm, so the lifted terminal can be typed into at once; otherwise the first
 * Tab stop; otherwise the layer itself.
 */
function initialFocusTarget(layer: HTMLElement, kind: "cell" | "terminal"): HTMLElement {
  if (kind === "cell") {
    const xterm = layer.querySelector<HTMLElement>(".xterm-helper-textarea");
    if (xterm) return xterm;
  }
  return focusablesIn(layer)[0] ?? layer;
}

/**
 * The fixed full-viewport host of a terminal fullscreen layer.
 *
 * Always mounted around what it may lift — a cell, or a surface's whole
 * terminal container — and never re-parents it. Closed it is `display:
 * contents`, so the child keeps its place in the grid or the flex column it
 * sits in; open it becomes the fixed layer, and the very same DOM fills the
 * viewport. That is the point: the cell's xterm holder is pooled, one per
 * session, and lives in whichever `TerminalView` mounted it last. Rendering the
 * cell a second time in a portal would move the holder out of the grid and
 * back again on close, refitting the PTY twice; restyling in place renders it
 * once and keeps every piece of cell state (speech row choice, answer pane,
 * scrollback) as it was.
 *
 * While open it holds the shell's fullscreen layer, so the routed content's
 * `isolate` is lifted and `z-[90]` competes with the sidebars and the drawer.
 * A layout effect, so the chrome never paints one frame over the layer.
 *
 * While open it also keeps the keyboard inside: the chrome it covers is still
 * in the DOM, and Tab would otherwise walk into controls nobody can see. On
 * open focus moves in (unless it already is in), Tab and Shift+Tab wrap at the
 * layer's ends, and on close focus goes back to where it was before — if that
 * element is still connected and focus has not since been placed elsewhere on
 * purpose. Tab inside the xterm is never touched: xterm writes it to the PTY
 * and cancels the event itself, and the trap skips cancelled events and
 * anything inside `.xterm` besides. Escape is not handled here at all.
 */
export function TerminalFullscreenLayer({
  open,
  kind,
  children,
}: {
  open: boolean;
  kind: "cell" | "terminal";
  children: ReactNode;
}) {
  useLayoutEffect(() => (open ? holdFullscreenLayer() : undefined), [open]);

  const layerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const layer = layerRef.current;
    if (!open || !layer) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!layer.contains(document.activeElement)) initialFocusTarget(layer, kind).focus();

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Tab" || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      // The innermost open layer owns the keyboard: a cell layer lifted inside
      // an open terminal layer traps on its own.
      if (layer.querySelector("[data-terminal-fullscreen]")) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(".xterm")) return;
      const items = focusablesIn(layer);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        layer.focus();
        return;
      }
      const active = document.activeElement;
      const inside = layer.contains(active);
      if (e.shiftKey ? !inside || active === first : !inside || active === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Give focus back only if it is still in the (now closed) layer or lost.
      const active = document.activeElement;
      const lost = !active || active === document.body || layer.contains(active);
      if (lost && previous?.isConnected && !layer.contains(previous)) previous.focus();
    };
    // `kind` is read once, at open: a layer does not change kind while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div
      ref={layerRef}
      tabIndex={open ? -1 : undefined}
      data-terminal-fullscreen={open ? kind : undefined}
      className={open ? LAYER_CLASS : "contents"}
      // `visibility` and `pointer-events` are reset because a cell lifted while
      // Max hides its wrapper would otherwise inherit both into the layer.
      style={
        open
          ? { background: "var(--bg-base)", visibility: "visible", pointerEvents: "auto" }
          : undefined
      }
    >
      {children}
    </div>
  );
}
