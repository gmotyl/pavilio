import { useEffect, useRef } from "react";
import { useIsMobile } from "./useIsMobile";

/** The physical keys the panel binds under Alt+Shift. */
export type PanelShortcutCode = "KeyF" | "KeyC" | "KeyT" | "KeyO";

/**
 * Bind Alt+Shift+<code> to a panel action, even while a terminal has focus.
 *
 * The listener sits on `window` in the CAPTURE phase, so it runs before the
 * key reaches xterm's helper textarea; a match is `preventDefault`ed and
 * stopped, so the shell never sees it. Matching is by `event.code`, the
 * physical key, because macOS Option composes a different `key` (Alt+Shift+F
 * arrives as `Ï`). Any extra Cmd/Ctrl, or Alt without Shift, is not a match and
 * passes through untouched.
 *
 * Inactive below `md` (the phone layout `useIsMobile` reports) and while
 * `enabled` is false: the key then reaches whatever has focus. The latest
 * `handler` is always the one called, without re-registering the listener.
 */
export function usePanelShortcut(
  code: PanelShortcutCode,
  handler: (e: KeyboardEvent) => void,
  enabled = true,
): void {
  const isMobile = useIsMobile();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const active = enabled && !isMobile;

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.metaKey || e.ctrlKey) return;
      if (e.code !== code) return;
      e.preventDefault();
      e.stopPropagation();
      handlerRef.current(e);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, code]);
}
