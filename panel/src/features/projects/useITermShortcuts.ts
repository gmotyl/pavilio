import { useEffect } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { SessionMeta } from "../terminal/useTerminalSessions";
import type { Project } from "./useProjects";

interface Options {
  active: boolean;
  sessions: SessionMeta[];
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  projects: Project[];
  navTo: NavigateFunction;
  maximized: boolean;
  setMaximized: (next: boolean) => void;
}

/**
 * Keyboard shortcuts active while inside the iTerm tab:
 * - Cmd/Ctrl+Shift+Enter: toggle maximize
 * - Cmd/Ctrl+1..9: focus terminal at index (1-based)
 * - Cmd/Ctrl+0: clear focus
 * - Cmd/Ctrl+`: cycle to next session
 * - Ctrl+Shift+1..6: navigate to project N's iTerm tab
 * - Escape: exit maximize
 */
export function useITermShortcuts({
  active,
  sessions,
  focusedId,
  setFocusedId,
  projects,
  navTo,
  maximized,
  setMaximized,
}: Options) {
  useEffect(() => {
    if (!active) return;

    const handler = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      const isEditable =
        tag === "input" ||
        tag === "textarea" ||
        (document.activeElement as HTMLElement | null)?.isContentEditable;
      if (isEditable) return;

      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        !e.altKey &&
        (e.key === "Enter" || e.code === "Enter")
      ) {
        e.preventDefault();
        setMaximized(!maximized);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        const digitMatch = /^Digit([0-9])$/.exec(e.code);
        if (digitMatch) {
          const digit = Number(digitMatch[1]);
          e.preventDefault();
          if (digit === 0) setFocusedId(null);
          else {
            const target = sessions[digit - 1];
            if (target) setFocusedId(target.id);
          }
          return;
        }
        if (e.key === "`" || e.code === "Backquote") {
          e.preventDefault();
          const ids = sessions.map((s) => s.id);
          if (ids.length === 0) return;
          const currentIdx = focusedId ? ids.indexOf(focusedId) : -1;
          const nextIdx = (currentIdx + 1) % ids.length;
          setFocusedId(ids[nextIdx]);
          return;
        }
      }

      if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey) {
        const digitMatch = /^Digit([1-6])$/.exec(e.code);
        if (digitMatch) {
          const digit = Number(digitMatch[1]);
          e.preventDefault();
          const proj = projects[digit - 1];
          if (proj) navTo(`/project/${proj.name}/iterm`);
          return;
        }
      }

      if (e.key === "Escape" && maximized) {
        e.preventDefault();
        setMaximized(false);
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [active, sessions, focusedId, setFocusedId, projects, navTo, maximized, setMaximized]);
}
