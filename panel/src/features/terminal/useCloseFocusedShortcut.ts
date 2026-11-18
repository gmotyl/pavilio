import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { alerts } from "../alerts/store";
import { useIsMobile } from "../shell/useIsMobile";
import { ConfirmCloseTerminalModal } from "./ConfirmCloseTerminalModal";
import { killEach } from "./bulkCloseTargets";
import { focusedCellOf, shortcutTarget, surfaceRootOf } from "./focusedTerminalSurface";

/**
 * Alt+Shift+W: open the kill confirmation for the focused session of the
 * surface `focusedTerminalSurface` picks for the keypress — the same store the
 * fullscreen shortcuts use. Focus inside a cell (its xterm, or its composer)
 * names that cell; otherwise the surface's last focused cell. No focused
 * session, a hidden surface, or a phone viewport: nothing happens and the key
 * passes through. Capture phase on `window`, so xterm never sees a match.
 */
export function useCloseFocusedShortcut({
  surfaceId,
  sessions,
  kill,
}: {
  surfaceId: string;
  sessions: readonly { id: string; name: string }[];
  kill: (id: string) => Promise<boolean | void> | boolean | void;
}): ReactNode {
  const isMobile = useIsMobile();
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const latest = useRef({ sessions, kill });
  latest.current = { sessions, kill };

  useEffect(() => {
    if (isMobile) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.metaKey || e.ctrlKey || e.code !== "KeyW") return;
      if (shortcutTarget(e) !== surfaceId) return;
      const root = surfaceRootOf(surfaceId);
      if (!root || !root.isConnected || root.closest("[hidden], [inert], [aria-hidden='true']")) return;
      const active = document.activeElement;
      const cellEl =
        active && root.contains(active) ? active.closest<HTMLElement>("[data-terminal-cell]") : null;
      const id = cellEl?.dataset.terminalCell ?? focusedCellOf(surfaceId);
      const session = id ? latest.current.sessions.find((s) => s.id === id) : undefined;
      if (!session) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      setTarget({ id: session.id, name: session.name });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isMobile, surfaceId]);

  return createElement(ConfirmCloseTerminalModal, {
    session: target,
    onCancel: () => setTarget(null),
    onConfirm: (ids: string[]) => {
      const name = target?.name ?? "";
      setTarget(null);
      void killEach(ids, latest.current.kill).then((failed) =>
        failed.forEach(() => alerts.error(`Couldn't close ${name}`, { detail: "The session could not be killed." })),
      );
    },
  });
}
