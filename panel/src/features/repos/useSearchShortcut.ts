import { useCallback, useEffect, useRef, useState } from "react";

export type SearchMode = "files" | "text";

/** A pending "focus the Code search" request; `seq` makes a repeat press a new request. */
export interface SearchRequest {
  mode: SearchMode;
  seq: number;
}

function modeOf(e: KeyboardEvent): SearchMode | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === "p" && !e.shiftKey) return "files";
  if (key === "f" && e.shiftKey) return "text";
  return null;
}

/** Ctrl/⌘+P and Ctrl/⌘+Shift+F anywhere on the page while mounted; `onPress` runs before the request lands. */
export function useSearchShortcut(onPress: () => void) {
  const [request, setRequest] = useState<SearchRequest | null>(null);
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mode = modeOf(e);
      if (!mode) return;
      // Ctrl+P would otherwise open the browser's print dialog.
      e.preventDefault();
      onPressRef.current();
      setRequest((r) => ({ mode, seq: (r?.seq ?? 0) + 1 }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const clear = useCallback(() => setRequest(null), []);
  return [request, clear] as const;
}
