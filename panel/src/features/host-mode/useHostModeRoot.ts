import { useEffect } from "react";
import { useHostMode } from "./useHostMode";

// Side-effect hook: writes `data-host-mode` on <html> so a thin slice of
// CSS in index.css can subtly tint the breadcrumb header / sidebar
// brand area when the panel is opened from a remote device. Mounted
// once near the app root.
export function useHostModeRoot(): void {
  const { mode } = useHostMode();
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.dataset.hostMode = mode;
    return () => {
      delete root.dataset.hostMode;
    };
  }, [mode]);
}
