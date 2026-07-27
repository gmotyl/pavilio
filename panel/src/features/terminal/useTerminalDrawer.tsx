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
const SIDE_KEY = "panel:terminalDrawer:side";
export const DRAWER_MIN_WIDTH = 320;
export const DRAWER_DEFAULT_WIDTH = 480;
/** Floor for <main>: the drawer may never squeeze it narrower than this. */
export const MAIN_MIN_WIDTH = 360;

export function drawerMaxWidth(viewport: number): number {
  return Math.max(DRAWER_MIN_WIDTH, viewport - MAIN_MIN_WIDTH);
}

function clampWidth(value: number, viewport: number): number {
  return Math.min(drawerMaxWidth(viewport), Math.max(DRAWER_MIN_WIDTH, value));
}

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
    // Only the floor is applied here — the ceiling depends on the live
    // viewport and is applied when deriving the effective width.
    if (Number.isFinite(n)) return Math.max(DRAWER_MIN_WIDTH, n);
  } catch {
    // ignore
  }
  return DRAWER_DEFAULT_WIDTH;
}

export type DrawerSide = "left" | "right";

function readSide(): DrawerSide {
  try {
    return localStorage.getItem(SIDE_KEY) === "left" ? "left" : "right";
  } catch {
    return "right";
  }
}

interface DrawerCtx {
  /** Persisted user intent. Navigation must never write this. */
  open: boolean;
  /** Current route cannot host the drawer. Derived every render, never stored. */
  suppressed: boolean;
  /** open && !suppressed — what the drawer actually renders on. */
  visible: boolean;
  width: number;
  maxWidth: number;
  side: DrawerSide;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  setWidth: (v: number) => void;
  setSide: (v: DrawerSide) => void;
}

const Ctx = createContext<DrawerCtx | null>(null);

export function TerminalDrawerProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [open, setOpenState] = useState(readOpen);
  const [storedWidth, setStoredWidth] = useState(readWidth);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [side, setSideState] = useState(readSide);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const maxWidth = drawerMaxWidth(viewport);
  const width = clampWidth(storedWidth, viewport);

  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem(OPEN_KEY, String(v));
    } catch {
      // ignore
    }
  }, []);

  const setWidth = useCallback((v: number) => {
    const clamped = clampWidth(v, window.innerWidth);
    setStoredWidth(clamped);
    try {
      localStorage.setItem(WIDTH_KEY, String(clamped));
    } catch {
      // ignore
    }
  }, []);

  const setSide = useCallback((v: DrawerSide) => {
    setSideState(v);
    try {
      localStorage.setItem(SIDE_KEY, v);
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

  const match = matchProjectFromPath(location.pathname);
  const suppressed = !match || match.section === "iterm";
  const visible = open && !suppressed;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        const match = matchProjectFromPath(pathRef.current);
        if (!match || match.section === "iterm") return;
        setOpen(!openRef.current);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [setOpen]);

  return (
    <Ctx.Provider
      value={{
        open,
        suppressed,
        visible,
        width,
        maxWidth,
        side,
        setOpen,
        toggle,
        setWidth,
        setSide,
      }}
    >
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
