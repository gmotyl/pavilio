import { useEffect, useState } from "react";
import { MOBILE_QUERY } from "../../lib/breakpoints";

/**
 * Whether the viewport is the one `index.css` lays the shell out differently
 * for, kept live across a resize or a rotation.
 *
 * Read in a `useState` initializer rather than in an effect, so the first
 * render is already right: a phone that started at `false` and corrected
 * itself a frame later would render the desktop arrangement once, and the
 * consumers here are geometry decisions that would visibly flicker.
 *
 * `window.matchMedia?.` because jsdom does not always have one, and the honest
 * answer without it is "not mobile" — the tests that care install a stub.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia?.(MOBILE_QUERY).matches ?? false,
  );

  useEffect(() => {
    const mql = window.matchMedia?.(MOBILE_QUERY);
    if (!mql) return;
    const onChange = (e: MediaQueryListEvent | MediaQueryList) =>
      setIsMobile(e.matches);
    mql.addEventListener("change", onChange as (e: MediaQueryListEvent) => void);
    return () =>
      mql.removeEventListener(
        "change",
        onChange as (e: MediaQueryListEvent) => void,
      );
  }, []);

  return isMobile;
}

export default useIsMobile;
