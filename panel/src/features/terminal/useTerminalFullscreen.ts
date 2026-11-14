import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * A terminal surface's fullscreen layer: one cell, or the whole terminal
 * container (tab strip and grid), shown above the shell chrome.
 *
 * Transient by design. The state is local to the surface that calls this hook:
 * nothing is persisted, an unmount drops it, and any navigation closes it. The
 * shell's `holdFullscreenLayer` is taken by `TerminalFullscreenLayer` while it
 * is actually on screen, so a layer the surface cannot show (its cell was
 * minimised or killed, the viewport went narrow) never holds the chrome open.
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

  return useMemo(
    () => ({ state, toggleCell, toggleTerminal, close }),
    [state, toggleCell, toggleTerminal, close],
  );
}
