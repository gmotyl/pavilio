import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { matchProjectFromPath } from "../projects/matchProjectFromPath";

const OPEN_KEY = "panel:terminalDrawer:open";
const WIDTH_KEY = "panel:terminalDrawer:width";
export const DRAWER_MIN_WIDTH = 320;
export const DRAWER_DEFAULT_WIDTH = 480;
export const DRAWER_MAX_WIDTH = 900;

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "true";
  } catch {
    return false;
  }
}
function readWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n)) {
      return Math.min(DRAWER_MAX_WIDTH, Math.max(DRAWER_MIN_WIDTH, n));
    }
  } catch {
    // ignore
  }
  return DRAWER_DEFAULT_WIDTH;
}

interface DrawerCtx {
  open: boolean;
  width: number;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  setWidth: (v: number) => void;
}

const Ctx = createContext<DrawerCtx | null>(null);

export function TerminalDrawerProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [open, setOpenState] = useState(readOpen);
  const [width, setWidthState] = useState(readWidth);

  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem(OPEN_KEY, String(v));
    } catch {
      // ignore
    }
  }, []);

  const setWidth = useCallback((v: number) => {
    const clamped = Math.min(DRAWER_MAX_WIDTH, Math.max(DRAWER_MIN_WIDTH, v));
    setWidthState(clamped);
    try {
      localStorage.setItem(WIDTH_KEY, String(clamped));
    } catch {
      // ignore
    }
  }, []);

  const openRef = useRef(open);
  const pathRef = useRef(location.pathname);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        const match = matchProjectFromPath(pathRef.current);
        if (!match || match.section === "iterm") {
          if (openRef.current) setOpen(false);
          return;
        }
        setOpen(!openRef.current);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    const match = matchProjectFromPath(location.pathname);
    if (!match || match.section === "iterm") setOpen(false);
  }, [location.pathname, open, setOpen]);

  return (
    <Ctx.Provider value={{ open, width, setOpen, toggle, setWidth }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTerminalDrawer(): DrawerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useTerminalDrawer must be used within TerminalDrawerProvider");
  }
  return ctx;
}
