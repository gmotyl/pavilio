import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { useIsMobile } from "./useIsMobile";

type SidebarKey = "leftSidebar" | "rightSidebar";

/** Two declarations rather than one scoped preference: the sides are not a list. */
const DECLARATIONS = {
  leftSidebar: preferences.leftSidebarExpanded,
  rightSidebar: preferences.rightSidebarExpanded,
} as const;

/**
 * The phone's answer for each side: what the user has said on THIS viewport,
 * or `null` for "nothing yet".
 *
 * On a phone a sidebar is a `position: fixed` overlay over the page the reader
 * came for, so opening one is a glance rather than a setting. Remembering it
 * would greet the next visit with the overlay again — and these two
 * preferences are portable, so the phone would reach across and rearrange the
 * desktop that wrote them. Hence a fold that is deliberately never stored.
 *
 * Module state and not `useState`, which is the part that is easy to get
 * wrong: a sidebar is ONE thing, and more than one hook asks about it —
 * `Layout` and `TerminalDrawer` both hold the left one. Per-hook state lets
 * them disagree, so the sidebar would be open for the component rendering it
 * and closed for the one deciding whether to make room for it. The preference
 * store is what kept those two in step before; this is the same job for the
 * value that is deliberately not going to the store.
 */
const fold: Record<SidebarKey, boolean | null> = {
  leftSidebar: null,
  rightSidebar: null,
};

const foldListeners: Record<SidebarKey, Set<() => void>> = {
  leftSidebar: new Set(),
  rightSidebar: new Set(),
};

/** What the fold reads as before anyone has spoken: a phone starts closed. */
function folded(key: SidebarKey): boolean {
  return fold[key] ?? false;
}

function setFold(key: SidebarKey, next: boolean | null): void {
  if (fold[key] === next) return;
  fold[key] = next;
  for (const listener of foldListeners[key]) listener();
}

function useFold(key: SidebarKey): boolean | null {
  return useSyncExternalStore(
    useCallback(
      (onChange: () => void) => {
        foldListeners[key].add(onChange);
        return () => {
          foldListeners[key].delete(onChange);
        };
      },
      [key],
    ),
    useCallback(() => fold[key], [key]),
  );
}

/**
 * The fold is tab-scoped module state, so it outlives a test's unmount the way
 * the preference store does. `test-setup.ts` clears it between tests.
 */
export function __resetSidebarFoldForTests(): void {
  setFold("leftSidebar", null);
  setFold("rightSidebar", null);
}

export function useSidebarState(key: SidebarKey) {
  const [stored, setStored] = usePreference(DECLARATIONS[key]);
  const isMobile = useIsMobile();
  const transient = useFold(key);

  /**
   * A viewport cross hands the question back: onto a phone the fold starts
   * closed again, and back onto a desktop the stored value takes over.
   *
   * Guarded on an actual CROSS rather than just on the effect running, because
   * the fold is shared: a second consumer mounting mid-session — the terminal
   * drawer opening, say — would otherwise shut a sidebar the user had just
   * opened.
   */
  const wasMobile = useRef(isMobile);
  useEffect(() => {
    if (wasMobile.current === isMobile) return;
    wasMobile.current = isMobile;
    setFold(key, null);
  }, [isMobile, key]);

  // Desktop is the stored preference and nothing else — so the reset above is
  // about the NEXT visit to a phone rather than about this render, and a
  // rotation cannot show a stale fold for the frame before the effect runs.
  const expanded = isMobile ? (transient ?? false) : stored;

  // Updaters, not closure reads: two toggles in one tick have to compose, and
  // a captured `expanded` makes the second one see the value the first already
  // replaced. The mobile branch reads the fold back out of the module rather
  // than out of this render, for exactly the same reason.
  const toggle = useCallback(() => {
    if (isMobile) {
      setFold(key, !folded(key));
      return;
    }
    setStored((previous) => !previous);
  }, [isMobile, key, setStored]);

  const setExpanded = useCallback(
    (value: boolean) => {
      // Still guarded, and now against the LATEST value rather than a captured
      // one: an idempotent set skipped its write before, and now it also skips
      // a PATCH. An updater returning its argument is the store's no-op.
      if (isMobile) {
        if (folded(key) !== value) setFold(key, value);
        return;
      }
      setStored((previous) => (previous === value ? previous : value));
    },
    [isMobile, key, setStored],
  );

  return { expanded, toggle, setExpanded };
}
