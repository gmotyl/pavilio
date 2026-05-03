import { useCallback, useState } from "react";

const KEY = "panel-commits-open";

export function useCommitsOpenMap() {
  const [map, setMap] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}");
    } catch {
      return {};
    }
  });

  const isOpen = useCallback(
    (repoPath: string) => map[repoPath] !== false,
    [map],
  );

  const setOpen = useCallback((repoPath: string, open: boolean) => {
    setMap((prev) => {
      const next = { ...prev, [repoPath]: open };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return { isOpen, setOpen };
}
