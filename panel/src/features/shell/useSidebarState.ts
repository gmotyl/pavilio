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

  // Updaters, not closure reads: two toggles in one tick have to compose, and
  // a captured `expanded` makes the second one see the value the first already
  // replaced.
  const toggle = useCallback(() => {
    setStored((previous) => !previous);
  }, [setStored]);

  const setExpanded = useCallback(
    (value: boolean) => {
      // Still guarded, and now against the LATEST value rather than a captured
      // one: an idempotent set skipped its write before, and now it also skips
      // a PATCH. An updater returning its argument is the store's no-op.
      setStored((previous) => (previous === value ? previous : value));
    },
    [setStored],
  );

  return { expanded, toggle, setExpanded };
}
