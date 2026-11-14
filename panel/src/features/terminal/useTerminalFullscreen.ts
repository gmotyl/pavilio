import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { usePanelShortcut } from "../shell/usePanelShortcut";
import {
  focusedCellOf,
  setSurfaceLayerOpen,
  setSurfaceRoot,
  shortcutTarget,
  unregisterTerminalSurface,
} from "./focusedTerminalSurface";

/**
 * A terminal surface's fullscreen layer: one cell, or the whole terminal
 * container (tab strip and grid), shown above the shell chrome.
 *
 * Transient by design. The state is local to the surface that calls this hook:
 * nothing is persisted, an unmount drops it, and any navigation closes it. The
 * shell's `holdFullscreenLayer` is taken by `TerminalFullscreenLayer` while it
 * is actually on screen, so a layer the surface cannot show (its cell was
 * minimised or killed, the viewport went narrow) never holds the chrome open.
 *
 * It also binds the layers' shortcuts: Alt+Shift+T toggles the terminal layer
 * and Alt+Shift+C the focused cell's, on whichever surface
 * `focusedTerminalSurface` picks for the keypress (the surface spreads
 * `surfaceRef` on its root so its focus can be tracked).
 */
export type TerminalFullscreenState =
  | { kind: "closed" }
  | { kind: "cell"; sessionId: string }
  | { kind: "terminal" };

export interface TerminalFullscreen {
  state: TerminalFullscreenState;
  /** Open this cell's layer, or close it when it is the one already open. */
  toggleCell: (sessionId: string) => void;
  /** Open the terminal container's layer, or close it when it is open. */
  toggleTerminal: () => void;
  close: () => void;
  /** Ref for the surface's root: registers it as a shortcut target. */
  surfaceRef: (root: HTMLElement | null) => void;
}

const CLOSED: TerminalFullscreenState = { kind: "closed" };

export function useTerminalFullscreen(): TerminalFullscreen {
  const [state, setState] = useState<TerminalFullscreenState>(CLOSED);
  const location = useLocation();

  // Any navigation closes the layer. The first run is the mount, not a
  // navigation, so it is skipped by the key guard.
  const lastKey = useRef(location.key);
  useEffect(() => {
    if (lastKey.current === location.key) return;
    lastKey.current = location.key;
    setState(CLOSED);
  }, [location.key]);

  const toggleCell = useCallback((sessionId: string) => {
    setState((cur) =>
      cur.kind === "cell" && cur.sessionId === sessionId ? CLOSED : { kind: "cell", sessionId },
    );
  }, []);
  const toggleTerminal = useCallback(() => {
    setState((cur) => (cur.kind === "terminal" ? CLOSED : { kind: "terminal" }));
  }, []);
  const close = useCallback(() => setState(CLOSED), []);

  // This surface's entry in the shortcut store, dropped with the surface.
  const id = useId();
  const surfaceRef = useCallback((root: HTMLElement | null) => setSurfaceRoot(id, root), [id]);
  useLayoutEffect(() => () => unregisterTerminalSurface(id), [id]);
  useLayoutEffect(() => setSurfaceLayerOpen(id, state.kind !== "closed"), [id, state.kind]);

  // Every surface listens; only the press's target acts. With the cell layer
  // open, Alt+Shift+C closes it whichever cell has focus; otherwise it opens
  // the focused cell's, and does nothing while no cell has had focus.
  usePanelShortcut("KeyT", (e) => {
    if (shortcutTarget(e) === id) toggleTerminal();
  });
  usePanelShortcut("KeyC", (e) => {
    if (shortcutTarget(e) !== id) return;
    if (state.kind === "cell") return close();
    const cell = focusedCellOf(id);
    if (cell) toggleCell(cell);
  });

  return useMemo(
    () => ({ state, toggleCell, toggleTerminal, close, surfaceRef }),
    [state, toggleCell, toggleTerminal, close, surfaceRef],
  );
}
