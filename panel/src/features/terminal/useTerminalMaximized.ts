import { useCallback, useState } from "react";
import { preferences } from "../../preferences/declarations";
import { readPreference, writePreference } from "../../preferences/store";

/**
 * Whether this scope's terminal grid is maximized. The scope is a project name,
 * or `__all__` for the cross-project terminals page.
 *
 * Portable, and deliberately so: it is a choice about how the grid is shown,
 * not a fact about this machine, so it travels in the workspace file.
 *
 * Local state seeded from `readPreference`, written only on a real toggle —
 * `GitBranchDiff`'s shape rather than `usePreference`'s, for two reasons the
 * hook cannot cover. `ProjectView` renders `projectName={name || ""}`, so a
 * BLANK project reaches this hook on a real route, and `storageKey` throws on a
 * blank scope rather than letting every project share one key; an unresolved
 * scope has to read the declared default and write nothing. And the consumer is
 * reused across route navigations without remounting, so a changed project has
 * to swap the value in during render — the same "reset state when a prop
 * changes" adjustment `useTerminalOrdering` makes, and for the same reason: an
 * effect would only queue the swap, one render too late.
 */
function readMaximized(project: string): boolean {
  // Not a bare `.trim()`: see the note on `writeTerminalFocus`. A blank scope
  // and an absent one are the same thing here — the declared default.
  if (typeof project !== "string" || project.trim() === "")
    return preferences.terminalMaximized.default;
  return readPreference(preferences.terminalMaximized, project);
}

export function useTerminalMaximized(
  project: string,
): [boolean, () => void, (value: boolean) => void] {
  const [value, setValueState] = useState<boolean>(() => readMaximized(project));
  const [loadedProject, setLoadedProject] = useState(project);
  if (loadedProject !== project) {
    setLoadedProject(project);
    setValueState(readMaximized(project));
  }

  const setValue = useCallback(
    (next: boolean) => {
      setValueState(next);
      // An unresolved project is not a scope: the store rejects one rather than
      // letting every project share a key, so nothing is written for it.
      if (typeof project !== "string" || project.trim() === "") return;
      writePreference(preferences.terminalMaximized, next, project);
    },
    [project],
  );

  const toggle = useCallback(() => setValue(!value), [value, setValue]);

  return [value, toggle, setValue];
}
