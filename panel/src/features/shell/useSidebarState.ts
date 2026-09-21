import { useCallback } from "react";
import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";

type SidebarKey = "leftSidebar" | "rightSidebar";

/** Two declarations rather than one scoped preference: the sides are not a list. */
const DECLARATIONS = {
  leftSidebar: preferences.leftSidebarExpanded,
  rightSidebar: preferences.rightSidebarExpanded,
} as const;

export function useSidebarState(key: SidebarKey) {
  const [expanded, setStored] = usePreference(DECLARATIONS[key]);

  const toggle = useCallback(() => {
    setStored(!expanded);
  }, [expanded, setStored]);

  const setExpanded = useCallback(
    (value: boolean) => {
      // Still guarded: an idempotent set skipped its write before, and now it
      // also skips a PATCH.
      if (expanded === value) return;
      setStored(value);
    },
    [expanded, setStored],
  );

  return { expanded, toggle, setExpanded };
}
