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
  /** Effective visibility. */
  collapsed: boolean;
  isMobile: boolean;
  /** User pressed the chevron. Persists on desktop only. */
  toggle: () => void;
  /** A file was opened on mobile — fold the list away without touching the stored pref. */
  collapseTransient: () => void;
}

export function useFileListSidebar(): FileListSidebarState {
  const [storedCollapsed, setStoredCollapsed] = useState(readStored);
  const [isMobile, setIsMobile] = useState(matchesMobile);
  // null = follow the stored preference. Only ever set while mobile.
  const [transient, setTransient] = useState<boolean | null>(() =>
    matchesMobile() ? true : null,
  );

  useEffect(() => {
    const mql = window.matchMedia?.(MOBILE_QUERY);
    if (!mql) return;
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const mobile = e.matches;
      setIsMobile(mobile);
      setTransient(mobile ? true : null);
    };
    mql.addEventListener("change", onChange as (e: MediaQueryListEvent) => void);
    return () =>
      mql.removeEventListener(
        "change",
        onChange as (e: MediaQueryListEvent) => void,
      );
  }, []);

  const collapsed = transient !== null ? transient : storedCollapsed;

  const toggle = useCallback(() => {
    if (isMobile) {
      setTransient(!collapsed);
      return;
    }
    const next = !collapsed;
    setTransient(null);
    setStoredCollapsed(next);
    writeStored(next);
  }, [collapsed, isMobile]);

  const collapseTransient = useCallback(() => {
    if (isMobile) setTransient(true);
  }, [isMobile]);

  return { collapsed, isMobile, toggle, collapseTransient };
}

export default useFileListSidebar;
