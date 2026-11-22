import { useEffect, useState } from "react";

/**
 * True while the last pointer the user pressed was a finger. Lets hover-only
 * affordances show up on a touchscreen laptop (whose mouse can hover, so
 * `@media (hover: none)` never matches) and hide again once the mouse is back.
 */
export function useTouchActive(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const onDown = (e: PointerEvent) => setTouch(e.pointerType === "touch");
    document.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    return () => document.removeEventListener("pointerdown", onDown, { capture: true });
  }, []);
  return touch;
}
