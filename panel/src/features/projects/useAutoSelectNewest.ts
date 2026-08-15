import { useEffect } from "react";

export interface AutoSelectCandidate {
  /** Value passed to onSelect — a relative path (sections) or absolute path (plans/context). */
  key: string;
  mtime: number;
}

/**
 * When a tab has no `?file=` selected and at least one file is visible, open
 * the preferred file (e.g. the starred plan) or else the newest by mtime.
 * "Newest" is always max-mtime, independent of the display sort. Fires only
 * while nothing is selected, so it never overrides the user's choice.
 */
export function useAutoSelectNewest(opts: {
  candidates: AutoSelectCandidate[];
  selectedPath: string | null;
  onSelect: (key: string) => void;
  preferredKey?: string | null;
}) {
  const { candidates, selectedPath, onSelect, preferredKey } = opts;
  useEffect(() => {
    if (selectedPath) return;
    if (preferredKey) {
      onSelect(preferredKey);
      return;
    }
    if (candidates.length === 0) return;
    const newest = candidates.reduce((a, b) => (b.mtime > a.mtime ? b : a));
    onSelect(newest.key);
  }, [selectedPath, candidates, preferredKey, onSelect]);
}

export default useAutoSelectNewest;
