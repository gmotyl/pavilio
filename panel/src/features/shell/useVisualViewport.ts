import { useEffect } from "react";

export function useVisualViewport() {
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    let t: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      document.documentElement.style.setProperty("--vv-height", `${vv.height}px`);
      document.documentElement.style.setProperty("--vv-offset-top", `${vv.offsetTop}px`);
    };
    const scheduled = () => {
      if (t) clearTimeout(t);
      t = setTimeout(apply, 50);
    };
    apply();
    vv.addEventListener("resize", scheduled);
    vv.addEventListener("scroll", scheduled);
    return () => {
      vv.removeEventListener("resize", scheduled);
      vv.removeEventListener("scroll", scheduled);
      if (t) clearTimeout(t);
    };
  }, []);
}
