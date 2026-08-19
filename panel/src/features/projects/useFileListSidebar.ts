import { useCallback, useEffect, useState } from "react";

/** One key for every tab and project — browsing vs reading is a mode, not a per-tab pref. */
export const FILE_LIST_SIDEBAR_KEY = "panel:fileListSidebar.collapsed";
/** Same breakpoint as TerminalLayoutGrid. */
export const MOBILE_QUERY = "(max-width: 767px)";

function readStored(): boolean {
  try {
    return localStorage.getItem(FILE_LIST_SIDEBAR_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStored(value: boolean) {
  try {
    localStorage.setItem(FILE_LIST_SIDEBAR_KEY, String(value));
  } catch {
    // ignore quota / private-mode errors
  }
}

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

export function useFileListSidebar(): FileListSidebarState {
  const [storedCollapsed, setStoredCollapsed] = useState(readStored);
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
    writeStored(next);
  }, [collapsed, isMobile, storedCollapsed]);

  const collapseTransient = useCallback(() => {
    if (isMobile) setTransient(true);
  }, [isMobile]);

  const startPeek = useCallback(() => {
    if (!isMobile) setPeeking(true);
  }, [isMobile]);

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
