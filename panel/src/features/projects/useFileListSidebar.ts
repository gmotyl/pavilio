import { useCallback, useEffect, useState } from "react";
import { MOBILE_QUERY } from "../../lib/breakpoints";
import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";

function matchesMobile(): boolean {
  return window.matchMedia?.(MOBILE_QUERY).matches ?? false;
}

export interface FileListSidebarState {
  /** Effective visibility. Desktop: stored pref unless a peek is active. */
  collapsed: boolean;
  isMobile: boolean;
  /**
   * Desktop-only transient overlay peek is open. Distinct from the mobile
   * `transient` fold: the peek floats over the detail and never reflows layout.
   */
  peeking: boolean;
  /** User pressed the chevron. Flips (and persists) the stored pref; clears any peek. */
  toggle: () => void;
  /** A file was opened on mobile — fold the list away without touching the stored pref. */
  collapseTransient: () => void;
  /** Hovering the collapsed rail (desktop) opens the peek overlay. No-op on mobile. */
  startPeek: () => void;
  /** Leaving the overlay or selecting a file closes the peek. No-op on mobile. */
  endPeek: () => void;
}

/**
 * Per-hook `useState` here, and a module-level store in the sibling
 * `useSidebarState` — a deliberate difference, not an inconsistency.
 *
 * The transient fold below has ONE consumer: `FileListSidebar` renders the list
 * and owns the state that hides it, so there is no second reader to disagree
 * with. `useSidebarState` has two — `Layout` and `TerminalDrawer` both hold the
 * left sidebar — and two readers of one sidebar need one value. Copy this shape
 * while a fold has a single consumer; copy that one the moment it gains a
 * second.
 */
export function useFileListSidebar(): FileListSidebarState {
  // One preference for every tab and project — browsing vs reading is a mode,
  // not a per-tab choice.
  const [storedCollapsed, setStoredCollapsed] = usePreference(
    preferences.fileListSidebarCollapsed,
  );
  const [isMobile, setIsMobile] = useState(matchesMobile);
  // null = follow the stored preference. Only ever set while mobile.
  const [transient, setTransient] = useState<boolean | null>(() =>
    matchesMobile() ? true : null,
  );
  // Desktop-only hover peek. Never set on mobile.
  const [peeking, setPeeking] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia?.(MOBILE_QUERY);
    if (!mql) return;
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const mobile = e.matches;
      setIsMobile(mobile);
      setTransient(mobile ? true : null);
      setPeeking(false);
    };
    mql.addEventListener("change", onChange as (e: MediaQueryListEvent) => void);
    return () =>
      mql.removeEventListener(
        "change",
        onChange as (e: MediaQueryListEvent) => void,
      );
  }, []);

  // Mobile follows the transient fold; desktop follows the stored pref unless a
  // peek is temporarily expanding it. effective expanded = pinnedOpen || peeking.
  const collapsed =
    transient !== null ? transient : storedCollapsed && !peeking;

  const toggle = useCallback(() => {
    if (isMobile) {
      setTransient(!collapsed);
      return;
    }
    // Operate on the stored/pinned pref, independent of the transient peek.
    const next = !storedCollapsed;
    setPeeking(false);
    setTransient(null);
    setStoredCollapsed(next);
  }, [collapsed, isMobile, setStoredCollapsed, storedCollapsed]);

  const collapseTransient = useCallback(() => {
    if (isMobile) setTransient(true);
  }, [isMobile]);

  const startPeek = useCallback(() => {
    // A peek only makes sense while the sidebar is collapsed by the stored
    // pref on desktop. Pinned open (storedCollapsed === false) or mobile: no-op,
    // otherwise the overlay popup would render over the inline sidebar.
    if (!isMobile && storedCollapsed) setPeeking(true);
  }, [isMobile, storedCollapsed]);

  const endPeek = useCallback(() => {
    if (!isMobile) setPeeking(false);
  }, [isMobile]);

  return {
    collapsed,
    isMobile,
    peeking,
    toggle,
    collapseTransient,
    startPeek,
    endPeek,
  };
}

export default useFileListSidebar;
